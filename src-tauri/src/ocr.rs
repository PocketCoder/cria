//! Native OCR for the shopping-list photo feature.
//!
//! On Apple platforms this uses the Vision framework (`VNRecognizeTextRequest`)
//! to recognise text fully on-device — free, private, and offline. The
//! frontend (`src/features/shoppingPhoto/ocr.ts`) calls this command first and
//! falls back to a WASM engine in the webview where it isn't available
//! (non-Apple desktop, the Vite dev browser).
//!
//! Input is a base64-encoded image (JPEG/PNG/HEIC — anything Core Image reads).
//! Output is one string per recognised text line, in reading order; the
//! frontend handles cleanup and splitting into list items.

#[cfg(any(target_os = "macos", target_os = "ios"))]
#[tauri::command]
pub fn recognize_text(image_base64: String) -> Result<Vec<String>, String> {
    use base64::Engine as _;
    use objc2::AllocAnyThread;
    use objc2_foundation::{NSArray, NSData, NSDictionary};
    use objc2_vision::{
        VNImageRequestHandler, VNRecognizeTextRequest, VNRequest, VNRequestTextRecognitionLevel,
    };

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(image_base64.as_bytes())
        .map_err(|e| format!("invalid base64 image: {e}"))?;

    let data = NSData::with_bytes(&bytes);
    let options = NSDictionary::new();
    let handler =
        VNImageRequestHandler::initWithData_options(VNImageRequestHandler::alloc(), &data, &options);

    let request = VNRecognizeTextRequest::new();
    request.setRecognitionLevel(VNRequestTextRecognitionLevel::Accurate);
    request.setUsesLanguageCorrection(true);

    let req_ref: &VNRequest = &request;
    let requests = NSArray::from_slice(&[req_ref]);
    handler
        .performRequests_error(&requests)
        .map_err(|e| format!("text recognition failed: {e}"))?;

    let mut lines = Vec::new();
    if let Some(results) = request.results() {
        for obs in results.iter() {
            // The top candidate is Vision's best guess for this text line.
            let candidates = obs.topCandidates(1);
            if let Some(text) = candidates.firstObject() {
                lines.push(text.string().to_string());
            }
        }
    }
    Ok(lines)
}

/// On non-Apple platforms there is no on-device Vision engine; the frontend
/// falls back to its WASM OCR. The command still exists so `invoke` resolves.
#[cfg(not(any(target_os = "macos", target_os = "ios")))]
#[tauri::command]
pub fn recognize_text(_image_base64: String) -> Result<Vec<String>, String> {
    Err("native text recognition is only available on macOS and iOS".to_string())
}
