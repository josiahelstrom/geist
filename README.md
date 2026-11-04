# Geist

**A calm, native-feeling desktop writing app for Ghost publications.**

Geist (`v0.2.1`) pairs a lightweight Tauri v2 + Rust backend (macOS Keychain security, native menu bar, zero-CORS background networking) with a fast, Markdown-first Lexical writing canvas that speaks Ghost's native Lexical format with 100% lossless card parity.

Geist runs on macOS 11+ (Apple Silicon and Intel) and, in theory, Windows 10/11 via WebView2 but I cannot test.

> *Ghost is a trademark of the Ghost Foundation. Geist is an independent project, is not affiliated with or endorsed by the Ghost Foundation, and contains no Ghost branding in its name, icon, or bundle identifier (`app.geist.desktop`).*

---

## Why Geist Exists

If you publish on Ghost and care about your writing environment, you quickly run into an uncomfortable gap.

Dedicated Markdown apps like **Ulysses** and **iA Writer** are wonderful for plain prose, but I find that Ulysses can feel visually cluttered and opinionated in all the wrong places, while iA Writer has no concept of Ghost's 22 native cards—callouts, bookmarks, galleries, toggles, signup forms, paywalls, or rich embeds. On the other hand, writing directly inside **Ghost Admin** means living inside a web browser tab (or a sluggish browser-wrapped PWA), one `⌘T` away from a dozen distractions, with no true offline scratchpad and no native Markdown-first flow for things like `[^1]` footnotes or `[[` internal post links.

Geist started as a weekend experiment: a thin Tauri wrapper around Ghost's stock Koenig editor so I could write outside the browser. Very quickly, it grew into something much more deliberate:

