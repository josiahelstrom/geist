# Geist — Architecture

The living technical reference for how Geist is built and operates at 1.0.x. Geist is a native
macOS desktop editor (with Windows support via WebView2) for Ghost publications, providing
offline draft caching, private local scratchpads, Koenig editor parity, secure Keychain-backed
authentication, and in-app auto-updates. The full historical design record — weekend build plan,
verified Ghost behaviours, corrections found while building — is preserved at
[`docs/ghost-desktop-editor.md`](./ghost-desktop-editor.md).

---

## Product Identity

**Geist** is a native macOS desktop editor for Ghost publications.

| | |
|---|---|
| App / product name | Geist |
| Bundle ID | `app.geist.desktop` |
| Platform | macOS (native Tauri v2 shell); Windows build via WebView2 |
| Supported Ghost | 5.0 – 6.73 |
| Editor | `@tryghost/koenig-lexical` (pinned 1.13.1) |
| No Ghost branding | Ghost is a trademark; never place it in the name, icon or bundle id |

Geist talks to any Ghost site — self-hosted, Ghost(Pro), or OCI-hosted — through the Admin
API using a Staff Access Token or a Custom Integration key.

---

## Architectural Rules (Non-negotiables)

### Rule 1 — Single-flight saver with revision queuing

Exactly **one save request is in flight at a time**. Edits accumulate into a pending patch;
each request sends the last server `updated_at` and adopts the new one from the response.
`updated_at` is **never dropped** — without it Ghost cannot enforce
`409 UPDATE_COLLISION`, and a stale write silently clobbers another editor.

- A `Cmd+S` revision latch is held **inside** the run loop, not captured at call time, so a
  revision requested mid-save is never lost.
- On `409`: stop autosave and ask the user (reload server version or overwrite).
- Queuing must never drop edits: failed patches are merged back into pending.

### Rule 2 — Web-only publish is the default

Publishing changes `status` only. **No `newsletter` or `email_segment` parameters** are sent
unless the user explicitly opts into email delivery, and that path is gated behind a
confirmation dialog that **shows the recipient count**
(`GET /newsletters/?filter=status:active&include=count.active_members`). Newsletter sends
cannot be undone; treat the default as irreversible-action protection.

### Rule 3 — Native macOS WKWebView security

- The long-lived Admin API secret lives in the **macOS Keychain under service `app.geist`**
  and never leaves Rust. The webview only ever receives a 5-minute HS256 JWT.
- **Credentials are never stored** in the webview, in `localStorage`, in
  `tauri-plugin-store`, or on disk in plaintext. Passwords are never persisted at all.
- Preview renders in an **isolated `WebviewWindow`** (label `preview`) that loads the
  remote Ghost preview origin and is **not listed in the capability file**, so it has
  **zero Tauri IPC access**. No `srcdoc`, no `innerHTML` of theme output, no app-origin
  rendering of site HTML. URLs are validated (https, or http on loopback only).
- Authenticated API calls use `maxRedirections: 0`; redirects surface as a visible
  "site moved, reconnect" error instead of a silent auth drop.

### Rule 4 — Ghost version compatibility policy

`MIN_GHOST = 5.0`, `MAX_GHOST = 6.73` (`src/lib/version.ts`), matched to the bundled
Koenig build.

| Site version | Behaviour |
|---|---|
| `< 5.0` | Warning banner; new card types may not render |
| `5.0 – 6.73` | Editable |
| `> 6.73` | **Enforced read-only**, with an explicit per-site user override |
| Unknown | Editable, with a warning banner |

Posts containing unknown Lexical node types fail gracefully into an error boundary with an
"Open in Ghost Admin ↗" fallback. Koenig is pinned to an exact version, never a caret range.

---

## Current Technical Architecture

### Frontend

React 18.3 + TypeScript + Vite, rendered inside the Tauri webview.

