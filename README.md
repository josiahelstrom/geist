# Geist

Geist — a desktop editor for Ghost publications.

Geist is a desktop application built with Tauri v2, pairing a lightweight Rust backend with a webview frontend (WKWebView on macOS, WebView2 on Windows). Rather than a fully native UI framework, Geist pairs native platform integrations where they matter most — a native macOS menu bar, OS credential storage (macOS Keychain and Windows Credential Manager), and background networking without CORS — with a distraction-free webview editor canvas powered by `@tryghost/koenig-lexical`.

Geist runs on macOS 11+ (Apple Silicon and Intel) and Windows 10/11 via WebView2.

Ghost is a trademark of the Ghost Foundation. This project is not affiliated with or endorsed by them, and contains no Ghost branding in its name, icon, or bundle identifier (`app.geist.desktop`).

<!-- screenshot: editor canvas with navigation rail and metadata inspector -->

## Download and Installation

Pre-built binaries are available on the [latest release page](https://github.com/josiahelstrom/geist/releases/latest).

Choose the asset matching your platform:

- **macOS (Apple Silicon)**: `Geist_<version>_aarch64.dmg`
- **macOS (Intel)**: `Geist_<version>_x64.dmg`
- **Windows (10/11)**: `Geist_<version>_x64-setup.exe`

### First launch (macOS)

Release builds are currently ad-hoc signed and not notarized with Apple. On first launch, macOS Gatekeeper displays an "unverified developer" warning.

To open the app:
1. In Finder, right-click (or Control-click) **Geist.app** and select **Open**.
2. Click **Open** in the confirmation dialog.

Alternatively, remove the quarantine attribute via Terminal after copying the app to `/Applications`:

```bash
xattr -dr com.apple.quarantine /Applications/Geist.app
```

## Requirements

### For Users
- **Ghost**: 5.0 to 6.73 (matches `MIN_GHOST` and `MAX_GHOST` supported range)
- **Operating System**: macOS 11+ or Windows 10/11 (with the WebView2 runtime)

### For Building from Source
- **Node.js**: 22+
- **Rust**: 1.90+ (`rustup update`)
- **macOS**: Xcode Command Line Tools (`xcode-select --install`)
- **Windows**: Visual Studio C++ Build Tools
- *Note*: `scripts/dev.sh` (`npm run app`) is macOS-only and expects an Apple signing identity to anchor Keychain access across rebuilds. Windows contributors should use `npm run tauri dev`.

## Features

- **Workspace layout**: Collapsible navigation rail and post list for browsing publications and drafts, opening into a distraction-free editor canvas with a collapsible metadata inspector.
- **Ghost Koenig editor**: Full Lexical card parity, supporting bookmarks, callouts, markdown cards, HTML cards, image cards, galleries, audio, video, file attachments, Unsplash integration, and Klipy GIFs.
- **Typewriter scrolling**: Active line stays centered vertically in the viewport while typing.
- **Selectable body typography**: Switch canvas body typography between Serif (Lora), Sans (Inter), and Monospace (JetBrains Mono). All font families are bundled locally for offline use.
- **Canvas layout controls**: Toggle inline post excerpt visibility and canvas feature image display directly from the metadata inspector.
- **Taxonomy & post metadata**: Edit post slug, tags, primary tag, author attribution, excerpt, feature image, and canonical URL.
- **Focus mode**: Dims surrounding chrome and fades remaining controls on idle after 1.5 seconds of inactivity (`Esc` exits).
- **Offline draft cache with replay**: Posts opened are cached locally (`draft_cache.json`). Edits made while offline are saved to local cache; dirty patches replay automatically upon reconnection.
- **Local scraps**: A private, local-first scratchpad (`scraps.json`) that never touches the network until promoted. Promote scraps to Ghost drafts or demote existing draft posts to local scraps.
- **Revisions drawer**: Review past post revisions, inspect saved title, excerpt, and text snapshots, and restore any revision into the editor as a new revision.
- **Guarded publishing sheet**: Publishing defaults to web-only. Clicking publish opens a confirmation sheet rather than publishing instantly; newsletter delivery requires explicit selection and shows a confirmation with the newsletter name, audience segment, and active recipient count. Supports scheduled publishing and unscheduling.
- **Themes & appearance**: System, light, and dark appearance modes cycling via shortcut or menu, styled via CSS design tokens.
- **In-app preview window**: Preview posts in the system browser or in an isolated external-origin window with anonymous, free, and paid tier toggles. Site and theme HTML never executes inside the app origin.
- **In-place auto-updates**: Automatically checks for updates from GitHub Releases against an embedded public key via `tauri-plugin-updater`.

## Keyboard Shortcuts

| Shortcut | Action | Notes |
|---|---|---|
| `Cmd+\` | Toggle navigation rail | Collapses or expands the navigation rail and post list |
| `Cmd+Shift+F` | Focus mode | Dims distractions with idle fade; `Esc` exits |
| `Cmd+Alt+I` | Toggle inspector | Opens or closes the post metadata sidebar |
| `Cmd+K` | Quick search | Focuses search when the rail is visible |
| `Cmd+N` | New draft | Creates and opens a new post draft |
| `Cmd+S` | Save revision | Captures an explicit saved revision to post history |
| `Cmd+Shift+L` | Cycle appearance | Cycles system, light, and dark appearance |

## Security & Privacy

- **OS credential storage**: Admin API keys and Staff Access Tokens are stored in the macOS Keychain (`app.geist`) or Windows Credential Manager via the Rust backend (`keyring` crate) — never in `localStorage` or the webview store.
- **Rust-minted JWTs**: Short-lived (5-minute HS256) JWTs are minted in Rust. The Admin API secret never enters the JavaScript bundle.
- **Staff login protection**: Passwords entered during staff login are used in an ephemeral in-memory session in Rust solely to retrieve a Staff Access Token, and are dropped immediately afterwards. Passwords are never saved to disk.
- **Zero telemetry**: No telemetry or third-party analytics. Network requests go only to the Ghost site you configure (via Rust `tauri-plugin-http`, bypassing webview CORS).
- **Version compatibility enforcement**: Geist checks your Ghost version against supported bounds (`MIN_GHOST` 5.0 to `MAX_GHOST` 6.73). Versions above 6.73 open read-only by default to prevent loss of newer schema cards, with no silent feature degradation.

## Build from Source

Install dependencies and start development:

```bash
npm install
npm run app          # macOS development with stable Apple signing identity
npm run tauri dev    # Cross-platform development (Windows / fallback)
npm run check        # Run typecheck and frontend test suites
npm run test:rust    # Run Rust backend test suites
npm run tauri build  # Build production artifacts
```

`bundle.createUpdaterArtifacts` is enabled, which requires `TAURI_SIGNING_PRIVATE_KEY` during `npm run tauri build`. Without this environment variable, the build fails at the signing step. See [`docs/releasing.md`](./docs/releasing.md) for details on generating keys and configuring release builds.

## Artifacts

Production builds output artifacts into `src-tauri/target/release/bundle/`:

- `macos/Geist.app` — macOS application bundle
- `macos/Geist.app.tar.gz` (plus `.sig`) — Compressed application and updater signature
- `dmg/Geist_<version>_aarch64.dmg` — Apple Silicon macOS disk image
- `dmg/Geist_<version>_x64.dmg` — Intel macOS disk image
- `nsis/Geist_<version>_x64-setup.exe` — Windows NSIS setup installer
- `latest.json` — Multi-platform updater manifest

## Testing

Geist includes test coverage across both frontend and backend:

- **Frontend tests (`npm run check`)**: Runs TypeScript type checking (`tsc --noEmit`) and Vitest test suites. Tests cover UI components (including `PublishModal` and `MetadataSidebar`), version compatibility checks, offline cache serialization, scrap workflows, file uploaders, and UI preferences.
- **Rust tests (`npm run test:rust`)**: Runs Cargo tests covering OS keyring round-tripping, JWT minting, HTTP scopes, preview window URL validation, and staff session login.

## Known Limitations & Caveats

- **No Apple Developer ID yet**: macOS releases are ad-hoc signed, requiring a one-time Gatekeeper confirmation on first launch.
- **Windows testing maturity**: Windows builds via WebView2 are functional, but have received significantly less testing than macOS.
- **No deep links**: Custom URL schemes and deep link activation are not supported.
- **Single active site**: Geist edits one publication at a time. Switching sites requires disconnecting or configuring another site.

## Documentation

- [`docs/architecture.md`](./docs/architecture.md) — Architecture and security rules.
- [`docs/design-system.md`](./docs/design-system.md) — Design tokens, chrome styling, and visual guidelines.
- [`docs/releasing.md`](./docs/releasing.md) — Release workflow, signing secrets, and auto-updater infrastructure.

## Contributing

Contributions, bug reports, and suggestions are welcome. Before submitting changes, ensure all checks pass:

```bash
npm run check
npm run test:rust
```

## License

Geist is licensed under the MIT License. See [`./LICENSE`](./LICENSE) for details.