1. **A Rust security boundary** that signs in with your Ghost email and password (including 2FA), retrieves a Staff Access Token, locks it in the macOS Keychain, and mints short-lived 5-minute JWTs in memory.
2. **Local-first Scraps and offline caching**, so half-baked ideas stay private on your Mac until you promote them to a Ghost draft, and flaky Wi-Fi never costs you a paragraph.
3. **A custom Markdown-first Lexical editor** designed specifically for long-form writers—supporting instant `#` headings, `==highlights==`, `TK` placeholders, `[[` internal post search, and friction-free `[^1]` footnotes—while rendering and round-tripping **all 22 native Ghost cards** without losing a single byte of data (and letting you press `⌥⌘E` anytime to flip to Ghost's stock Koenig editor on the fly).

---

## Key Features in `0.2.1`

- **Markdown-First Lexical Editor**: Write naturally with instant Markdown transforms (`#` headings, `> ` blockquotes, bullet/numbered/checklist lists, `` `code` ``, ` ``` ` code blocks, `==highlights==`), smart typography (`--` → `—`, `...` → `…`), and automatic `TK` "To-Come" margin reminder badges.
- **Friction-Free `[^1]` Footnotes**: Type `[^1]` inline or press `⇧⌘N` to insert a numbered footnote badge and jump straight to the dedicated bottom Footnotes drawer. Edit multi-line footnotes with bold, italic, code, and links; Geist automatically compiles them to Ghost's native `<sup class="footnote-ref">` and `<section class="footnotes">` HTML cards with working anchor jumps and `↩` back-references—and rehydrates them back into editable footnotes whenever you reopen the post.
- **Effortless Linking (`⌘V`, `⌘K`, and `[[`)**: Highlight any word and paste a URL (`⌘V`) to turn it into a link immediately, or press `⌘K` / type `[[` anywhere in your prose to fuzzy-search your Ghost site's existing posts and insert an internal link without leaving the keyboard.
- **100% Lossless Ghost Card Parity (All 22 Native Cards)**: Type `/` at the start of any line to open a fast, fuzzy command menu for every Ghost card: **Images**, **Galleries**, **Bookmarks**, **Callouts**, **Toggles**, **Buttons**, **Signup forms**, **Call-to-Action (CTA)** cards, **Public Previews (Paywalls)**, **Audio**, **Video**, **Files**, **Products**, **Headers**, **HTML**, **Markdown**, **Code blocks**, **Dividers**, **Email Content**, **Email CTAs**, and **oEmbeds** (YouTube, Spotify, Vimeo, X, Unsplash, etc.). Want to double-check how Ghost Admin sees your post? Press `⌥⌘E` to toggle between Geist's Markdown-first engine and Ghost's stock Koenig editor instantaneously.
- **Distraction-Free Focus & Typewriter Modes**: Press `⇧⌘F` to enter Focus Mode—hiding surrounding chrome and dimming inactive paragraphs so only your current thought stays lit. Enable **Typewriter Scrolling** to keep your active line centered vertically on screen, and switch body typography between bundled **Lora** (Serif), **Inter** (Sans), and **JetBrains Mono**.
- **Local-First Scraps & Offline Resilience**: Jot down rough notes in **Scraps** (`scraps.json`), stored purely on your device and never uploaded to Ghost until you click **Promote to Draft** (or demote a Ghost draft back to a local scrap). Every opened post is cached locally (`draft_cache.json`) so you can keep writing offline, with automatic replay on reconnect and built-in `409 UPDATE_COLLISION` conflict recovery.
- **Native Rust + macOS Keychain Security**: Sign in directly with your Ghost **email and password** (with full 2FA verification support) or paste an Admin API key. Credentials are stored exclusively in the OS credential manager (`app.geist` in macOS Keychain / Windows Credential Manager), and short-lived 5-minute HS256 JWTs are minted in Rust so your secret never enters the webview.
- **Guarded Publishing & Revisions**: Publishing defaults to **web-only** so you never email your subscriber list by accident. Sending a newsletter requires an explicit confirmation step displaying the active subscriber count. Browse and restore historical snapshots anytime from the **Revisions** drawer, or preview drafts in an isolated, zero-IPC preview window with `Anonymous` / `Free` / `Paid` member toggles.

---

## Download & Installation

Pre-built binaries are available on the [Releases page](https://github.com/josiahelstrom/geist/releases/latest):

- **macOS (Apple Silicon)**: `Geist_0.2.1_aarch64.dmg`
- **macOS (Intel)**: `Geist_0.2.1_x64.dmg`
- **Windows (10/11)**: `Geist_0.2.1_x64-setup.exe`

### First Launch on macOS

Release builds are currently ad-hoc signed and not yet notarized with an Apple Developer ID. On first launch, macOS Gatekeeper will show an "unverified developer" prompt:

1. In Finder, right-click (or Control-click) **Geist.app** and choose **Open**, then click **Open**.
2. Or clear the quarantine attribute in Terminal after dragging **Geist.app** to `/Applications`:

```bash
xattr -dr com.apple.quarantine /Applications/Geist.app
```

---

## Keyboard Shortcuts

| Shortcut | Action | Notes |
|---|---|---|
| `/` | Slash card menu | Open the fuzzy command menu at the start of any empty line |
| `⌘K` or `[[` | Link / Internal post search | Link selected text or search existing Ghost posts |
| `⌘V` *(on selection)* | Paste URL as link | Wraps highlighted text in a link when the clipboard holds a URL |
| `[^1]` or `⇧⌘N` | Insert footnote | Inserts an inline footnote reference and focuses the Footnotes drawer |
| `⌥⌘E` | Switch editor engine | Toggle between Markdown-first Lexical and stock Ghost Koenig |
| `⇧⌘F` | Focus mode | Hides chrome and dims inactive paragraphs (`Esc` exits) |
| `⌘\` | Toggle navigation rail | Collapses or expands the left navigation rail and post list |
| `⌘⌥I` | Toggle metadata inspector | Opens or closes the right-hand post settings drawer |
| `⌘N` | New draft | Creates and opens a new Ghost draft |
| `⌘S` | Save revision | Immediately flushes changes and records a Ghost revision |
| `⇧⌘L` | Cycle appearance | Cycles System, Light, and Dark themes |

---

## Development (`pnpm`)

### Prerequisites

- **Node.js** 22+ and **pnpm** 10+
- **Rust** 1.90+ (`rustup update`)
- **macOS**: Xcode Command Line Tools (`xcode-select --install`)
- **Windows**: Visual Studio C++ Build Tools + WebView2 Runtime

### Commands

```bash
pnpm install        # Install frontend dependencies
pnpm tauri dev      # Launch Geist in development mode (hot-reloads webview + Rust)
pnpm app            # macOS dev launcher (set GEIST_SIGN_IDENTITY for stable Keychain ACLs)
pnpm check          # Run TypeScript typecheck (tsc --noEmit) + Vitest test suite
pnpm test:rust      # Run Cargo unit, HTTP scope, and Keychain integration tests
pnpm tauri build    # Build production bundles in src-tauri/target/release/bundle/
```

> **Note on `pnpm tauri build`**: Because `bundle.createUpdaterArtifacts` is enabled in `src-tauri/tauri.conf.json`, production builds require `TAURI_SIGNING_PRIVATE_KEY` to be set. See [`docs/releasing.md`](./docs/releasing.md) for signing instructions.

---

## Documentation

- [`docs/architecture.md`](./docs/architecture.md) — System architecture, security boundaries, and editor design.
- [`docs/design-system.md`](./docs/design-system.md) — CSS tokens, typography scale, and layout specifications.
- [`docs/releasing.md`](./docs/releasing.md) — Release signing, CI workflow, and auto-updater setup.

## License

Geist is licensed under the MIT License. See [`LICENSE`](./LICENSE) for details.
