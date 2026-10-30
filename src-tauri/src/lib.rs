use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD as B64};
use hmac::{Hmac, Mac};
use parking_lot::Mutex;
use reqwest::header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE, ORIGIN, REFERER};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::collections::HashMap;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::Emitter;
use tauri::Manager;
use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};

const SERVICE: &str = "app.geist";
const LEGACY_SERVICE: &str = "app.draftdesk";
const TOKEN_TTL_SECS: i64 = 300;
const PREVIEW_WINDOW_LABEL: &str = "preview";
/// Key kind reported to the webview for password sign-ins. The Keychain account
/// itself is the site's `base`, matching `save_key`.
const STAFF_KEY: &str = "staff";
/// How long a half-finished password login (session cookie kept in memory) lives.
const PENDING_LOGIN_TTL_SECS: u64 = 10 * 60;
const HTTP_TIMEOUT: Duration = Duration::from_secs(30);

fn entry(base: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, base).map_err(|e| e.to_string())
}

fn legacy_entry(base: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(LEGACY_SERVICE, base).map_err(|e| e.to_string())
}

fn read_stored_key(base: &str) -> Result<String, String> {
    match entry(base)?.get_password() {
        Ok(key) => Ok(key),
        Err(keyring::Error::NoEntry) => {
            // Migrate seamlessly from v0.1 "app.draftdesk" if present.
            let legacy = legacy_entry(base)?
                .get_password()
                .map_err(|_| "No key saved for this site. Reconnect.".to_string())?;
            let _ = entry(base).and_then(|e| e.set_password(&legacy).map_err(|err| err.to_string()));
            Ok(legacy)
        }
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn save_key(base: String, key: String) -> Result<(), String> {
    let key = key.trim();
    let (id, secret) = key.split_once(':').ok_or("Key must look like id:secret")?;
    if id.is_empty() || hex::decode(secret).is_err() {
        return Err("That doesn't look like a Ghost Admin API key".into());
    }
    entry(&base)?.set_password(key).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_key(base: String) -> Result<(), String> {
    let primary = entry(&base)?.delete_credential();
    let legacy = legacy_entry(&base)?.delete_credential();
    match (primary, legacy) {
        (Ok(()), _) | (_, Ok(())) => Ok(()),
        (Err(keyring::Error::NoEntry), Err(keyring::Error::NoEntry)) => Ok(()),
        (Err(e), _) => Err(e.to_string()),
    }
}

#[tauri::command]
fn get_jwt(base: String, clock_offset_secs: i64) -> Result<String, String> {
    let key = read_stored_key(&base)?;
    mint(&key, clock_offset_secs)
}

#[tauri::command]
fn has_key(base: String) -> Result<bool, String> {
    match entry(&base)?.get_password() {
        Ok(_) => Ok(true),
        Err(keyring::Error::NoEntry) => match legacy_entry(&base)?.get_password() {
            Ok(_) => Ok(true),
            Err(keyring::Error::NoEntry) => Ok(false),
            Err(e) => Err(e.to_string()),
        },
        Err(e) => Err(e.to_string()),
    }
}

// ---------------------------------------------------------------------------
// v0.6.0 password sign-in
//
// Ghost requires the request's exact `Origin` header on `POST /session/`, which
// the webview HTTP plugin cannot set. The whole login therefore happens here in
// Rust: the session cookie lives only inside an ephemeral in-memory
// `reqwest::Client`, the password is never stored, and once the Staff Access
// Token has been retrieved the session is deleted and the client dropped.
// ---------------------------------------------------------------------------

/// Result of a password sign-in attempt, serialized to the webview with a
/// `"status"` tag (`Success` or `Needs2FA`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "status")]
pub enum LoginResult {
    Success {
        key_kind: String,
        staff_id: String,
    },
    Needs2FA {
        pending_id: String,
        email: String,
        message: String,
    },
}

/// A password login that is waiting for its emailed 2FA code.
///
/// The Ghost session cookie is held by `client`'s cookie jar and nowhere else.
#[derive(Clone)]
struct PendingLogin {
    session_id: String,
    client: reqwest::Client,
    base_url: String,
    origin: String,
    email: String,
    expires_at: Instant,
}

impl PendingLogin {
    /// User-facing prompt shown alongside the 2FA code field.
    fn needs_2fa_message(&self) -> String {
        format!(
            "We emailed a verification code to {}. Enter it to finish signing in.",
            self.email
        )
    }
}

/// In-memory registry of pending logins, keyed by their `pending_id`.
///
/// Entries expire after ten minutes and are swept lazily on every access, so a
/// half-finished sign-in can never linger in the app.
#[derive(Default)]
struct PendingLoginStore {
    sessions: Mutex<HashMap<String, PendingLogin>>,
}

impl PendingLoginStore {
    fn insert(&self, login: PendingLogin) -> String {
        let pending_id = login.session_id.clone();
        let mut sessions = self.sessions.lock();
        let now = Instant::now();
        sessions.retain(|_, pending| pending.expires_at > now);
        sessions.insert(pending_id.clone(), login);
        pending_id
    }

    fn get(&self, pending_id: &str) -> Option<PendingLogin> {
        let mut sessions = self.sessions.lock();
        let now = Instant::now();
        sessions.retain(|_, pending| pending.expires_at > now);
        sessions.get(pending_id).cloned()
    }

    fn remove(&self, pending_id: &str) {
        self.sessions.lock().remove(pending_id);
    }
}

/// Splits a user-entered site address into a normalized `base` (origin plus
/// optional subdirectory, no trailing slash) and the exact `origin` Ghost
/// expects in the `Origin` header.
fn normalize_base_url(raw: &str) -> Result<(String, String), String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("Enter your Ghost site URL.".into());
    }
    if trimmed.chars().any(char::is_whitespace) {
        return Err("That doesn't look like a valid URL.".into());
    }

    let candidate = if trimmed.contains("://") {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    };
    let mut parsed = tauri::Url::parse(&candidate)
        .map_err(|_| "That doesn't look like a valid URL.".to_string())?;

    let host = parsed.host_str().unwrap_or_default().to_string();
    if host.is_empty() {
        return Err("The URL needs a host, for example https://example.com.".into());
    }
    match parsed.scheme() {
        "https" => {}
        "http" => {
            if host != "localhost" && host != "127.0.0.1" {
                return Err(
                    "Plain HTTP is only allowed for localhost. Use https:// for a public site."
                        .into(),
                );
            }
        }
        other => return Err(format!("Unsupported URL scheme: {other}")),
    }

    parsed.set_query(None);
    parsed.set_fragment(None);

    let origin = parsed.origin().ascii_serialization();
    if origin == "null" {
        return Err("That doesn't look like a valid URL.".into());
    }

    // Accept pasted admin URLs by dropping a trailing `/ghost` or
    // `/ghost/api/admin` path, but keep genuine subdirectory installs.
    let mut path = parsed.path().trim_end_matches('/').to_string();
    for suffix in ["/ghost/api/admin", "/ghost"] {
        if path.ends_with(suffix) {
            path.truncate(path.len() - suffix.len());
            break;
        }
    }

    let base = format!("{origin}{path}");
    Ok((base, origin))
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .cookie_store(true)
        .timeout(HTTP_TIMEOUT)
        .user_agent(format!("Geist/{}", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| format!("Could not prepare the sign-in request: {error}"))
}

/// Adds the headers Ghost requires on admin session calls.
fn session_request(
    request: reqwest::RequestBuilder,
    base: &str,
    origin: &str,
) -> reqwest::RequestBuilder {
    request
        .header(ORIGIN, origin)
        .header(REFERER, format!("{base}/ghost/"))
        .header(ACCEPT, "application/json")
        .header(CONTENT_TYPE, "application/json")
}

fn network_error(error: reqwest::Error) -> String {
    if error.is_timeout() {
        "Your Ghost site took too long to respond. Check the URL and try again.".into()
    } else if error.is_connect() {
        "Could not reach your Ghost site. Check the URL and your connection.".into()
    } else {
        format!("Could not talk to your Ghost site: {error}")
    }
}

/// Pulls Ghost's human-readable error out of an API error response.
fn ghost_error_message(status: reqwest::StatusCode, body: &str) -> String {
    if let Ok(json) = serde_json::from_str::<serde_json::Value>(body)
        && let Some(error) = json
            .get("errors")
            .and_then(|errors| errors.as_array())
            .and_then(|errors| errors.first())
    {
        for field in ["message", "context"] {
            if let Some(text) = error.get(field).and_then(|value| value.as_str()) {
                let text = text.trim();
                if !text.is_empty() {
                    return text.to_string();
                }
            }
        }
    }

    match status {
        reqwest::StatusCode::UNAUTHORIZED => "Incorrect email or password.".into(),
        reqwest::StatusCode::NOT_FOUND => "Could not find the Ghost Admin API at that URL.".into(),
        reqwest::StatusCode::TOO_MANY_REQUESTS => {
            "Too many attempts. Please wait a minute and try again.".into()
        }
        reqwest::StatusCode::UNPROCESSABLE_ENTITY => {
            "Ghost rejected that sign-in. Check your details and try again.".into()
        }
        _ => {
            let body: String = body.trim().chars().take(300).collect();
            if body.is_empty() {
                format!("Ghost returned an unexpected error ({status}).")
            } else {
                format!("Ghost returned an unexpected error ({status}): {body}")
            }
        }
    }
}

fn requires_2fa(body: &str) -> bool {
    [
        "2FA_TOKEN_REQUIRED",
        "2FA_NEW_DEVICE_DETECTED",
        "Needs2FAError",
    ]
    .iter()
    .any(|marker| body.contains(marker))
}

fn parse_staff_key(body: &str) -> Result<(String, String), String> {
    let json: serde_json::Value = serde_json::from_str(body).map_err(|_| {
        "Ghost returned an unexpected response while fetching the Staff Access Token.".to_string()
    })?;
    let api_key = json.get("apiKey").ok_or_else(|| {
        "Ghost did not return a Staff Access Token. This account may not have staff access."
            .to_string()
    })?;
    let id = api_key
        .get("id")
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .trim()
        .to_string();
    let secret = api_key
        .get("secret")
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .trim()
        .to_string();
    if id.is_empty() || secret.is_empty() || hex::decode(&secret).is_err() {
        return Err("Ghost returned a malformed Staff Access Token.".into());
    }
    Ok((id, secret))
}

/// Persists the Staff Access Token in the Keychain under `app.geist` / `base`,
/// the same account `save_key` writes and `read_stored_key`/`get_jwt` read.
fn store_staff_key(base: &str, key: &str) -> Result<(), String> {
    entry(base)?.set_password(key).map_err(|error| {
        format!("Could not save the Staff Access Token to the Keychain: {error}")
    })
}

async fn fetch_staff_token(
    client: &reqwest::Client,
    base: &str,
    origin: &str,
) -> Result<(String, String), String> {
    let response = session_request(
        client.get(format!("{base}/ghost/api/admin/users/me/token/")),
        base,
        origin,
    )
    .send()
    .await
    .map_err(network_error)?;

    let status = response.status();
    let body = response.text().await.map_err(network_error)?;
    if !status.is_success() {
        return Err(ghost_error_message(status, &body));
    }
    parse_staff_key(&body)
}

/// Best-effort session teardown; the cookie jar is discarded right afterwards.
async fn end_session(client: &reqwest::Client, base: &str, origin: &str) {
    let _ = session_request(
        client.delete(format!("{base}/ghost/api/admin/session/")),
        base,
        origin,
    )
    .send()
    .await;
}

fn success_result(id: String) -> LoginResult {
    LoginResult::Success {
        key_kind: STAFF_KEY.to_string(),
        staff_id: id,
    }
}

/// Signs in with a Ghost account password, returning either a stored Staff
/// Access Token or a pending 2FA challenge.
#[tauri::command]
async fn login_with_password(
    store: tauri::State<'_, PendingLoginStore>,
    url: String,
    email: String,
    password: String,
) -> Result<LoginResult, String> {
    let (base, origin) = normalize_base_url(&url)?;
    let email = email.trim().to_string();
    if email.is_empty() {
        return Err("Enter the email address for your Ghost account.".into());
    }
    if password.is_empty() {
        return Err("Enter your Ghost password.".into());
    }

    let client = http_client()?;
    let response = session_request(
        client.post(format!("{base}/ghost/api/admin/session/")),
        &base,
        &origin,
    )
    .json(&serde_json::json!({ "username": email, "password": password }))
    .send()
    .await
    .map_err(network_error)?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.map_err(network_error)?;
        if status == reqwest::StatusCode::FORBIDDEN && requires_2fa(&body) {
            let pending_id = uuid::Uuid::new_v4().simple().to_string();
            let login = PendingLogin {
                session_id: pending_id.clone(),
                client,
                base_url: base,
                origin,
                email: email.clone(),
                expires_at: Instant::now() + Duration::from_secs(PENDING_LOGIN_TTL_SECS),
            };
            let message = login.needs_2fa_message();
            store.insert(login);
            return Ok(LoginResult::Needs2FA {
                pending_id,
                email,
                message,
            });
        }
        return Err(ghost_error_message(status, &body));
    }

    let fetched = fetch_staff_token(&client, &base, &origin).await;
    // Always tear the Ghost session down, even if the token fetch failed.
    end_session(&client, &base, &origin).await;
    let (id, secret) = fetched?;
    store_staff_key(&base, &format!("{id}:{secret}"))?;
    Ok(success_result(id))
}

/// Completes a 2FA challenge with the code emailed by Ghost.
#[tauri::command]
async fn verify_2fa_code(
    store: tauri::State<'_, PendingLoginStore>,
    pending_id: String,
    code: String,
) -> Result<LoginResult, String> {
    let code = code.trim().to_string();
    if code.is_empty() {
        return Err("Enter the verification code from your email.".into());
    }

    let pending = store
        .get(&pending_id)
        .ok_or_else(|| "That sign-in attempt expired. Please start again.".to_string())?;

    let response = session_request(
        pending.client.put(format!(
            "{}/ghost/api/admin/session/verify/",
            pending.base_url
        )),
        &pending.base_url,
        &pending.origin,
    )
    .json(&serde_json::json!({ "token": code }))
    .send()
    .await
    .map_err(network_error)?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.map_err(network_error)?;
        if status == reqwest::StatusCode::UNAUTHORIZED {
            return Err("Invalid verification code. Please check your email and try again.".into());
        }
        return Err(ghost_error_message(status, &body));
    }

    let fetched = fetch_staff_token(&pending.client, &pending.base_url, &pending.origin).await;
    // Always tear the Ghost session down, even if the token fetch failed.
    end_session(&pending.client, &pending.base_url, &pending.origin).await;
    store.remove(&pending_id);
    let (id, secret) = fetched?;
    store_staff_key(&pending.base_url, &format!("{id}:{secret}"))?;
    Ok(success_result(id))
}

