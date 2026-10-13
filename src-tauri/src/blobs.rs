//! File-bytes side-store for queued attachment uploads.
//!
//! Outbox rows carry TEXT payloads, and a multi-MB file doesn't belong in a
//! SQLite cell, so the bytes of a file picked while offline live here: one
//! file per attachment under `<app data dir>/attachment-blobs/<id>`, keyed by
//! the attachment's local id. The upload executor
//! (`src/sync/push/attachment.ts`) reads them back when it drains the op and
//! deletes them once the server has the file. Files sit in the app data dir,
//! so they survive a restart between pick and reconnect.
//!
//! Bytes cross the IPC bridge raw (no base64): `blob_write` takes the request
//! body as-is with the id in the `x-blob-id` header, and `blob_read` answers
//! with a binary `Response`. File I/O runs on the blocking pool so a large
//! write never stalls the main thread.
//!
//! `blob_list` reports every stored id with its modified time, for the
//! frontend's startup sweep of blobs nothing refers to any more
//! (`src/sync/blobSweep.ts`).
//!
//! Shared by desktop and mobile; no plugin or capability needed (app commands
//! registered through `generate_handler!` are allowed by default).

use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Manager};

const DIR: &str = "attachment-blobs";
const ID_HEADER: &str = "x-blob-id";
/// Prefix the frontend matches to tell "bytes gone" from a transient error.
const NOT_FOUND: &str = "blob not found";

/// Ids are nanoids (`[A-Za-z0-9_-]`). Anything else is refused, so a crafted
/// id can never name a path outside the store directory.
fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

fn store_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join(DIR))
}

fn blob_path(dir: &Path, id: &str) -> Result<PathBuf, String> {
    if !valid_id(id) {
        return Err(format!("invalid blob id {id:?}"));
    }
    Ok(dir.join(id))
}

/// Write to a sibling temp file, fsync, then rename, so a crash mid-write
/// never leaves a truncated blob under the real id.
fn write_blob(dir: &Path, id: &str, bytes: &[u8]) -> Result<(), String> {
    let path = blob_path(dir, id)?;
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let tmp = dir.join(format!("{id}.part"));
    let mut file = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
    file.write_all(bytes).map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())?;
    drop(file);
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

fn read_blob(dir: &Path, id: &str) -> Result<Vec<u8>, String> {
    let path = blob_path(dir, id)?;
    std::fs::read(&path).map_err(|e| match e.kind() {
        std::io::ErrorKind::NotFound => format!("{NOT_FOUND}: {id}"),
        _ => e.to_string(),
    })
}

/// Idempotent: deleting a missing blob succeeds.
fn delete_blob(dir: &Path, id: &str) -> Result<(), String> {
    let path = blob_path(dir, id)?;
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// One stored blob, as `blob_list` reports it.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlobEntry {
    id: String,
    /// Last write, in milliseconds since the Unix epoch. `None` when the
    /// platform can't say; the frontend keeps such a blob.
    modified_ms: Option<u64>,
}

/// Every blob in the store, sorted by id. Only names that pass `valid_id`
/// are listed, the check every other command applies, so a `.part` temp
/// file or anything else in the directory is never reported (or handed back
/// to `blob_delete`). Neither is a directory, a symlink or an entry whose
/// metadata can't be read. A store that was never created lists as empty.
fn list_blobs(dir: &Path) -> Result<Vec<BlobEntry>, String> {
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e.to_string()),
    };
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let Ok(id) = entry.file_name().into_string() else {
            continue;
        };
        if !valid_id(&id) {
            continue;
        }
        // DirEntry::metadata doesn't follow symlinks, so a link isn't a file.
        let Ok(meta) = entry.metadata() else {
            continue;
        };
        if !meta.is_file() {
            continue;
        }
        let modified_ms = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .and_then(|d| u64::try_from(d.as_millis()).ok());
        out.push(BlobEntry { id, modified_ms });
    }
    out.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(out)
}

