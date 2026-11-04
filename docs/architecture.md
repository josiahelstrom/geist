# Geist — Architecture

The living technical reference for how Geist is built and operates at `0.2.1`. Geist is a native
macOS desktop editor (with Windows support via WebView2) for Ghost publications, providing a
Markdown-first Lexical writing experience with 100% lossless Ghost card parity, offline draft
caching, private local scratchpads, secure Keychain-backed authentication, and in-app auto-updates.

---

## Product Identity

**Geist** is a native macOS desktop editor for Ghost publications.

| | |
|---|---|
| App / product name | Geist |
| Version | `0.2.1` |
| Bundle ID | `app.geist.desktop` |
| Platform | macOS (native Tauri v2 shell); Windows build via WebView2 |
| Supported Ghost | 5.0 – 6.73 |
| Default Editor Engine | Markdown-first Lexical (`src/components/lab/LexicalLabEditor.tsx`, Lexical 0.53) |
| Fallback Editor Engine | `@tryghost/koenig-lexical` (pinned 1.13.1, instant toggle via `⌥⌘E`) |
| No Ghost branding | Ghost is a trademark; never place it in the name, icon or bundle id |

Geist talks to any Ghost site — self-hosted, Ghost(Pro), or OCI-hosted — through the Admin
API using email/password login, a Staff Access Token, or a Custom Integration key.

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

`MIN_GHOST = 5.0`, `MAX_GHOST = 6.73` (`src/lib/version.ts`), matched to the supported
Ghost Lexical schema and bundled Koenig build.

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
| Primary editor (default) | `src/components/lab/LexicalLabEditor.tsx` (Markdown-first Lexical 0.53 engine) |
| Ghost card parity & nodes | `src/components/lab/nodes/GhostCardNode.tsx`, `FootnoteReferenceNode.tsx`, `ExtendedRichTextNodes.ts` |
| Editor plugins | `SlashMenuPlugin.tsx`, `SmartLinkPlugin.tsx`, `MediaDropPastePlugin.tsx`, `FloatingFormatToolbarPlugin.tsx`, `SmartTypographyPlugin.tsx`, `TKIndicatorPlugin.tsx` |
| Footnote serializer | `src/lib/footnoteSerializer.ts` (`[^1]` inline references ↔ Ghost `<sup class="footnote-ref">` & `<section class="footnotes">`) |
| Fallback Koenig canvas | `@tryghost/koenig-lexical` 1.13.1 (`KoenigComposer` / `KoenigEditor`, toggled via `⌥⌘E`) |
| App shell | `src/App.tsx`, `src/components/TitleBar.tsx`, `NavigationRail.tsx`, `PostList.tsx`, `Editor.tsx` |
| Metadata inspector | `src/components/MetadataSidebar.tsx` |
| Publishing | `src/components/PublishModal.tsx`, `src/lib/posts.ts` |
| Revisions | `src/components/RevisionsDrawer.tsx`, `src/lib/revisions.ts` |
| API / saver / cache | `src/lib/api.ts`, `src/lib/saver.ts`, `src/lib/draftCache.ts`, `src/lib/scraps.ts`, `src/lib/version.ts`, `src/lib/cardConfig.ts`, `src/lib/uploader.ts` |

#### Editor Engine (`LexicalLabEditor.tsx` + Koenig Fallback)

Geist `0.2.1` uses the **Markdown-first Lexical editor** (`src/components/lab/LexicalLabEditor.tsx`)
as its primary default writing engine, with instant, zero-loss switching (`⌥⌘E`) to Ghost's stock
`@tryghost/koenig-lexical` editor whenever desired:

- **100% Lossless 22-Card Koenig Parity (`GhostCardNode`)**: Preserves every native Ghost Lexical
  card type (`image`, `gallery`, `bookmark`, `callout`, `toggle`, `button`, `signup`,
  `call-to-action`, `paywall`, `audio`, `video`, `file`, `product`, `header`, `html`, `markdown`,
  `codeblock`, `embed`, `horizontalrule`, `email`, `email-cta`) and round-trips every Ghost
  `extended-text`, `extended-heading`, and `extended-quote` node without dropping attributes.
- **Slash Menu (`SlashMenuPlugin`)**: Typing `/` at the start of a line opens a keyboard-navigable
  fuzzy command menu for inserting any of the 22 Ghost cards or structural blocks.
- **Inline `[^1]` Footnotes (`FootnoteReferenceNode` + `footnoteSerializer`)**: Writers insert
  footnotes with `[^1]` syntax and edit rich footnote definitions in a dedicated bottom drawer.
  On save, `footnoteSerializer` compiles them to Ghost-compatible `<sup class="footnote-ref">`
  HTML nodes and a trailing `<section class="footnotes">` HTML card, and rehydrates them back into
  editable `FootnoteReferenceNode`s on load.