/// Asks Ghost to email a fresh 2FA code for a pending sign-in.
#[tauri::command]
async fn resend_2fa_code(
    store: tauri::State<'_, PendingLoginStore>,
    pending_id: String,
) -> Result<(), String> {
    let mut pending = store
        .get(&pending_id)
        .ok_or_else(|| "That sign-in attempt expired. Please start again.".to_string())?;

    let response = session_request(
        pending.client.post(format!(
            "{}/ghost/api/admin/session/verify/",
            pending.base_url
        )),
        &pending.base_url,
        &pending.origin,
    )
    .json(&serde_json::json!({}))
    .send()
    .await
    .map_err(network_error)?;

    let status = response.status();
    if status.is_success() {
        // A resent code must not race the original ten-minute window.
        pending.expires_at = Instant::now() + Duration::from_secs(PENDING_LOGIN_TTL_SECS);
        store.insert(pending);
        return Ok(());
    }
    let body = response.text().await.map_err(network_error)?;
    Err(ghost_error_message(status, &body))
}

/// Rotates the stored Staff Access Token in place using a freshly minted JWT.
#[tauri::command]
async fn rotate_staff_token(base: String, clock_offset: Option<i64>) -> Result<String, String> {
    let (base, origin) = normalize_base_url(&base)?;
    let key = read_stored_key(&base)
        .map_err(|_| "Connect a staff account before rotating its token.".to_string())?;
    let jwt = mint(&key, clock_offset.unwrap_or(0))?;

    let client = http_client()?;
    let response = client
        .put(format!("{base}/ghost/api/admin/users/me/token/"))
        .header(ORIGIN, &origin)
        .header(REFERER, format!("{base}/ghost/"))
        .header(ACCEPT, "application/json")
        .header(AUTHORIZATION, format!("Ghost {jwt}"))
        .json(&serde_json::json!({}))
        .send()
        .await
        .map_err(network_error)?;

    let status = response.status();
    let body = response.text().await.map_err(network_error)?;
    if !status.is_success() {
        return Err(ghost_error_message(status, &body));
    }

    let (id, secret) = parse_staff_key(&body)?;
    store_staff_key(&base, &format!("{id}:{secret}"))?;
    Ok(id)
}

