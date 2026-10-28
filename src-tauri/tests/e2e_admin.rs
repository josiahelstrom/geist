//! End-to-end check of the whole auth path: keychain -> mint -> HTTP -> Ghost.
//!
//! This is the one thing the browser harness cannot cover, because `invoke`
//! and the OS keychain only exist inside the Tauri runtime.
//!
//! Credentials come from the environment so they are never committed:
//!   GEIST_TEST_BASE=https://site.example  GEIST_TEST_KEY=id:hex
//! Tests skip when those are absent.

use geist_lib::mint;
use keyring::Entry;

const SERVICE: &str = "app.geist.e2e-test";

/// Credentials come from the environment; when they are absent these checks
/// are skipped rather than failing a plain `cargo test` run.
fn creds() -> Option<(String, String)> {
    let base = std::env::var("GEIST_TEST_BASE")
        .or_else(|_| std::env::var("DRAFTDESK_TEST_BASE"))
        .ok()?;
    let secret = std::env::var("GEIST_TEST_KEY")
        .or_else(|_| std::env::var("DRAFTDESK_TEST_KEY"))
        .ok()?;
    if base.trim().is_empty() || secret.trim().is_empty() {
        return None;
    }
    Some((base, secret))
}

#[tokio::test]
async fn stored_key_produces_a_token_the_server_accepts() {
    let Some((base, secret)) = creds() else { return; };

    // Write through the same keychain path the app uses.
    let entry = Entry::new(SERVICE, &base).expect("open keychain entry");
    entry.set_password(&secret).expect("store key");

    let read = Entry::new(SERVICE, &base)
        .expect("reopen entry")
        .get_password()
        .expect("read key back");

    let jwt = mint(&read, 0).expect("mint token");
    assert_eq!(jwt.split('.').count(), 3);

    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .expect("build client");

    let res = client
        .get(format!("{base}/ghost/api/admin/posts/?limit=1"))
        .header("Authorization", format!("Ghost {jwt}"))
        .header("Accept-Version", "v6.0")
        .send()
        .await
        .expect("send request");

    assert_eq!(
        res.status().as_u16(),
        200,
        "Ghost rejected the token we minted from the stored key"
    );

    let body: serde_json::Value = res.json().await.expect("parse response");
    assert!(
        body.get("posts").is_some(),
        "expected a posts array, got {body}"
    );

    let _ = Entry::new(SERVICE, &base).unwrap().delete_credential();
}

#[tokio::test]
async fn tampered_token_is_rejected_by_the_server() {
    let Some((base, secret)) = creds() else { return; };
    let jwt = mint(&secret, 0).expect("mint token");
    let mut bad = jwt.clone();
    let last = bad.pop().unwrap();
    bad.push(if last == 'A' { 'B' } else { 'A' });

    let client = reqwest::Client::new();
    let status = client
        .get(format!("{base}/ghost/api/admin/posts/?limit=1"))
        .header("Authorization", format!("Ghost {bad}"))
        .header("Accept-Version", "v6.0")
        .send()
        .await
        .expect("send request")
        .status();

    assert_eq!(status.as_u16(), 401, "server accepted a tampered token");
}

#[tokio::test]
async fn wrong_secret_is_rejected() {
    let Some((base, _secret)) = creds() else { return; };
    let forged = mint(&format!("deadbeef:{}", "00".repeat(32)), 0).expect("mint");

    let client = reqwest::Client::new();
    let status = client
        .get(format!("{base}/ghost/api/admin/posts/?limit=1"))
        .header("Authorization", format!("Ghost {forged}"))
        .header("Accept-Version", "v6.0")
        .send()
        .await
        .expect("send request")
        .status();

    assert_eq!(status.as_u16(), 401, "server accepted a forged key");
}

#[tokio::test]
async fn clock_offset_produces_a_valid_token() {
    // A server whose clock runs ahead is the §13 risk. Simulate a +60s offset
    // and confirm the server still accepts the token.
    let Some((base, secret)) = creds() else { return; };
    let jwt = mint(&secret, 60).expect("mint with offset");

    let client = reqwest::Client::new();
    let status = client
        .get(format!("{base}/ghost/api/admin/posts/?limit=1"))
        .header("Authorization", format!("Ghost {jwt}"))
        .header("Accept-Version", "v6.0")
        .send()
        .await
        .expect("send request")
        .status();

    assert_eq!(status.as_u16(), 200, "offset token rejected");
}

#[tokio::test]
async fn redirects_are_not_followed_so_auth_is_never_dropped() {
    // Rule 4.5: an authenticated call must surface a redirect as an error
    // rather than silently replaying the request without the header.
    let Some((base, _secret)) = creds() else { return; };
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .unwrap();

    let res = client
        .get(format!("{base}/ghost/api/admin/site/"))
        .send()
        .await
        .expect("probe");

    assert!(
        res.status().is_success(),
        "expected the admin base to answer directly, got {}",
        res.status()
    );
    assert!(
        res.headers().get("location").is_none(),
        "admin base redirects; reconnection would be required"
    );
}