| Area | Location |
|---|---|
| Editor canvas | `@tryghost/koenig-lexical` 1.13.1 (`KoenigComposer` / `KoenigEditor`) |
| App shell | `src/App.tsx`, `src/components/TitleBar.tsx`, `NavigationRail.tsx`, `PostList.tsx` |
| Metadata inspector | `src/components/MetadataSidebar.tsx` |
| Publishing | `src/components/PublishModal.tsx`, `src/lib/posts.ts` |
| Revisions | `src/components/RevisionsDrawer.tsx`, `src/lib/revisions.ts` |
| API / saver | `src/lib/api.ts`, `src/lib/version.ts`, `src/lib/cardConfig.ts`, `src/lib/uploader.ts` |

**Design system — CSS tokens.** All visual styling flows from `src/styles/tokens.css`
(colour, spacing, radius, type, elevation, motion), consumed in cascade order by:

```
tokens.css → base.css → chrome.css → sidebar.css → editor.css
           → inspector.css → modal.css → koenig.css
```

Components never hardcode colour or spacing values; they reference tokens. Theme is
system / dark / light via `src/lib/theme.ts`, applied as a data attribute on the document
root.

### Backend — Tauri v2 / Rust

A deliberately small Rust surface that exists for security and macOS integration only.
Business logic and API endpoints stay in TypeScript.

| Concern | Implementation |
|---|---|
| Keychain storage | `keyring` v4 (`apple-native-keyring-store`), service `app.geist`; read-path migration from legacy `app.draftdesk` |
| Token minting | `mint()` — HMAC-SHA256, `kid` = key id, `aud` = `/admin/`, 300 s TTL, hex-decoded secret, server-clock offset applied |
| Commands | `save_key`, `delete_key`, `has_key`, `get_jwt`, `open_preview_window` |
| Network | `tauri-plugin-http` (requests run in Rust, so CORS does not apply); `tauri-plugin-opener` for browser fallback |
| Persistence | `tauri-plugin-store` for non-secret site metadata (`geist-sites.json`) |
| macOS shell | Overlay titlebar (`titleBarStyle: "Overlay"`, hidden title, transparent) with sidebar vibrancy |
| Menu bridge | Native macOS menu bar built in Rust; custom item ids are emitted to the webview as the `geist:menu` event |

### Testing

| Command | Covers |
|---|---|
| `npm run check` | `tsc --noEmit` + Vitest |
| `npm run test:rust` | keyring round-trip, HTTP scope, JWT minting, preview URL validation |
| `cargo test --test e2e_admin` | keychain → mint → live Ghost request (env-provided credentials) |

Use `npm run app` (`scripts/dev.sh`), **not** `npm run tauri dev` — ad-hoc signing changes
the cdhash on every rebuild and breaks the Keychain ACL.

### Distribution & updates

| Concern | Implementation |
|---|---|
| macOS signing | Developer ID Application certificate when `APPLE_*` secrets are provisioned; otherwise ad-hoc (`signingIdentity: "-"`); hardened runtime |
| Notarization | Apple notary service via `APPLE_ID` / `APPLE_PASSWORD` (app-specific) / `APPLE_TEAM_ID`; not yet active — rc builds ship ad-hoc signed and un-notarized |
| Updater archive | `bundle.createUpdaterArtifacts` produces `Geist.app.tar.gz` plus a detached `.sig` |
| Update client | `tauri-plugin-updater` checks, downloads and verifies; `tauri-plugin-process` restarts |
| Manifest | `latest.json` merged per platform and uploaded to the GitHub Release by `tauri-action` |
| Endpoint | `https://github.com/josiahelstrom/geist/releases/latest/download/latest.json` |
| Trust anchor | `plugins.updater.pubkey` in `src-tauri/tauri.conf.json`; private key lives outside the repo |

`latest.json` is only served once a release is published — drafts are invisible to the
updater endpoint. The workflow sets `prerelease: false`: GitHub's `releases/latest`
excludes prereleases, so RC and GA both publish as regular releases, gated by draft
status.
The updater private key is never in the repository or the build output; it exists only
as the `TAURI_SIGNING_PRIVATE_KEY` secret and in the maintainer's password manager.

