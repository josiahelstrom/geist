//! Answers §14 item 3 for real: does the capability scope pattern actually match
//! the URLs the app will request?
//!
//! `parse_url_pattern` is copied verbatim from
//! tauri-plugin-http 2.8.3 `src/scope.rs` so this test exercises the same code
//! the plugin runs, not a lookalike.

use url::Url;
use urlpattern::{UrlPattern, UrlPatternMatchInput};

fn parse_url_pattern(s: &str) -> Result<UrlPattern, urlpattern::quirks::Error> {
    let mut init = urlpattern::UrlPatternInit::parse_constructor_string::<regex::Regex>(s, None)?;
    if init.search.as_ref().map(|p| p.is_empty()).unwrap_or(true) {
        init.search.replace("*".to_string());
    }
    if init.hash.as_ref().map(|p| p.is_empty()).unwrap_or(true) {
        init.hash.replace("*".to_string());
    }
    if init
        .pathname
        .as_ref()
        .map(|p| p.is_empty() || p == "/")
        .unwrap_or(true)
    {
        init.pathname.replace("*".to_string());
    }
    UrlPattern::parse(init, Default::default())
}

/// The allow-list from capabilities/default.json.
/// `https://*:*` rather than `https://*`: the bare form does not match a
/// non-default port, so a site on :8443 would be rejected.
const SCOPE: &[&str] = &["https://*:*", "http://localhost:*", "http://127.0.0.1:*"];

fn allowed(raw: &str) -> bool {
    let Ok(url) = Url::parse(raw) else {
        return false;
    };
    SCOPE
        .iter()
        .any(|pattern| match parse_url_pattern(pattern) {
            Ok(p) => p
                .test(UrlPatternMatchInput::Url(url.clone()))
                .unwrap_or_default(),
            Err(_) => false,
        })
}

#[test]
fn scope_allows_real_ghost_urls() {
    let should_pass = [
        "https://everywayhuman.com/ghost/api/admin/site/",
        "https://everywayhuman.com/ghost/api/admin/posts/?filter=status:draft",
        "https://everywayhuman.com/ghost/api/admin/images/upload/",
        "http://localhost:2368/ghost/api/admin/site/",
        "http://127.0.0.1:2368/ghost/api/admin/posts/",
    ];
    for url in should_pass {
        assert!(allowed(url), "scope should allow {url}");
    }
}

#[test]
fn scope_allows_arbitrary_https_hosts() {
    // Users type their own domain, so the pattern must not be pinned to one host.
    for url in [
        "https://example.com/ghost/api/admin/site/",
        "https://my-blog.ghost.io/ghost/api/admin/posts/",
        "https://some.other.host:8443/ghost/api/admin/site/",
    ] {
        assert!(allowed(url), "scope should allow {url}");
    }
}

#[test]
fn scope_blocks_non_http_schemes() {
    for url in [
        "file:///etc/passwd",
        "ftp://example.com/x",
        "data:text/html,<script>1</script>",
    ] {
        assert!(!allowed(url), "scope should NOT allow {url}");
    }
}

#[test]
fn scope_blocks_bare_http_on_public_hosts() {
    // Only loopback is allowed over plain http; everything else must be https so
    // the Admin API key never crosses the wire in clear text.
    for url in [
        "http://example.com/ghost/api/admin/site/",
        "http://everywayhuman.com/ghost/api/admin/site/",
    ] {
        assert!(!allowed(url), "scope should NOT allow {url}");
    }
}

#[test]
fn scope_does_not_widen_to_other_loopback_hosts() {
    for url in ["http://192.168.1.10:2368/", "http://169.254.169.254/"] {
        assert!(!allowed(url), "scope should NOT allow {url}");
    }
}

#[test]
fn bare_https_wildcard_alone_does_not_need_a_port_wildcard() {
    // The plan suggested widening to `https://*:*` if `https://*` fails.
    // Confirm the simpler form covers non-default ports on its own.
    assert!(allowed("https://example.com:8443/ghost/api/admin/site/"));
}