/// Validates that a preview URL is a safe remote URL (Rule 4.6):
/// only `https://` or loopback `http://localhost` / `http://127.0.0.1` are allowed.
/// Never allow `javascript:`, `data:`, `file:`, `tauri:`, or plain HTTP on public hosts.
pub fn validate_preview_url(raw: &str) -> Result<tauri::Url, String> {
    let parsed = tauri::Url::parse(raw).map_err(|e| format!("Invalid preview URL: {e}"))?;
    match parsed.scheme() {
        "https" => {
            if parsed.host_str().unwrap_or_default().is_empty() {
                return Err("Preview URL must include a host".into());
            }
            Ok(parsed)
        }
        "http" => {
            let host = parsed.host_str().unwrap_or_default();
            if host == "localhost" || host == "127.0.0.1" {
                Ok(parsed)
            } else {
                Err("Plain HTTP preview is only allowed on localhost".into())
            }
        }
        other => Err(format!("Unsupported preview URL scheme: {other}")),
    }
}

/// Builds the native macOS menu bar. Custom items emit their ids to the
/// webview through the `geist:menu` event (see `run`).
fn build_menu<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<tauri::menu::Menu<R>> {
    let geist = SubmenuBuilder::new(app, "Geist")
        .item(&PredefinedMenuItem::about(app, None, None)?)
        .separator()
        .item(&PredefinedMenuItem::services(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::hide(app, None)?)
        .item(&PredefinedMenuItem::hide_others(app, None)?)
        .item(&PredefinedMenuItem::show_all(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::quit(app, None)?)
        .build()?;

    let file = SubmenuBuilder::new(app, "File")
        .item(
            &MenuItemBuilder::with_id("menu-new-post", "New Post")
                .accelerator("CmdOrCtrl+N")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("menu-save-revision", "Save Revision")
                .accelerator("CmdOrCtrl+S")
                .build(app)?,
        )
        .separator()
        .item(&PredefinedMenuItem::close_window(app, None)?)
        .build()?;

    let edit = SubmenuBuilder::new(app, "Edit")
        .item(&PredefinedMenuItem::undo(app, None)?)
        .item(&PredefinedMenuItem::redo(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, None)?)
        .item(&PredefinedMenuItem::copy(app, None)?)
        .item(&PredefinedMenuItem::paste(app, None)?)
        .item(&PredefinedMenuItem::select_all(app, None)?)
        .build()?;

    let view = SubmenuBuilder::new(app, "View")
        .item(
            &MenuItemBuilder::with_id("menu-toggle-sidebar", "Toggle Sidebar")
                .accelerator("CmdOrCtrl+\\")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("menu-toggle-inspector", "Toggle Inspector")
                .accelerator("CmdOrCtrl+Alt+I")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("menu-cycle-theme", "Cycle Appearance")
                .accelerator("CmdOrCtrl+Shift+L")
                .build(app)?,
        )
        .separator()
        .item(&PredefinedMenuItem::fullscreen(app, None)?)
        .build()?;

    let window = SubmenuBuilder::new(app, "Window")
        .item(&PredefinedMenuItem::minimize(app, None)?)
        .item(&PredefinedMenuItem::maximize(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::close_window(app, None)?)
        .build()?;

    MenuBuilder::new(app)
        .items(&[&geist, &file, &edit, &view, &window])
        .build()
}

/// Opens or updates an isolated preview window loading the remote Ghost preview URL.
///
/// Safety rule 4.6: the preview window has label `"preview"`, which is NOT listed
/// in `capabilities/default.json` (`"windows": ["main"]`), so it gets zero Tauri
/// IPC permissions, and it loads the remote origin rather than `srcdoc`.
#[tauri::command]
fn open_preview_window(
    app: tauri::AppHandle,
    url: String,
    title: Option<String>,
) -> Result<(), String> {
    let parsed = validate_preview_url(&url)?;
    let window_title = match title.as_deref() {
        Some(t) if !t.trim().is_empty() => format!("Preview — {}", t.trim()),
        _ => "Geist Preview".to_string(),
    };

    if let Some(existing) = app.get_webview_window(PREVIEW_WINDOW_LABEL) {
        existing.navigate(parsed).map_err(|e| e.to_string())?;
        let _ = existing.set_title(&window_title);
        let _ = existing.show();
        let _ = existing.set_focus();
        return Ok(());
    }

    tauri::WebviewWindowBuilder::new(
        &app,
        PREVIEW_WINDOW_LABEL,
        tauri::WebviewUrl::External(parsed),
    )
    .title(&window_title)
    .inner_size(1040.0, 780.0)
    .min_inner_size(480.0, 360.0)
    // External preview pages keep the standard titlebar / window chrome.
    .title_bar_style(tauri::TitleBarStyle::Visible)
    .build()
    .map_err(|e| e.to_string())?;

    Ok(())
}

/// Mint a 5-minute Admin API token.
///
/// Public so the integration tests can exercise the exact code the app uses
/// rather than a copy of it.
pub fn mint(key: &str, offset: i64) -> Result<String, String> {
    let (id, secret_hex) = key.split_once(':').ok_or("bad key")?;
    let secret = hex::decode(secret_hex).map_err(|e| e.to_string())?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64
        + offset;
    let header = serde_json::json!({"alg": "HS256", "typ": "JWT", "kid": id});
    let payload = serde_json::json!({"iat": now, "exp": now + TOKEN_TTL_SECS, "aud": "/admin/"});
    let input = format!(
        "{}.{}",
        B64.encode(header.to_string()),
        B64.encode(payload.to_string())
    );
    let mut mac = Hmac::<Sha256>::new_from_slice(&secret).map_err(|e| e.to_string())?;
    mac.update(input.as_bytes());
    Ok(format!(
        "{input}.{}",
        B64.encode(mac.finalize().into_bytes())
    ))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .menu(|app| build_menu(app))
        .on_menu_event(|app, event| {
            let _ = app.emit("geist:menu", event.id().0.as_str());
        })
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(PendingLoginStore::default())
        .invoke_handler(tauri::generate_handler![
            save_key,
            delete_key,
            get_jwt,
            has_key,
            login_with_password,
            verify_2fa_code,
            resend_2fa_code,
            rotate_staff_token,
            open_preview_window
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::{
        LoginResult, PendingLogin, PendingLoginStore, mint, normalize_base_url, requires_2fa,
        validate_preview_url,
    };
    use std::time::{Duration, Instant};

    // Ghost's documented example key: https://ghost.org/docs/admin-api/
    const TEST_KEY: &str = "24f9c9b3d1:8e2b0c1f4a5d6e7f8a9b0c1d2e3f4a5b";

    #[test]
    fn mints_three_segments() {
        let jwt = mint(TEST_KEY, 0).unwrap();
        assert_eq!(jwt.split('.').count(), 3);
    }

    #[test]
    fn rejects_non_hex_secret() {
        assert!(mint("24f9c9b3d1:secret", 0).is_err());
    }

    #[test]
    fn rejects_key_without_colon() {
        assert!(mint("nocolon", 0).is_err());
    }

    #[test]
    fn header_carries_kid_and_hs256() {
        use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD as B64};
        let jwt = mint("24f9c9b3d1:deadbeef", 0).unwrap();
        let header = jwt.split('.').next().unwrap();
        let decoded = B64.decode(header).unwrap();
        let json: serde_json::Value = serde_json::from_slice(&decoded).unwrap();
        assert_eq!(json["alg"], "HS256");
        assert_eq!(json["typ"], "JWT");
        assert_eq!(json["kid"], "24f9c9b3d1");
    }

    #[test]
    fn clock_offset_moves_iat_and_exp() {
        use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD as B64};
        let jwt = mint("24f9c9b3d1:deadbeef", 3600).unwrap();
        let payload = jwt.split('.').nth(1).unwrap();
        let decoded = B64.decode(payload).unwrap();
        let json: serde_json::Value = serde_json::from_slice(&decoded).unwrap();
        assert_eq!(json["aud"], "/admin/");
        assert_eq!(
            json["exp"].as_i64().unwrap() - json["iat"].as_i64().unwrap(),
            300
        );
    }

    #[test]
    fn signature_is_deterministic() {
        assert_eq!(
            mint("a:deadbeef", 0).unwrap(),
            mint("a:deadbeef", 0).unwrap()
        );
    }

    #[test]
    fn preview_url_allows_https_and_loopback_http() {
        assert!(validate_preview_url("https://everywayhuman.com/p/1234/?member_status=free").is_ok());
        assert!(validate_preview_url("http://localhost:2368/p/1234/").is_ok());
        assert!(validate_preview_url("http://127.0.0.1:2368/p/1234/?member_status=paid").is_ok());
    }

    #[test]
    fn preview_url_rejects_unsafe_schemes_and_remote_http() {
        for bad in [
            "javascript:alert(1)",
            "data:text/html,<script>alert(1)</script>",
            "file:///etc/passwd",
            "tauri://localhost/index.html",
            "http://everywayhuman.com/p/1234/",
        ] {
            assert!(
                validate_preview_url(bad).is_err(),
                "expected {bad} to be rejected"
            );
        }
    }

    #[test]
    fn normalizes_site_urls_and_origins() {
        assert_eq!(
            normalize_base_url("example.com").unwrap(),
            (
                "https://example.com".to_string(),
                "https://example.com".to_string()
            )
        );
        assert_eq!(
            normalize_base_url("  https://example.com/  ").unwrap(),
            (
                "https://example.com".to_string(),
                "https://example.com".to_string()
            )
        );
        assert_eq!(
            normalize_base_url("http://localhost:2368").unwrap(),
            (
                "http://localhost:2368".to_string(),
                "http://localhost:2368".to_string()
            )
        );
        // Pasted admin URLs collapse back to the site root.
        assert_eq!(
            normalize_base_url("https://example.com/ghost/#/site").unwrap(),
            (
                "https://example.com".to_string(),
                "https://example.com".to_string()
            )
        );
        // Subdirectory installs are preserved.
        assert_eq!(
            normalize_base_url("https://example.com/blog/").unwrap(),
            (
                "https://example.com/blog".to_string(),
                "https://example.com".to_string()
            )
        );
    }

    #[test]
    fn rejects_unsafe_or_unsupported_site_urls() {
        for bad in [
            "",
            "   ",
            "ftp://example.com",
            "http://example.com",
            "not a url",
        ] {
            assert!(
                normalize_base_url(bad).is_err(),
                "expected {bad:?} to be rejected"
            );
        }
    }

    #[test]
    fn pending_logins_expire() {
        let store = PendingLoginStore::default();
        let client = reqwest::Client::builder()
            .cookie_store(true)
            .build()
            .unwrap();

        let pending_id = store.insert(PendingLogin {
            session_id: "live-session".into(),
            client: client.clone(),
            base_url: "https://example.com".into(),
            origin: "https://example.com".into(),
            email: "staff@example.com".into(),
            expires_at: Instant::now() + Duration::from_secs(60),
        });
        assert_eq!(pending_id, "live-session");
        let live = store.get(&pending_id).expect("pending login should exist");
        assert_eq!(live.email, "staff@example.com");
        assert_eq!(live.base_url, "https://example.com");
        assert_eq!(live.origin, "https://example.com");
        assert_eq!(live.session_id, "live-session");

        store.insert(PendingLogin {
            session_id: "stale-session".into(),
            client,
            base_url: "https://example.com".into(),
            origin: "https://example.com".into(),
            email: "staff@example.com".into(),
            expires_at: Instant::now() - Duration::from_secs(1),
        });
        assert!(store.get("stale-session").is_none());

        store.remove(&pending_id);
        assert!(store.get(&pending_id).is_none());
    }

    #[test]
    fn login_result_is_tagged_with_status() {
        let json = serde_json::to_value(LoginResult::Success {
            key_kind: "staff".into(),
            staff_id: "abc123".into(),
        })
        .unwrap();
        assert_eq!(json["status"], "Success");
        assert_eq!(json["key_kind"], "staff");
        assert_eq!(json["staff_id"], "abc123");

        let parsed: LoginResult = serde_json::from_value(serde_json::json!({
            "status": "Needs2FA",
            "pending_id": "p1",
            "email": "staff@example.com",
            "message": "Enter the code",
        }))
        .unwrap();
        assert_eq!(
            parsed,
            LoginResult::Needs2FA {
                pending_id: "p1".into(),
                email: "staff@example.com".into(),
                message: "Enter the code".into(),
            }
        );
    }

    #[test]
    fn detects_ghost_2fa_responses() {
        assert!(requires_2fa(
            r#"{"errors":[{"type":"Needs2FAError","code":"2FA_TOKEN_REQUIRED"}]}"#
        ));
        assert!(requires_2fa(
            r#"{"errors":[{"code":"2FA_NEW_DEVICE_DETECTED"}]}"#
        ));
        assert!(!requires_2fa(
            r#"{"errors":[{"message":"Your password is incorrect."}]}"#
        ));
    }

    /// Prints a token so an external harness can verify it with the same
    /// `jsonwebtoken` library Ghost uses. Run with `--nocapture`.
    #[test]
    fn emit_token_for_interop_check() {
        println!(
            "INTEROP_TOKEN={}",
            mint("24f9c9b3d1:8e2b0c1f4a5d6e7f8a9b0c1d2e3f4a5b", 0).unwrap()
        );
    }
}