---

## Roadmap (Internal Planning)

*Note: This roadmap is internal planning context maintained for contributors and does not represent a delivery commitment.*

### Now
- **Public 1.1.0 release polish** — Complete documentation, release validation, and packaging verification for the broad public release.

### Next
- **Windows CI** — The Windows target is in the release matrix but never built or tested in CI.
- **CSS consolidation** — Migrate the legacy 861-line `src/App.css` into `src/styles/` and remove the doubled `.class.class` selectors.
- **Header bar consolidation** — Consolidate the two stacked 52px header bars into floating canvas pills.
- **Canvas layout stability** — Stop the canvas shifting ~160px when the inspector opens at 1440px.
- **Expand component test coverage** — Expand component test coverage beyond `PublishModal`.

### Later
- **Markdown-adjacent footnote syntax (`[^1]`)** — Syntax that serializes to Ghost's `<sup class="footnote-ref">` + `<section class="footnotes">` HTML without surfacing an HTML card in the editor (needs a custom Lexical node + serializer).
- **Dependency maintenance (track, do not schedule).** React 19 only when `@tryghost/koenig-lexical` compatibility is verified — Koenig is the largest surface and declares no React peer dependency. TypeScript 7 (the native `tsgo` compiler) once the Vite/plugin toolchain supports it; dev-only, no runtime risk, main benefit is faster typechecking.

---

## Version History

| Version | Status | Scope |
|---|---|---|
| `v0.1.0` – `v0.4.0` | **Shipped** | Core editor, metadata sidebar, cards parity, theming, publishing/scheduling modal, newsletter safety gate, post visibility/tiers, revisions drawer |
| `v0.5.0 Native` | **Shipped** | Full macOS design system, 3-pane rail, borderless canvas, Koenig retheme |
| `v0.6.0 Auth` | **Shipped** | Password login in Rust, session cookie, 2FA verification code, Staff Access Token auto-retrieval, token rotation |
| `v0.7.0 Scraps` | **Shipped** | Local-first private scratchpad in `tauri-plugin-store`, Promote to Draft, Demote to Scrap, zero server leakage |
| `v0.8.0 Feature Complete` | **Shipped** | Offline draft cache (`draft_cache.json`), `offline` save status, offline editing from cached copies, automatic replay of dirty patches on reconnect |
| `v0.8.1 Maintenance` | **Shipped** | Code review hardening: conflict overwrite preservation, scrap mode close guard, titlebar status mirror, promote idempotency, forget site cache purge |
| `v1.0.0 General Availability` | **Shipped** | First official public release with DMG & signed updater artifacts, Windows/WebView2 build, `tauri-plugin-updater` with GitHub Releases |
| `v1.1.0` | **Shipped / Current** | Editor refinements, bundled typography, WCAG AA contrast and focus management, offline/save reliability, security boundaries, CI checks and component tests |

### Milestone detail

**v0.1 – v0.4 (shipped).**
v0.1: connect with a Staff Access Token, list/create drafts, Koenig editing with uploads and
embeds, autosave + `Cmd+S` revisions, preview, web-only publish.
v0.2: metadata sidebar (feature image, slug, excerpt, tags, authors, featured), search and
filter, conflict/error UX, `tauri-plugin-store` site persistence, in-app preview window.
v0.3: full `cardConfig` parity, full media upload parity, CSS token theming with
system/dark/light, `MIN_GHOST`/`MAX_GHOST` policy.
v0.4: publish & schedule modal, guarded newsletter sending, post visibility and paid tiers,
revisions drawer with restore.

**v0.5.0 Native (shipped).** Native macOS design system per `docs/design-system.md`: real
vibrancy shell, native menu bar wiring, three-pane layout (rail / list / inspector),
borderless distraction-free editor canvas, and a Koenig typography and dark-mode retheme
driven entirely by CSS tokens.