- **Smart Internal & External Linking (`SmartLinkPlugin`)**: Pasting a URL over selected text
  immediately creates a link; pressing `⌘K` or typing `[[` opens a post search popover to link
  directly to existing posts on the connected Ghost site.
- **Drag-and-Drop & Clipboard Media (`MediaDropPastePlugin`)**: Dropping or pasting image, audio,
  video, or attachment files uploads them to Ghost and inserts the corresponding native Ghost card.
- **Markdown Shortcuts, Smart Typography & `TK` Badges**: Live Markdown shortcuts (`#`, `>`, lists,
  `` `code` ``, `==highlight==`), typographic replacements (`—`, `–`, `…`), and `TK` "To-Come"
  margin badges.
- **Focus Mode & Typewriter Scrolling**: Focus mode (`⇧⌘F`) dims inactive paragraphs to keep
  attention on the active block (`data-focus-active="true"`) while Typewriter mode keeps the active
  line vertically centered.

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
| Staff password auth | Ephemeral in-memory session (`login_with_password`, `verify_2fa_code`, `resend_2fa_code`, `rotate_staff_token`) that exchanges email/password + 2FA for a Staff Access Token and immediately drops the session |
| Commands | `save_key`, `delete_key`, `has_key`, `get_jwt`, `login_with_password`, `verify_2fa_code`, `resend_2fa_code`, `rotate_staff_token`, `open_preview_window` |
| Network | `tauri-plugin-http` (requests run in Rust, so CORS does not apply); `tauri-plugin-opener` for browser fallback |
| Persistence | `tauri-plugin-store` for non-secret site metadata (`geist-sites.json`), local scraps (`scraps.json`), and offline draft cache (`draft_cache.json`) |
| macOS shell | Overlay titlebar (`titleBarStyle: "Overlay"`, hidden title, transparent) with sidebar vibrancy |
| Menu bridge | Native macOS menu bar built in Rust; custom item ids are emitted to the webview as the `geist:menu` event |

### Testing

| Command | Covers |
|---|---|
| `pnpm check` | `tsc --noEmit` + Vitest |
| `pnpm test:rust` | keyring round-trip, HTTP scope, JWT minting, preview URL validation, session auth helpers |
| `cargo test --test e2e_admin` | keychain → mint → live Ghost request (env-provided credentials) |

Use `pnpm app` (`scripts/dev.sh`) on macOS when `GEIST_SIGN_IDENTITY` is set to an Apple
Development certificate so Keychain ACLs remain stable across Rust rebuilds, or `pnpm tauri dev`
for standard development.

### Distribution & updates

| Concern | Implementation |
|---|---|
| macOS signing | Developer ID Application certificate when `APPLE_*` secrets are provisioned; otherwise ad-hoc (`signingIdentity: "-"`); hardened runtime |
| Notarization | Apple notary service via `APPLE_ID` / `APPLE_PASSWORD` (app-specific) / `APPLE_TEAM_ID`; builds without secrets ship ad-hoc signed and un-notarized |
| Updater archive | `bundle.createUpdaterArtifacts` produces `Geist.app.tar.gz` plus a detached `.sig` |
| Update client | `tauri-plugin-updater` checks, downloads and verifies; `tauri-plugin-process` restarts |
| Manifest | `latest.json` merged per platform and uploaded to the GitHub Release by `tauri-action` |
| Endpoint | `https://github.com/josiahelstrom/geist/releases/latest/download/latest.json` |
| Trust anchor | `plugins.updater.pubkey` in `src-tauri/tauri.conf.json`; private key lives outside the repo |

`latest.json` is only served once a release is published — drafts are invisible to the
updater endpoint. The workflow sets `prerelease: false` so GitHub's `releases/latest`
serves the latest published release.
The updater private key is never in the repository or the build output; it exists only
as the `TAURI_SIGNING_PRIVATE_KEY` secret and in the maintainer's password manager.

---

## Version History

| Version | Status | Scope |
|---|---|---|
| `v0.1.0` | **Shipped** | Initial Tauri v2 + Ghost Admin API foundation: Keychain JWT minting, single-flight saver, metadata sidebar, publish & schedule sheet with newsletter recipient gate, revisions drawer, native macOS vibrancy shell, email/password + 2FA login, local Scraps, and offline draft cache |
| `v0.2.0` | **Shipped** | Custom Markdown-first Lexical editor (`LexicalLabEditor`) promoted to primary default engine with 22-card Ghost parity (`GhostCardNode`), `/` slash menu, `[^1]` inline footnotes + bottom drawer (`footnoteSerializer`), `⌘K` / `[[` internal post linking, media drag-and-drop, `TK` badges, Focus Mode paragraph dimming, and `⌥⌘E` Koenig toggle |
| `v0.2.1` | **Current** | Public repository polish, documentation overhaul, and privacy scrubbing for the `0.2.1` release |
