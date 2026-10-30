# Geist

A macOS desktop app for writing, previewing and publishing posts on a Ghost site,
using a Staff Access Token, a password sign-in that retrieves one automatically, or a
Custom Integration Admin API key.

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
npm run check        # tsc --noEmit + 217 frontend tests
npm run test:rust    # 29 Rust tests: keyring round-trip, HTTP scope, preview URL guard,
                     # JWT minting, staff login/2FA handling
```

End-to-end auth tests run against a real site. Credentials come from the environment
and are never committed:

```bash
GEIST_TEST_BASE=https://your-site.com \
GEIST_TEST_KEY=id:hex \
  cargo test --manifest-path src-tauri/Cargo.toml --test e2e_admin -- --test-threads=1
```

## Building

```bash
TAURI_SIGNING_PRIVATE_KEY=~/.tauri/geist.key npm run tauri build
```

`bundle.createUpdaterArtifacts` is enabled, so the build always signs the updater
archive: a plain `npm run tauri build` fails at the signing step with "A public key
has been found, but no private key."

The `.app`, updater archive and `.dmg` land in:
- `src-tauri/target/release/bundle/macos/Geist.app`
- `src-tauri/target/release/bundle/macos/Geist.app.tar.gz` (plus `.sig`)
- `src-tauri/target/release/bundle/dmg/Geist_1.0.0-rc.1_aarch64.dmg`

Release builds are signed with an Apple Developer ID certificate, notarized, and
carry the updater signature. The key, the required GitHub secrets and the tag
flow are documented in [`docs/releasing.md`](./docs/releasing.md).

## How it works

The long-lived Admin API key never leaves Rust. It is stored in the macOS Keychain
(`app.geist`, with automatic migration fallback from `app.draftdesk`) and used only
to mint 5-minute HS256 tokens, which is all the webview ever sees. A Staff Access
Token obtained by password sign-in is stored the same way, under account `staff`.
Site metadata is
persisted via `tauri-plugin-store` (`geist-sites.json`). All network access goes
through `tauri-plugin-http`, which runs in Rust and so is not subject to CORS.

Deliberate safety rules, each covered by a test:

- Publishing is web-only by default. `setPostStatus` changes `status` only, with zero
  newsletter parameters. Newsletter delivery (`publishWithNewsletter`) is sent only when
  you explicitly choose it in the Publish modal, and it is confirmed with the newsletter
  name, the audience segment and the active member recipient count.
- Scheduling sets `status: "scheduled"` with a future `published_at`; unscheduling
  returns the post to draft. Post access is set through `visibility` (`public`,
  `members`, `paid`, `tiers`) with paid tier selection. The Post History revisions
  drawer loads `post_revisions`, previews each saved title, excerpt and Lexical plain
  text, and restores any revision into the editor as a new revision.
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
- Ghost version compatibility is checked before editing. Below `MIN_GHOST` (`5.0`)
  the app warns; above `MAX_GHOST` (`6.68`) the post is opened **read-only** unless you
  explicitly override, because newer Ghost card schemas could be lost on save. If a post
  contains an unknown Lexical node, an error boundary catches it and offers
  "Open in Ghost Admin ↗" instead of blanking the editor.

v1.0.0-rc.1 "Release Candidate" makes Geist installable and self-updating. macOS
builds are signed with an Apple Developer ID certificate and notarized, so they launch
without Gatekeeper warnings, and ship as a DMG plus a signed updater archive. Installed
apps poll the GitHub Releases `latest.json` manifest and update themselves in place
through `tauri-plugin-updater` and `tauri-plugin-process`; updates are verified against
the public key embedded in the bundle. Windows builds use WebView2. Releases are built
by `.github/workflows/release.yml` from a `v*` tag; keys, secrets and the tag flow are
in [`docs/releasing.md`](./docs/releasing.md). The RC is published as a normal
(non-prerelease) GitHub Release so `releases/latest/download/latest.json` resolves and
installed builds can update; `v1.0.0-rc.1` is an RC by version number and by the
`releaseDraft` gate, not by GitHub's prerelease flag.

v0.8.1 "Maintenance" hardens edge cases identified during wide-level code review.
Conflict resolution preserves edits typed while the 409 collision banner is displayed;
scrap mode intercepts window close requests to prompt and flush unsaved local edits;
the native titlebar mirrors live save status for scraps as well as posts; promote-to-draft
safely reuses existing drafts across retries to prevent duplicate posts on Ghost;
forgetting a publication purges its cached drafts and scraps cleanly from disk; and
external opener actions safely suppress unhandled rejections.

v0.8.0 "Feature Complete" makes the editor resilient to losing the network. Every
post you open is kept in a local draft cache (`draft_cache.json` via
`tauri-plugin-store`, scoped per publication) so it can be reopened and edited while
offline, with a banner showing when the cached copy was taken. When a save fails
because Ghost cannot be reached, the single-flight saver keeps your edits, reports
`status: "offline"`, and writes the still-unsaved patch to the cache instead of
discarding it. On reconnect the app replays any dirty patches automatically; a `409`
still halts the saver rather than clobbering the server copy. This milestone completes
the feature set; `v1.0.0-rc.1` followed with Apple code signing, notarization, the
auto-updater and packaging.

v0.7.0 "Scraps" adds a local-first private scratchpad. A scrap is a note that lives
only on this Mac: it is written to `scraps.json` through `tauri-plugin-store`, keyed per
publication, with no Ghost API call on create, edit or delete — so it works offline,
responds instantly, and is never visible to other staff on the site. The Scraps list in
the navigation rail sorts newest-updated first and supports local search across title,
body text and excerpt, with a live word count and last-edited timestamp per scrap.
**Promote to Draft** creates a Ghost draft from the scrap and opens it in the editor
(the local copy is removed by default, or kept and linked through `promotedPostId`).
**Demote to Scrap** backs up a draft locally, confirms, then deletes the server copy —
and refuses to run on published or scheduled posts, since those have already reached, or
are queued for, readers. Scrap content never leaves the machine until you promote it.

v0.6.0 "Auth" adds password sign-in. Connecting with your Ghost staff email and
password runs entirely in Rust: the password is posted to
`/ghost/api/admin/session/` with the site's own `Origin` header (Ghost rejects the
request otherwise), is never written to disk, the webview store or a log, and is
dropped as soon as the request completes. Accounts with two-factor authentication
enabled get a verification-code step, completed with
`/ghost/api/admin/session/verify/`; the session cookie lives only in an in-memory
cookie jar and expires after ten minutes. On success the app retrieves the site's
Staff Access Token via `GET /users/me/token/`, stores it automatically in the macOS
Keychain under `app.geist` (account `staff`), and tears the session down — so later
launches never ask for the password. The stored token can be rotated in place with
`PUT /users/me/token/`, which writes the new secret straight back to the Keychain.
Connecting with a Staff Access Token or a Custom Integration key still works as
before.

v0.5.0 "Native" rebuilds the shell around macOS: a vibrancy-backed window with an
overlay title bar (hidden title, inset traffic lights), a native menu bar
(Geist/File/Edit/View/Window) whose commands are routed into the UI, and a three-pane
layout of navigation rail, post list and inspector — each pane collapsible from the title
bar or with `Cmd+\`, `Cmd+Alt+I`, `Cmd+N` and `Cmd+S`. The editor canvas is borderless and
the Koenig typography, chrome and inspector are themed entirely by CSS tokens, with
system/light/dark appearance cycling from the title bar or `Cmd+Shift+L`.

v0.4.0 completed the publishing flow: web-only publishing by default, scheduled
publishing and unscheduling, post access with paid tiers, newsletter sending behind an
explicit confirmation that shows the recipient count, and a Post History revisions
drawer with restore. v0.3.0 had already closed the editor gap: full `cardConfig` parity
with Ghost Admin (`/settings/`, `/snippets/`, `/labels/`, link search/autocomplete,
Unsplash and Klipy GIF) and full media upload parity (`/images/`, `/media/`, `/file/`,
plus `mediaThumbnail`), with CSS token theming and dark/light mode.
