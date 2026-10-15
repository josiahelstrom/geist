#!/usr/bin/env bash
# Dev launcher for Draftdesk.
#
# Why this exists instead of `npm run tauri dev`:
# tauri-cli always ad-hoc signs the debug binary, and macOS binds Keychain
# access to an ad-hoc signature's cdhash -- which changes on every rebuild. The
# result is a "wants to use your confidential information" prompt every time
# Rust code changes. Signing with a stable Apple Development identity anchors
# the Keychain ACL to the team id instead, so the prompt appears once and
# "Always Allow" sticks.
set -euo pipefail

cd "$(dirname "$0")/.."

IDENTITY="${GEIST_SIGN_IDENTITY:-${DRAFTDESK_SIGN_IDENTITY:-Apple Development: josiahelstrom@icloud.com (58ZQDQFV4C)}}"
BIN="src-tauri/target/debug/geist"
VITE_PID=""

cleanup() {
    [ -n "$VITE_PID" ] && kill "$VITE_PID" 2>/dev/null || true
}
trap cleanup EXIT

if ! security find-identity -v -p codesigning | grep -qF "$IDENTITY"; then
    echo "error: signing identity not found: $IDENTITY" >&2
    echo "Set DRAFTDESK_SIGN_IDENTITY, or run 'security find-identity -v -p codesigning'." >&2
    exit 1
fi

# Free the dev port so a previous run cannot block startup.
if lsof -ti:1420 >/dev/null 2>&1; then
    echo "port 1420 already in use; freeing it"
    lsof -ti:1420 | xargs kill -9 2>/dev/null || true
    sleep 1
fi

echo "==> starting vite"
npm run dev &
VITE_PID=$!

for _ in $(seq 1 60); do
    if curl -sf -o /dev/null http://localhost:1420/; then break; fi
    sleep 0.5
done

build_and_run() {
    echo "==> cargo build"
    cargo build --manifest-path src-tauri/Cargo.toml
    echo "==> codesign ($IDENTITY)"
    # Keep the identifier stable across rebuilds; it is part of the Keychain ACL.
    codesign --force --sign "$IDENTITY" --identifier app.geist.desktop.dev "$BIN"
    codesign -dv "$BIN" 2>&1 | grep -E "Identifier=|Authority=" | sed 's/^/    /'
    echo "==> launching"
    "$BIN" &
    APP_PID=$!
}

build_and_run

# Rebuild + relaunch when Rust changes. The frontend hot-reloads on its own.
watch_src="src-tauri/src src-tauri/capabilities src-tauri/tauri.conf.json"
last=$(stat -f '%m' "$BIN")

while true; do
    sleep 2
    changed=0
    for f in $watch_src; do
        [ -e "$f" ] || continue
        if [ "$(find "$f" -newer "$BIN" -type f 2>/dev/null | head -1)" ]; then
            changed=1
            break
        fi
    done
    if [ "$changed" = "1" ]; then
        echo "==> rust changed, rebuilding"
        kill "$APP_PID" 2>/dev/null || true
        wait "$APP_PID" 2>/dev/null || true
        build_and_run || echo "build failed; waiting for further changes"
    fi
done