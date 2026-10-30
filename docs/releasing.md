# Releasing Geist

How a Geist release is signed, built and published, and what installed apps do
afterwards.

## Signing key

The updater signing key was generated once:

```bash
npm run tauri signer generate -- -w ~/.tauri/geist.key --ci -p ""
```

- Private key: `~/.tauri/geist.key` (never commit it, never share it).
- Public key: embedded in `src-tauri/tauri.conf.json` under
  `plugins.updater.pubkey`. Installed apps use it to verify every update.

> **Losing the private key permanently breaks updates for every installed user.**
> The public key is baked into shipped binaries; without the matching private key
> no future release can be signed for them, and users must reinstall by hand.
> Back the key up in a password manager before the first public release.

The current key was created with an empty password. That is why
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` is set to an empty string rather than a
secret value.

## Required GitHub secrets

Set these under **Settings → Secrets and variables → Actions**.

| Secret | Value |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | The full contents of `~/.tauri/geist.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Empty string (`""`) for the current key |
| `APPLE_CERTIFICATE` | Base64-encoded Developer ID `.p12` (`base64 -i cert.p12 \| pbcopy`) |
| `APPLE_CERTIFICATE_PASSWORD` | Password used when exporting the `.p12` |
| `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: Name (TEAMID)` |
| `APPLE_ID` | Apple ID email used for notarization |
| `APPLE_PASSWORD` | App-specific password for that Apple ID |
| `APPLE_TEAM_ID` | Apple Developer team identifier |

`GITHUB_TOKEN` is provided by Actions and needs `contents: write`, which
`.github/workflows/release.yml` already grants.

## Local signing build

To produce a signed local build with the same key:

```bash
TAURI_SIGNING_PRIVATE_KEY="$HOME/.tauri/geist.key" npm run tauri build
```

For `build` and `bundle`, `TAURI_SIGNING_PRIVATE_KEY` accepts either the key itself or
a path to the key file. `TAURI_SIGNING_PRIVATE_KEY_PATH` is read only by
`tauri signer sign`, so setting it will not sign a build — the CLI fails with
"A public key has been found, but no private key."

Apple signing and notarization are picked up from the same `APPLE_*` environment
variables if you have them exported; without them the build is still signed for
the updater but not notarized.

## Cutting a release

1. Bump `version` in `package.json`, `src-tauri/tauri.conf.json` and
   `src-tauri/Cargo.toml` to the same value.
2. Commit, then tag and push:

   ```bash
   git tag v1.0.0-rc.1
   git push origin v1.0.0-rc.1
   ```

3. The tag triggers `.github/workflows/release.yml`, which builds
   `aarch64-apple-darwin`, `x86_64-apple-darwin` and Windows, then creates a
   **draft** release.
4. Wait for the run to finish, open the draft, and verify it contains:
   - `Geist.app.tar.gz` plus its `.sig` (the updater archive and signature)
   - `.dmg` installers for both Mac architectures
   - the Windows installer(s)
   - `latest.json` containing every platform's signature
5. Publish the release. Only published, non-prerelease releases are served to the
   updater (see [Update flow](#update-flow)).

Manual rebuilds without a new tag: run the **Release** workflow with
`workflow_dispatch`.

## Update flow

Installed apps poll:

```
https://github.com/josiahelstrom/geist/releases/latest/download/latest.json
```

`latest.json` lists the version, notes, publication date and the signed artifact
URL per platform. The app compares it with its own version, downloads the new
archive, verifies it against `plugins.updater.pubkey`, installs it and restarts
(`tauri-plugin-updater` + `tauri-plugin-process`).

Two consequences:

- **Prereleases are invisible to `releases/latest`.** GitHub's `latest` alias skips
  releases marked as prerelease as well as drafts, so an installed app would never
  see `latest.json` and the updater would silently do nothing. This repo therefore
  publishes both RC and GA as regular (non-prerelease) releases; `prerelease` stays
  `false` in the workflow.
- A draft release is also invisible until it is published; publishing is the step
  that ships the update.

If a release ever does need to be marked as a prerelease, pin the updater endpoint in
`src-tauri/tauri.conf.json` to the tag URL
(`https://github.com/josiahelstrom/geist/releases/download/v<version>/latest.json`)
instead of `/releases/latest/`, because the tag-pinned URL does resolve for
prereleases.

## Homebrew

Once `v1.0.0` is out, a cask will live in a personal tap:

```ruby
cask "geist" do
  version "1.0.0"
  sha256 "<sha256 of the released dmg>"

  url "https://github.com/josiahelstrom/geist/releases/download/v#{version}/Geist_#{version}_aarch64.dmg"
  name "Geist"
  desc "Desktop editor for Ghost publications"
  homepage "https://github.com/josiahelstrom/geist"

  app "Geist.app"
end
```

Replace `sha256` with the checksum of the published DMG
(`shasum -a 256 Geist_1.0.0_aarch64.dmg`). During the RC there is no cask; install
from the published RC release instead. The RC `.dmg` is published as a normal
release, not a prerelease, so update delivery works during the RC cycle.