/// Raw bytes from the request body. The custom-protocol IPC delivers them as
/// `Raw`; the postMessage fallback (and Android) serialise a `Uint8Array` to
/// a JSON number array, so accept that too.
fn body_bytes(body: &InvokeBody) -> Result<Vec<u8>, String> {
    match body {
        InvokeBody::Raw(bytes) => Ok(bytes.clone()),
        InvokeBody::Json(serde_json::Value::Array(items)) => items
            .iter()
            .map(|v| {
                v.as_u64()
                    .and_then(|n| u8::try_from(n).ok())
                    .ok_or_else(|| "blob_write: body is not a byte array".to_string())
            })
            .collect(),
        InvokeBody::Json(_) => Err("blob_write: expected a raw byte body".to_string()),
    }
}

async fn blocking<T, F>(f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn blob_write(app: AppHandle, request: Request<'_>) -> Result<(), String> {
    let id = request
        .headers()
        .get(ID_HEADER)
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| format!("blob_write: missing {ID_HEADER} header"))?
        .to_string();
    let bytes = body_bytes(request.body())?;
    let dir = store_dir(&app)?;
    blocking(move || write_blob(&dir, &id, &bytes)).await
}

#[tauri::command]
pub async fn blob_read(app: AppHandle, id: String) -> Result<Response, String> {
    let dir = store_dir(&app)?;
    let bytes = blocking(move || read_blob(&dir, &id)).await?;
    Ok(Response::new(bytes))
}

#[tauri::command]
pub async fn blob_delete(app: AppHandle, id: String) -> Result<(), String> {
    let dir = store_dir(&app)?;
    blocking(move || delete_blob(&dir, &id)).await
}

#[tauri::command]
pub async fn blob_list(app: AppHandle) -> Result<Vec<BlobEntry>, String> {
    let dir = store_dir(&app)?;
    blocking(move || list_blobs(&dir)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_store(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("cria-blobs-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn rejects_ids_that_could_escape_the_store() {
        assert!(valid_id("V1StGXR8_Z5jdHi6B-myT"));
        for bad in ["", "../etc/passwd", "a/b", "a\\b", "a.b", &"x".repeat(65)] {
            assert!(!valid_id(bad), "{bad:?} should be rejected");
        }
    }

    #[test]
    fn write_read_delete_round_trip() {
        let dir = temp_store("round-trip");
        write_blob(&dir, "abc", b"hello").unwrap();
        assert_eq!(read_blob(&dir, "abc").unwrap(), b"hello");
        assert!(!dir.join("abc.part").exists());
        delete_blob(&dir, "abc").unwrap();
        assert!(read_blob(&dir, "abc").unwrap_err().starts_with(NOT_FOUND));
        // Deleting again is a no-op.
        delete_blob(&dir, "abc").unwrap();
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn lists_only_valid_blob_files_with_modified_times() {
        let dir = temp_store("list");
        // A store that was never created is empty, not an error.
        assert!(list_blobs(&dir).unwrap().is_empty());

        let before = std::time::SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;
        write_blob(&dir, "b-2", b"two").unwrap();
        write_blob(&dir, "a_1", b"one").unwrap();
        // Never listed: a crash leftover, a directory, a name no command accepts.
        std::fs::write(dir.join("c.part"), b"half").unwrap();
        std::fs::create_dir(dir.join("sub")).unwrap();
        std::fs::write(dir.join("has space"), b"x").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(dir.join("a_1"), dir.join("link")).unwrap();

        let listed = list_blobs(&dir).unwrap();
        let ids: Vec<&str> = listed.iter().map(|e| e.id.as_str()).collect();
        assert_eq!(ids, ["a_1", "b-2"]);
        for entry in &listed {
            let ms = entry.modified_ms.expect("modified time");
            // Generous slack for coarse filesystem timestamps.
            assert!(ms + 5_000 >= before, "{ms} is well before {before}");
        }

        let json = serde_json::to_value(&listed[0]).unwrap();
        assert_eq!(json["id"], "a_1");
        assert!(json["modifiedMs"].is_u64());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn accepts_json_number_array_bodies() {
        let body = InvokeBody::Json(serde_json::json!([1, 2, 255]));
        assert_eq!(body_bytes(&body).unwrap(), vec![1, 2, 255]);
        let bad = InvokeBody::Json(serde_json::json!([256]));
        assert!(body_bytes(&bad).is_err());
        assert_eq!(body_bytes(&InvokeBody::Raw(vec![7])).unwrap(), vec![7]);
    }
}