**v0.6.0 Auth (shipped).** Password login executed in Rust: `POST /session/` with the site's own
`Origin`, session cookie held in Rust only, 2FA verification via `PUT /session/verify/`,
automatic Staff Access Token retrieval via `GET /users/me/token/`, and token rotation. The
password is never persisted; the cookie is discarded once a token is obtained.

**v0.7.0 Scraps (shipped).** A local-first private scratchpad stored purely in
`tauri-plugin-store` (`scraps.json`, keyed per publication) — offline, instant, never
uploaded and never visible to other publication staff. **Promote to Draft** creates a
Ghost draft from a scrap and opens it in the editor. **Demote to Scrap** backs up a draft
locally, confirms, then deletes the server copy, and only accepts posts still in `draft`
status. Scraps live in `NavigationRail` with local search, word count and last-edited
timestamps.

**v0.8.0 Feature Complete (shipped).** Offline resilience. Every opened post is written
to a local draft cache (`draft_cache.json` through `tauri-plugin-store`, keyed per
publication), so it can be reopened and edited offline from the cached copy. When a save
fails because the request never reached Ghost, the single-flight saver preserves the
pending patch, reports `status: "offline"`, and persists it with the cached draft.
Dirty patches are replayed automatically when the connection returns (`online` event);
a `409` still halts the saver. This completes the feature set.

**v0.8.1 Maintenance (shipped).** Edge-case hardening from wide-level code review: dirty
state typed during 409 collisions is preserved on overwrite; scrap mode prompts and
flushes on window close requests; titlebar save status mirrors local scraps; promote-to-draft
reuses existing drafts across retries to prevent duplicate Ghost posts; forgetting a site
purges its cached drafts and scraps from disk; and opener actions catch unhandled rejections.

**v1.0.0 GA (shipped).** First official public release. macOS bundles are ad-hoc signed
(`bundle.macOS.signingIdentity: "-"`) but not notarized yet, so first launch shows the
Gatekeeper "unverified developer" prompt (right-click → Open, or the
`xattr -dr com.apple.quarantine` workaround). Bundles ship as a DMG plus a signed updater
archive; Windows builds use WebView2. `tauri-plugin-updater` reads `latest.json` from
GitHub Releases and `tauri-plugin-process` restarts the app after an in-place install.
Releases are built by `.github/workflows/release.yml` on a `v*` tag and stay drafts
until verified. See [`releasing.md`](./releasing.md).

**v1.1.0 (current).** Removed the editor "Begin writing…" placeholder, wrapped
post titles across multiple lines in an auto-growing field, and widened the native
reading measure from 740px to 780px. Bundled Inter, Lora, and JetBrains Mono
(variable, upright + italic, OFL), added a body-font preference, and enabled typewriter
scrolling to keep the active line centered. Moved focus mode to `Cmd+Shift+F`,
made `Cmd+\` a dedicated navigation-rail toggle, and styled the titlebar and editor
header to share the canvas background in focus mode. Raised text contrast to WCAG
AA in both themes (fixing publish action and body links from 2.08:1), added visible
`:focus-visible` rings, added Escape dismiss, focus restore, and focus traps for the
inspector, revisions drawer, and token-rotation dialog, and added a scrim for the
overlay rail below 1120px. Fixed window-close "Cancel" destroying the window and
discarding unsaved work, remounted the editor on post switches, blocked publish if
the latest edits failed to save, opened dirty offline drafts with local edits visible,
capped the draft cache at 50 per site with dirty drafts never evicted, and prevented
secondary metadata loaders from raising unhandled rejections. Added a
Content-Security-Policy that blocks remote script execution, narrowed the opener
capability to `allow-open-url`, normalized Keychain account keys, bounded admin JWT
timestamp arithmetic, and added request timeouts. Configured CI to run `cargo clippy
-D warnings` and `cargo fmt --check`, set the release workflow to fail fast if the
git tag does not match the manifest versions, and added jsdom + React Testing
Library with the first component tests (`PublishModal`, close-guard).
