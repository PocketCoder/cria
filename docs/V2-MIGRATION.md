# Vikunja v1 to v2 API migration contract

Shared by the Tauri/TypeScript client (`src/`) and the native Swift client (`ios-native/CriaKit`, used by both the macOS and iOS apps). Derived by diffing `https://try.vikunja.io/api/v1/docs.json` against `/api/v2/openapi-3.0.json` (server `v2.7.0`). Official overview: <https://vikunja.io/docs/api-v2/>.

## Version policy

- `GET /info` (same on both versions) returns `version`, for example `v2.7.0-16-g58f7cf47`. Parse the leading `vMAJOR.MINOR.PATCH`.
- **Use v2 when the server is >= 2.7.0** (`V2_MIN_VERSION`, one constant per client; the version Cria's settings `PATCH` already required and the one this contract was verified against). Anything lower, or an unparseable version, uses v1.
- v1 stays for the whole transition (deprecated in 3.0, removed in 4.0). Do not delete the v1 code paths in this change.
- Escape hatch: a persisted "Force API v1" preference (default off) overrides detection.
- **Per-route override:** some v1 routes have no v2 equivalent. They keep calling `/api/v1` even on a v2 server (see "v1-only routes"). Auth is identical on both, so the same Bearer token works.
- The version decision is made once per server URL (cache it; re-probe on sign-in and server-URL change).

## Mapping rules

| Concern | v1 | v2 |
|---|---|---|
| Create | `PUT` | `POST` (201) |
| Full update | `POST` | `PUT` |
| Partial update | none | `PATCH`, `Content-Type: application/merge-patch+json` |
| Delete | 200 + body | 204, empty body (do not parse a body) |
| List response | bare array, `x-pagination-total-pages` / `x-pagination-result-count` headers | envelope `{ items, page, per_page, total, total_pages }` (also has a `$schema` field to ignore) |
| Search param | `s` | `q` |
| Error body | `{ code, message }` | `application/problem+json`: `{ title, status, detail, code, errors[], type, instance }`. `code` is the same numeric Vikunja code. Message text is in `detail` (fall back to `title`). |
| Validation status | 412 | 422 (`errors[]` lists the fields). **Re-check any code that treats 412 as TOTP-required** (see Open questions). |
| Max permission | `x-max-permission` header | `max_permission` field in single-resource bodies |
| Markdown | n/a | optional `?format=markdown`; **do not use**, keep HTML |
| Spec | swagger 2 | OpenAPI 3.1 at `/api/v2/openapi.json` (3.0 variant `/api/v2/openapi-3.0.json`) |

Task/project/label/comment JSON field names are unchanged (snake_case). New task fields to tolerate and ignore: `deleted_at`, `time_entries_count`, `max_permission`, `$schema`.

## Endpoint changes (v1 -> v2), by method and path

Same path unless a rename is shown. `{x}` names differ in the spec but are positional.

**Create is POST, update is PUT** (v1 was PUT/POST): `/projects`, `/labels`, `/filters`, `/teams`, `/tokens`, `/user/settings/token/caldav`, `/user/settings/webhooks`, `/projects/{p}/tasks`, `/projects/{p}/views`, `/projects/{p}/views/{v}/buckets`, `/projects/{p}/shares`, `/projects/{p}/users`, `/projects/{p}/teams`, `/projects/{p}/webhooks`, `/tasks/{t}/assignees`, `/tasks/{t}/labels`, `/tasks/{t}/comments`, `/tasks/{t}/relations`, `/tasks/{t}/attachments` (multipart, field name `files`), `/teams/{t}/members`, `/{entitykind}/{entityid}/reactions`, `/subscriptions/{entity}/{entityID}` (PUT -> POST).

**Updates that moved from POST to PUT** (and now also accept PATCH): `/projects/{id}`, `/labels/{id}` (v1 already PUT; now `PUT`/`PATCH`), `/tasks/{id}`, `/filters/{id}`, `/teams/{id}`, `/projects/{p}/views/{v}`, `/tasks/{t}/comments/{c}`, `/projects/{p}/views/{v}/buckets/{b}`, `/projects/{p}/users/{u}`, `/projects/{p}/teams/{t}`.

**Other verb flips (POST -> PUT):** `/notifications/{id}` (mark read), `/tasks/{id}/position`, `/tasks/{id}/read`, `/tasks/bulk`, `/tasks/{t}/assignees/bulk`, `/tasks/{t}/labels/bulk`, `/user/settings/avatar` (`POST` JSON -> `PUT` multipart field `avatar`), `/user/settings/email` (`POST` -> `PUT`, plus new `DELETE`), `/projects/{p}/backgrounds/unsplash` (POST -> PUT), `/projects/{p}/views/{v}/buckets/{b}/tasks` (POST -> PUT, same path; body is a `TaskBucket`, the bucket id comes from the URL and `bucket_id` in the body is ignored. `/buckets/tasks` without an id is only the non-paginated GET of buckets with their tasks), `/projects/{p}/duplicate`, `/tasks/{t}/duplicate` (PUT -> POST), `/user/settings/general` (POST -> `PUT`/`PATCH`/`GET`).

**Unchanged verbs:** `POST /login`, `POST /user/token/refresh`, `POST /user/token`, `POST /shares/{share}/auth`, `GET /info`, `GET /user`, `GET /users`, `GET /labels|projects|tasks|teams|notifications` lists (but envelope), all `DELETE`s, `POST /notifications` (mark all read), `DELETE /notifications`, `POST /teams/{t}/members/{u}/admin`, password/TOTP-less user routes (`/user/password`, `/user/export*`, `/user/deletion/*`), `GET /user/timezones`.

**Renamed paths in v2:**
- `GET /projects/{id}/projectusers?s=` -> `GET /projects/{project}/users/search?q=` (v1 name no longer exists).
- `GET /{username}/avatar` -> `GET /avatar/{username}`.
- `POST /user/logout` -> `POST /logout`.
- `GET /backgrounds/unsplash/image/{id}[/thumb]` -> `/backgrounds/unsplash/images/{id}[/thumb]`.

### v1-only routes (no v2 equivalent; keep calling `/api/v1`)

TOTP: `GET /user/settings/totp`, `POST /user/settings/totp/enroll`, `/enable`, `/disable`, `GET /user/settings/totp/qrcode`. Avatar upload `PUT /user/settings/avatar/upload` (v2 replaced it with `PUT /user/settings/avatar`, multipart). The Microsoft Todo migration routes. If a client only reaches these through the adapter's route table, put the exception list in one place.

### New in v2 (not used by this change)

`/user/sessions`, `/user/bots`, `/time-entries`, `/admin/*`, `/invite-links`, `/health`, `/notifications.atom`, `/projects/{p}/tasks/bulk`, `/user/settings/avatar/provider`. Cria's Swift `UserSessions` may already call `/user/sessions`; check which version it hits.

## Wire-format notes carried over from v1

Keep every quirk in `taskToBody` (hex colour without `#`, `percent_done` 0-100, explicit `is_favorite:false`, `repeat_after`/`repeat_mode` explicit `0`, `project_id` on move) unless the v2 spec proves otherwise. v2 `PUT` is still a **full replace**: never send a partial body to `PUT`. Use `PATCH` (merge-patch) only for genuinely partial updates, and only where a test pins the exact body.

## Open questions (verify against the spec, do not guess)

1. How v2 signals "TOTP passcode required" on `POST /login` (v1: HTTP 412 with code 1017). Inspect problem codes in `/api/v2/openapi-3.0.json` and the Vikunja source if reachable. Support both statuses until proven.
2. The refresh cookie may be scoped to the refresh endpoint path, so refresh must use the same API version login used; confirm the cookie name/path. Whether `POST /login` and `/user/token/refresh` on v2 set the `vikunja_refresh_token` cookie the same way (the v2 login body is only `{ token }`).
3. Required body fields of the task-to-bucket move `PUT .../buckets/{b}/tasks` (likely `task_id`, `project_view_id`; confirm in the schema).
4. Attachment download path (`GET /tasks/{t}/attachments/{a}`) response is still a binary stream.
5. `GET /tasks/{id}?expand=comments` still supported on v2.

## Scratch references (not committed)

The full specs and a normalised route diff were saved by the author session under the session scratchpad (`spec/api_v2_openapi-3.0.json`, `spec/api_v1_docs.json`, `spec/route-diff.txt`). Re-download with `curl https://try.vikunja.io/api/v2/openapi-3.0.json` and `https://try.vikunja.io/api/v1/docs.json` into a fresh directory.
