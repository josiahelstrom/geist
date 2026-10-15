# Geist

A macOS desktop app for writing, previewing and publishing posts on a Ghost site,
using a Staff Access Token or a Custom Integration Admin API key.

Ghost is a trademark of the Ghost Foundation. This project is not affiliated with or
endorsed by them, and contains no Ghost branding in its name, icon or bundle id
(`app.geist.desktop`).

## Requirements

- Node (managed with [fnm](https://github.com/Schniz/fnm))
- Rust 1.90+ (`rustup update`)
- Xcode command line tools

## Running it

```bash
npm install
npm run app          # NOT `npm run tauri dev` -- see below
```

Use **`npm run app`**, not `npm run tauri dev`. `tauri dev` always ad-hoc signs the
debug binary, and macOS ties Keychain access to an ad-hoc signature's cdhash, which
changes on every rebuild. `scripts/dev.sh` signs the binary with your Apple
Development identity under a stable identifier instead, so the Keychain prompt
happens once and "Always Allow" sticks.

Override the signing identity with `GEIST_SIGN_IDENTITY` if yours differs.

## Checks

```bash
npm run check        # tsc --noEmit + 68 unit tests
npm run test:rust    # keyring round-trip, HTTP scope, preview URL guard, JWT minting
```

End-to-end auth tests run against a real site. Credentials come from the environment
and are never committed:

```bash
DRAFTDESK_TEST_BASE=https://your-site.com \
DRAFTDESK_TEST_KEY=id:hex \
  cargo test --manifest-path src-tauri/Cargo.toml --test e2e_admin -- --test-threads=1
```

## Building

```bash
npm run tauri build
```

The `.app` and `.dmg` land in:
- `src-tauri/target/release/bundle/macos/Geist.app`
- `src-tauri/target/release/bundle/dmg/Geist_0.2.0_aarch64.dmg`

## How it works

The long-lived Admin API key never leaves Rust. It is stored in the macOS Keychain
(`app.geist`, with automatic migration fallback from `app.draftdesk`) and used only
to mint 5-minute HS256 tokens, which is all the webview ever sees. Site metadata is
persisted via `tauri-plugin-store` (`geist-sites.json`). All network access goes
through `tauri-plugin-http`, which runs in Rust and so is not subject to CORS.

Deliberate safety rules, each covered by a test:

- Publishing changes `status` only. A `newsletter` or `email_segment` parameter would
  email every subscriber, so it is never sent.
- Saves never include `html` and never use `?source=html`; Ghost would overwrite the
  Lexical document with a lossy HTML conversion.
- One save is in flight at a time, each carries the last `updated_at` the server sent,
  and a `409` pauses autosaving with options to either reload the server version or
  overwrite with your local edits.
- Authenticated requests never follow redirects, so auth cannot be silently dropped.
- Preview opens either in the system browser or in an isolated external-origin
  `WebviewWindow` (`preview` label, excluded from `capabilities/default.json`) with
  `?member_status=anonymous|free|paid` tier toggles. Site and theme HTML is never
  rendered inside the app's origin.
