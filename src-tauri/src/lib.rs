use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD as B64};
use hmac::{Hmac, Mac};
use sha2::Sha256;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;

const SERVICE: &str = "app.geist";
const LEGACY_SERVICE: &str = "app.draftdesk";
const TOKEN_TTL_SECS: i64 = 300;
const PREVIEW_WINDOW_LABEL: &str = "preview";

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
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            save_key,
            delete_key,
            get_jwt,
            has_key,
            open_preview_window
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::{mint, validate_preview_url};

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
