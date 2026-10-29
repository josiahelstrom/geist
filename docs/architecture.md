# Geist — Architecture

The living reference for how Geist is built and where it is going. This document covers
**current and future active context only**. The full historical design record — weekend
build plan, verified Ghost behaviours, corrections found while building — is preserved at
[`docs/ghost-desktop-editor.md.bak`](./ghost-desktop-editor.md.bak).

---

## Product Identity

**Geist** is a native macOS desktop editor for Ghost publications.

| | |
|---|---|
| App / product name | Geist |
| Bundle ID | `app.geist.desktop` |
| Platform | macOS (native Tauri v2 shell) |
| Supported Ghost | 5.0 – 6.68 |
| Editor | `@tryghost/koenig-lexical` (pinned 1.11.1) |
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

`MIN_GHOST = 5.0`, `MAX_GHOST = 6.68` (`src/lib/version.ts`), matched to the bundled
Koenig build.

| Site version | Behaviour |
|---|---|
| `< 5.0` | Warning banner; new card types may not render |
| `5.0 – 6.68` | Editable |
| `> 6.68` | **Enforced read-only**, with an explicit per-site user override |
| Unknown | Editable, with a warning banner |

Posts containing unknown Lexical node types fail gracefully into an error boundary with an
"Open in Ghost Admin ↗" fallback. Koenig is pinned to an exact version, never a caret range.

---

## Current Technical Architecture

### Frontend

React 18.3 + TypeScript + Vite, rendered inside the Tauri webview.

| Area | Location |
|---|---|
| Editor canvas | `@tryghost/koenig-lexical` 1.11.1 (`KoenigComposer` / `KoenigEditor`) |
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

---

## Official Version Roadmap

| Version | Status | Scope |
|---|---|---|
| `v0.1.0` – `v0.4.0` | **Shipped** | Core editor, metadata sidebar, cards parity, theming, publishing/scheduling modal, newsletter safety gate, post visibility/tiers, revisions drawer |
| `v0.5.0 Native` | **Shipped** | Full macOS design system, 3-pane rail, borderless canvas, Koenig retheme |
| `v0.6.0 Auth` | **Shipped** | Password login in Rust, session cookie, 2FA verification code, Staff Access Token auto-retrieval, token rotation |
| `v0.7.0 Scraps` | **Next Up** | Local-first private scratchpad in `tauri-plugin-store`, Promote to Draft, Demote to Scrap, zero server leakage |
| `v0.8.0 Feature Complete` | Planned | Offline draft cache, local autosave queue, edge-case hardening |
| `v1.0.0-rc.1 Release Candidate` | Planned | Apple code signing & notarization, `tauri-plugin-updater` with GitHub Releases, DMG & Windows installers |
| `v1.0.0 General Availability` | Planned | First official public release |

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

**v0.7.0 Scraps.** A local-first private scratchpad stored purely in `tauri-plugin-store`
— offline, instant, never uploaded and never visible to other publication staff.
**Promote to Draft** creates a Ghost draft from a scrap and opens it in the editor.
**Demote to Scrap** backs up a draft locally, confirms, then deletes the server copy.
Scraps live in `NavigationRail` with local search, word count and last-edited timestamps.

**v0.8.0 Feature Complete.** Offline draft cache, a durable local autosave queue that
replays on reconnect, and hardening of remaining edge cases (large media, long sessions,
version drift).

**v1.0.0-rc.1.** Apple Developer ID signing and notarization, `tauri-plugin-updater`
backed by GitHub Releases, DMG packaging, and Windows installer groundwork.

**v1.0.0 GA.** First official public release.
