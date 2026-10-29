# Ghost Desktop Editor — Plan (rev 2)

> **Legacy historical design document.** This is the original build plan and research log
> for Geist, preserved for its historical record (verified Ghost behaviours and corrections
> found while building). It is **not** the current reference.
>
> **Current architecture and roadmap live in [`docs/architecture.md`](./architecture.md).**
> A frozen copy of this file is kept at
> [`docs/ghost-desktop-editor.md.bak`](./ghost-desktop-editor.md.bak).

A Tauri desktop app for writing, previewing and publishing Ghost posts. It works with any
Ghost site (self-hosted, Ghost(Pro), Hostinger) using the user's Staff Access Token or a
Custom Integration Admin API key.

Working name: **Draftdesk** (placeholder). Do not put "Ghost" in the name, icon or
bundle id. Ghost is a trademark, even though the code is MIT.

Build the app **outside** the Ghost install directory, for example
`~/Documents/10 Projects/14 Coding/draftdesk/`. Keep the local Ghost install as a test
server only.

---

## 0. What changed from rev 1

Rev 1 had errors. Each was checked against the Ghost 6.68 source or a live server:

| Rev 1 said | Actually | Source |
|---|---|---|
| Save with `?source=html` | If `html` is in the body, Ghost **overwrites your lexical** with a lossy HTML conversion. Never use it. | `api/endpoints/utils/serializers/input/posts.js:220-229` |
| Preview needs a session cookie and a Rust proxy | `/p/{uuid}/` is **public for drafts**. No auth needed. | `frontend/services/routing/controllers/previews.js` |
| Preview in `<iframe srcdoc>` with `allow-same-origin allow-scripts` | **Security hole**: theme JS would run in the app's origin with access to Tauri IPC | — |
| Session login with `Origin: https://your-app` | Ghost rejects any Origin except the site's own admin origin | `services/auth/session/session-service.js:122-131` |
| `GET /users/me/` validates any key | Returns **404 for integration keys**. Useful: 200 = staff, 404 = integration, 401 = bad key | `api/endpoints/users.js:31`, `api-key/admin.js` |
| Staff tokens can't regenerate themselves | They can. The block list is only `DELETE /db/`, `PUT /users/owner/`, `POST /authentication/reset/` | `web/api/endpoints/admin/middleware.js:31-44` |
| `Accept-Version: v5.0` | Servers report `Content-Version: v6.68` (local) and `v6.70` (Ghost(Pro)). Use `v6.0`. | live probe |
| Version risk only goes one way | **Both ways.** Unknown card type: the post fails to load. Unknown setting on a known card: silently dropped on save. | Lexical behaviour |
| Editor upload setting is a callback | It is `fileUploader: { useFileUpload(type) }`, a **React hook**. Koenig logs an error without it. | koenig bundle string |
| `cardConfig` is a few keys | It is about 15 keys, each backed by an API call (§7) | koenig bundle grep |
| Client-side conflict guard | Ghost already does it: `409 UPDATE_COLLISION` if `updated_at` is stale | `@tryghost/bookshelf-collision` |
| 20+ Rust command wrappers | Overbuilt. Rust holds the secret and mints tokens. The webview calls the API through the HTTP plugin. | — |
| Full parity in about 5.5 weeks | Unrealistic. Ship a weekend v0.1, then grow it. | — |

---

## 1. Scope

### v0.1 — weekend target
An unsigned macOS `.app` that, against **your real OCI-hosted site**, can:
- connect with a pasted Staff Access Token
- list drafts and create a new draft
- edit the title and body in the real Koenig editor, with image uploads and bookmark/embed cards
- autosave, plus Cmd+S to save with a revision
- open a preview in the browser
- publish and unpublish, **with no newsletter email, ever**

### Cut from v0.1
Password login, revisions UI, scheduling, newsletter sending, snippets, tags/authors
sidebar, offline mode, Windows, code signing, auto-updates.

### Later
See §12 roadmap.

---

## 2. Verified facts

All checked against local Ghost 6.68.0 (`http://localhost:2368`) and `https://demo.ghost.io`
(Ghost(Pro), 6.70).

### Content
- Post body is `posts.lexical`, a **JSON string**: `{"root":{"type":"root","version":1,"children":[...]}}`.
- The Admin API returns it with `?formats=lexical`.
- Ghost regenerates `html` on the server when it saves. Never send `html`.
- Ghost stores URLs as `__GHOST_URL__/...` and turns them back into absolute URLs on read
  (`server/lib/lexical.js:132-153`). **Always send absolute URLs.** Never do your own
  `__GHOST_URL__` substitution.
- Edit conflicts: send the last `updated_at` you received. If it's stale you get
  `409 UPDATE_COLLISION`, "Saving failed! Someone else is editing this post."

### Auth
- **A raw `id:secret` is rejected** (`INVALID_JWT`, tested locally). You must mint a JWT:
  - header `{"alg":"HS256","typ":"JWT","kid":"<id>"}`
  - payload `{"iat":now,"exp":now+300,"aud":"/admin/"}`
  - signed with HMAC-SHA256 using the **hex-decoded** secret
  - sent as `Authorization: Ghost <jwt>`
- Tokens last at most **5 minutes**, measured against the **server's** clock.
- Staff token: the full permissions of that user's role.
  Integration key: a fixed allowlist covering posts, pages, images, files, media, tags,
  users (GET), config/settings (GET), oembed, newsletters and schedules. **Snippets and
  labels are not on it.**
- `GET /ghost/api/admin/site/` works **without auth** and returns `title`, `url`,
  `version` (e.g. `"6.68"`), `locale`, `timezone`.
- **CORS:** the Admin API only allows localhost, local IPs and the site's own host.
  Windows Tauri (`http://tauri.localhost`) would be blocked. That's why all requests go
  through the HTTP plugin.

### Editor
- `@tryghost/koenig-lexical` is on npm (MIT, latest 1.12.0, 370 versions). Its only
  external imports are `react`, `react-dom`, `react/jsx-runtime` and `react-dom/client`.
  Lexical 0.13.1 and all `kg-*` packages are bundled inside it.
- **Local Ghost 6.68 ships Koenig `1.11.1`** (verified in its UMD bundle).
- **Ghost builds Koenig against **React 18.3.1**. The npm package declares no peer
  dependencies, so nothing will warn you if you install React 19.
- ~~Ghost(Pro) does not serve a standalone editor bundle (404)~~ **Wrong for OCI.**
  `https://everywayhuman.com/ghost/assets/koenig-lexical/koenig-lexical.umd.js` returns
  **200 and is byte-identical to the local one** (same SHA-256), so OCI is not
  running Ghost(Pro)'s editor-less setup. Pin Koenig by fetching this URL and
  grepping the version — it works on both of the target sites.

### Tauri HTTP plugin (read from source, `plugins-workspace/v2/plugins/http/guest-js/index.ts`)
- Requests run in Rust, so CORS doesn't apply. URLs must be allowed by the capability scope.
- `FormData` bodies work: the body is serialised through `new Request()` and the
  multipart boundary header is kept.
- `response.url` is the **final URL after redirects**. We use it to find the admin address.
- `maxRedirections` is supported. Use `0` for authenticated calls.
- **Forbidden headers such as `Origin` are dropped silently** unless the Rust crate
  enables `unsafe-headers`. This matters for password login (v0.5).
- Request bodies cross IPC as a JSON array of numbers. Fine for images, slow for very
  large media.

---

## 3. Architecture

```
┌──────────────────────── Draftdesk (Tauri v2) ─────────────────────────┐
│                                                                        │
│  Rust (small, security boundary)                                       │
│   • save_key / delete_key   → OS keychain (keyring crate)              │
│   • get_jwt(base, offset)   → 5-min HS256 token; the secret never      │
│                               leaves Rust                              │
│   • tauri-plugin-http        → network, no CORS                         │
│   • tauri-plugin-opener      → open preview in the default browser     │
│                                                                        │
│  Webview: React 18.3.1 + TypeScript + Vite                             │
│   • api.ts        fetch via plugin-http + Authorization: Ghost <jwt>    │
│   • Connect       paste key → probe → detect key type                   │
│   • PostList      drafts / published                                    │
│   • Editor        KoenigComposer + title + saver + upload hook          │
│   • site metadata localStorage in v0.1, tauri-plugin-store later        │
└────────────────────────────────────────────────────────────────────────┘
                              │ HTTPS
                              ▼
                {adminBase}/ghost/api/admin/...
```

**Why the split:** the long-lived secret stays in Rust and the keychain. The webview only
ever holds a token that expires in 5 minutes. Endpoint code is TypeScript in one place,
so there's no duplicated Rust/TS types.

---

## 4. Safety rules

1. **The secret never leaves Rust.** Only 5-minute tokens reach the webview.
2. **Never send `newsletter` or `email_segment` query params.** Publishing with them
   emails your subscribers, and that can't be undone. This changes only in v0.4, behind
   a confirmation that shows the recipient count.
3. **Never send `html`, and never use `?source=html`**, when saving lexical.
4. **One save in flight at a time.** Always send the last server `updated_at` and take the
   new one from each response. On `409`, stop autosave and ask the user.
5. **Authenticated requests use `maxRedirections: 0`.** A redirect becomes a visible error
   ("site moved, reconnect") instead of a confusing 401 from a dropped auth header.
6. **Never render site or theme HTML in the app's origin.** No `srcdoc`, no `innerHTML` of
   theme output. Preview opens in the system browser, or later in a separate window
   loading the remote URL.
7. **No Ghost branding** in the name, icon or bundle id.

---

## 5. Authentication

### 5.1 Rust — `src-tauri/src/lib.rs`

```rust
use base64::{engine::general_purpose::URL_SAFE_NO_PAD as B64, Engine};
use hmac::{Hmac, Mac};
use sha2::Sha256;
use std::time::{SystemTime, UNIX_EPOCH};

const SERVICE: &str = "app.draftdesk"; // rename with the app

fn entry(base: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, base).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_key(base: String, key: String) -> Result<(), String> {
    let key = key.trim();
    let (id, secret) = key.split_once(':').ok_or("Key must look like id:secret")?;
    if id.is_empty() || hex::decode(secret).is_err() {
        return Err("That doesn't look like a Ghost Admin API key".into());
    }
    entry(&base)?.set_password(key).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_key(base: String) -> Result<(), String> {
    entry(&base)?.delete_credential().map_err(|e| e.to_string())
}

#[tauri::command]
fn get_jwt(base: String, clock_offset_secs: i64) -> Result<String, String> {
    let key = entry(&base)?.get_password().map_err(|e| e.to_string())?;
    mint(&key, clock_offset_secs)
}

fn mint(key: &str, offset: i64) -> Result<String, String> {
    let (id, secret_hex) = key.split_once(':').ok_or("bad key")?;
    let secret = hex::decode(secret_hex).map_err(|e| e.to_string())?;
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs() as i64 + offset;
    let header = serde_json::json!({"alg": "HS256", "typ": "JWT", "kid": id});
    let payload = serde_json::json!({"iat": now, "exp": now + 300, "aud": "/admin/"});
    let input = format!("{}.{}", B64.encode(header.to_string()), B64.encode(payload.to_string()));
    let mut mac = Hmac::<Sha256>::new_from_slice(&secret).map_err(|e| e.to_string())?;
    mac.update(input.as_bytes());
    Ok(format!("{input}.{}", B64.encode(mac.finalize().into_bytes())))
}

// in run(): .plugin(tauri_plugin_http::init())
//           .plugin(tauri_plugin_opener::init())
//           .invoke_handler(tauri::generate_handler![save_key, delete_key, get_jwt])
```

**keyring gotcha:** the `v1` feature (on by default in v4) selects Keychain Services on
macOS. Keep it enabled — without it the crate has no usable store. The old v3 warning
about a silent in-memory mock no longer applies, but verify a key survives a restart
(§13) rather than trusting it.

### 5.2 Capabilities — `src-tauri/capabilities/default.json`

Add to `permissions`:

```json
{ "identifier": "http:default",
  "allow": [ { "url": "https://*" }, { "url": "http://localhost:*" }, { "url": "http://127.0.0.1:*" } ] },
"opener:default"
```

Users type arbitrary domains, so the scope has to be broad. If requests fail with
"url not allowed on the configured scope", widen the pattern (the syntax is URLPattern;
try `https://*:*`). Confirm on Saturday morning.

### 5.3 TypeScript — `src/api.ts`

```ts
import { fetch } from '@tauri-apps/plugin-http';
import { invoke } from '@tauri-apps/api/core';

export type Site = {
  base: string;            // admin base, may include a subdirectory, no trailing slash
  siteUrl: string;         // public site URL from /site/, ends with '/'
  title: string;
  version: string;         // "6.68"
  keyKind: 'staff' | 'integration';
  role?: string;           // Owner | Administrator | Editor | Author | Contributor
  clockOffset: number;     // server minus local, in seconds
};

export class GhostError extends Error {
  constructor(public status: number, public code: string | undefined, message: string) { super(message); }
  static async from(res: Response) {
    let code: string | undefined, msg = `HTTP ${res.status}`;
    try { const j = await res.json(); code = j.errors?.[0]?.code; msg = j.errors?.[0]?.message ?? msg; } catch {}
    if (res.status >= 300 && res.status < 400) msg = `Site redirected to ${res.headers.get('location')}. Reconnect using that address.`;
    return new GhostError(res.status, code, msg);
  }
}

export async function api<T = any>(site: Site, path: string, init: RequestInit = {}): Promise<T> {
  const jwt = await invoke<string>('get_jwt', { base: site.base, clockOffsetSecs: site.clockOffset });
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Ghost ${jwt}`);
  headers.set('Accept-Version', 'v6.0');
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  const res = await fetch(`${site.base}/ghost/api/admin${path}`, { ...init, headers, maxRedirections: 0 });
  if (!res.ok) throw await GhostError.from(res);
  return (res.status === 204 ? null : await res.json()) as T;
}

function normalize(input: string) {
  let s = input.trim();
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  return s.replace(/\/ghost(\/.*)?$/i, '').replace(/\/+$/, '');
}

export async function connect(input: string, key: string): Promise<Site> {
  const probe = await fetch(`${normalize(input)}/ghost/api/admin/site/`, {
    headers: { 'Accept-Version': 'v6.0' },          // redirects followed here on purpose
  });
  if (!probe.ok) throw new Error(`Couldn't find a Ghost site there (HTTP ${probe.status})`);
  const base = probe.url.replace(/\/ghost\/api\/admin\/site\/?$/, '');
  const { site } = await probe.json();
  const serverNow = Date.parse(probe.headers.get('date') ?? '') / 1000;
  const clockOffset = Number.isFinite(serverNow) ? Math.round(serverNow - Date.now() / 1000) : 0;

  await invoke('save_key', { base, key });
  const s: Site = { base, siteUrl: site.url, title: site.title, version: site.version, keyKind: 'staff', clockOffset };
  try {
    const me = await api(s, '/users/me/?include=roles');
    s.role = me.users?.[0]?.roles?.[0]?.name;
  } catch (e) {
    if (e instanceof GhostError && e.status === 404) s.keyKind = 'integration';   // valid key, not tied to a user
    else { await invoke('delete_key', { base }); throw e; }
  }
  return s;
}
```

### 5.4 Password login (v0.5, not the weekend)
1. In Rust with `reqwest` and a cookie jar, `POST {base}/ghost/api/admin/session/` with
   `{username, password}` and **`Origin: new URL(base).origin`**. Ghost requires exactly
   that. It must happen in Rust because the webview HTTP plugin drops `Origin` without
   `unsafe-headers`.
2. A `403` saying "User must verify session to login" means: ask for the emailed code,
   then `PUT /session/verify/` with `{token}`. Resend with `POST /session/verify/`. Both
   are rate-limited, so show a clear "too many attempts" state.
3. `GET /users/me/token/` returns the Staff Access Token. Store it, then
   `DELETE /session/` and throw away the cookie. Never store the password.
4. Regenerating works with the staff token itself (`PUT /users/me/token/`). Warn that it
   breaks other clients that use the same token.

---

## 6. API cheat sheet

All paths are relative to `{base}/ghost/api/admin`.

| Action | Request | Notes |
|---|---|---|
| Reachability | `GET /site/` | no auth |
| Who am I | `GET /users/me/?include=roles` | 404 = integration key |
| List drafts | `GET /posts/?filter=status:draft&order=updated_at%20desc&limit=50&fields=id,uuid,title,status,updated_at` | |
| Read post | `GET /posts/{id}/?formats=lexical` | `lexical` is a string |
| New draft | `POST /posts/` body `{posts:[{title:"", status:"draft"}]}` | the server inserts an empty lexical document |
| Autosave | `PUT /posts/{id}/` body `{posts:[{title, lexical, updated_at}]}` | no `html`, no `source` |
| Save + revision | same with `?save_revision=true` | Cmd+S |
| Publish | `PUT /posts/{id}/` body `{posts:[{status:"published", updated_at}]}` | **no `newsletter` param** |
| Unpublish | same with `status:"draft"` | |
| Upload image | `POST /images/upload/` multipart field `file` | returns `{images:[{url}]}` |
| Upload file/media | `POST /files/upload/`, `POST /media/upload/` | later |
| Embed/bookmark | `GET /oembed/?url=…&type=embed` or `type=bookmark` | for `cardConfig.fetchEmbed` |
| Snippets | `GET/POST/PUT/DELETE /snippets/` | staff only |
| Preview | `{siteUrl}p/{uuid}/` | public for drafts. Published posts redirect to their URL. |

---

## 7. Editor integration

```tsx
import { KoenigComposer, KoenigEditor } from '@tryghost/koenig-lexical';
import '@tryghost/koenig-lexical/style.css';

const uploader = useMemo(() => makeFileUploader(site), [site.base]);
const cardConfig = useMemo(() => ({
  siteUrl: site.siteUrl,
  siteTitle: site.title,
  fetchEmbed: (url: string, { type }: { type: string }) =>
    api(site, `/oembed/?url=${encodeURIComponent(url)}&type=${type}`),
}), [site.base]);

<KoenigComposer key={post.id} initialEditorState={post.lexical} fileUploader={uploader} cardConfig={cardConfig}>
  <KoenigEditor onChange={(state: any) => onBody(JSON.stringify(state))} />
</KoenigComposer>
```

**Check on Friday:** what `onChange` passes. **Answered (§15.3):** it is
`editorState.toJSON()` — a plain JSON object, not a Lexical `EditorState`. So
`JSON.stringify(state)` is right. `key={post.id}` forces a fresh editor when switching
posts. Koenig is happy under `React.StrictMode` (§15.4).

### File uploader hook

`fileTypes` is **not optional** — see §15.1. Without it, inserting an image card throws
`Cannot read properties of undefined (reading 'image')` and unmounts the editor.

```ts
export const FILE_TYPES = {
  image: {mimeTypes: ['image/*']},
  audio: {mimeTypes: ['audio/*']},
  video: {mimeTypes: ['video/*']},
};

// 'mediaThumbnail' uploads a client-generated image blob, so it goes to
// /images/upload/ even though it is not an 'image' type.
const ENDPOINTS: Record<string, string> = {
  image: '/images/upload/',
  mediaThumbnail: '/images/upload/',
  file: '/files/upload/',
  audio: '/media/upload/',
  video: '/media/upload/',
};

export function makeFileUploader(site: Site) {
  function useFileUpload(type: string) {
    const [progress, setProgress] = useState(0);
    const [isLoading, setLoading] = useState(false);
    const [errors, setErrors] = useState<{ fileName: string; message: string }[]>([]);
    const [filesNumber, setFilesNumber] = useState(0);

    async function upload(files: FileList | File[]) {
      const list = Array.from(files);
      const endpoint = ENDPOINTS[type] ?? '/media/upload/';
      setFilesNumber(list.length); setLoading(true); setErrors([]); setProgress(0);
      const results: { url: string; fileName: string }[] = [];
      for (const [i, file] of list.entries()) {
        const fd = new FormData();
        fd.append('file', file, file.name);
        try {
          const j = await api(site, endpoint, { method: 'POST', body: fd });
          results.push({ url: j.images?.[0]?.url ?? j.files?.[0]?.url ?? j.media?.[0]?.url, fileName: file.name });
        } catch (e) {
          setErrors(prev => [...prev, { fileName: file.name, message: String((e as Error).message) }]);
        }
        setProgress(Math.round(((i + 1) / list.length) * 100));
      }
      setLoading(false);
      return results;
    }
    return { upload, progress, isLoading, errors, filesNumber };
  }
  return { useFileUpload, fileTypes: FILE_TYPES };
}
```

**Verified against the bundle (§15.2):** `useFileUpload` takes `image | audio | video |
file | mediaThumbnail`; it returns `{upload, progress, isLoading, errors, filesNumber}`;
`upload()` resolves to `{url, fileName}[]`; Koenig renders `error.message`.

### `cardConfig` keys (found in the bundle)

| Key | Backed by | When |
|---|---|---|
| `siteUrl`, `siteTitle` | `/site/` | v0.1 |
| `fetchEmbed` | `/oembed/` | v0.1 |
| `unsplash` | Unsplash key from `/config/` or settings | v0.3 (leave out for now) |
| `searchLinks`, `fetchAutocompleteLinks` | `/posts/`, `/pages/`, `/tags/`, `/search-index/` | v0.3 |
| `snippets`, `createSnippet`, `deleteSnippet` | `/snippets/` (staff only) | v0.3 |
| `fetchLabels`, `renderLabels` | `/labels/` | v0.3 |
| `membersEnabled`, `stripeEnabled`, `visibilitySettings` | `/settings/` | v0.3 |
| `feature` | labs flags from `/settings/` | v0.3 |
| `image`, `pinturaConfig` | settings / Pintura | v0.3 or skip |

---

## 8. Save model

```ts
export function createSaver(site: Site, postId: string, initialUpdatedAt: string, onConflict: () => void) {
  let updatedAt = initialUpdatedAt;
  let pending: Record<string, unknown> | null = null;
  let running: Promise<void> | null = null;
  let stopped = false;

  async function run(revision: boolean) {
    while (pending && !stopped) {
      const patch = pending; pending = null;
      try {
        const q = revision ? '?save_revision=true' : '';
        const { posts: [p] } = await api(site, `/posts/${postId}/${q}`, {
          method: 'PUT',
          body: JSON.stringify({ posts: [{ ...patch, updated_at: updatedAt }] }),
        });
        updatedAt = p.updated_at;
      } catch (e) {
        pending = { ...patch, ...pending };              // don't lose edits
        if (e instanceof GhostError && e.status === 409) { stopped = true; onConflict(); }
        throw e;
      }
    }
  }

  return {
    queue(patch: Record<string, unknown>, revision = false) {
      pending = { ...pending, ...patch };
      if (!running) running = run(revision).finally(() => { running = null; });
      return running;
    },
    get updatedAt() { return updatedAt; },
  };
}
```

- Autosave fires 1.5 s after typing stops. Cmd+S saves immediately with `revision=true`.
- Show a status of "Saved", "Saving…", "Unsaved" or "Conflict".
- Warn before closing a window that has unsaved changes.

---

## 9. Preview

1. Flush the saver, because the preview shows the **last saved** version.
2. `openUrl(`${site.siteUrl}p/${post.uuid}/`)` from `@tauri-apps/plugin-opener`, which
   opens the system browser.
3. Later: a separate `WebviewWindow` that loads the remote URL. It gets no IPC access
   because it's a remote origin. Add `?member_status=free|paid` toggles there.

---

## 10. Version compatibility policy

- **v0.1:** pin `@tryghost/koenig-lexical` to the version your target site ships. Local
  6.68 ships 1.11.1. Check your OCI site on Friday (§11).
- On connect, compare `site.version` with a `TESTED_GHOST` list in code. If it isn't
  listed, show a banner but don't block (v0.1).
- **v0.3:** a real policy:
  - `MIN_GHOST` and `MAX_GHOST` per bundled Koenig version.
  - Above the maximum: read-only, with "update the app".
  - Below the minimum: warn that new cards may not render.
  - If a post fails to load (unknown node type), show "This post uses a card this app
    doesn't support yet", plus an "Open in Ghost Admin" link to
    `{base}/ghost/#/editor/post/{id}`.
- Self-hosted sites expose their Koenig version at `/ghost/assets/koenig-lexical/koenig-lexical.umd.js`.
  Use that to fill in the compatibility table.

---

## 11. Weekend build plan

### Friday night (about 3 hours): prove the two risky parts

1. **Check versions** on your OCI site:
   ```bash
   curl -s https://YOURSITE/ghost/api/admin/site/ | python3 -m json.tool | grep version
   curl -s https://YOURSITE/ghost/assets/koenig-lexical/koenig-lexical.umd.js | grep -oE 'version=.1\.[0-9]+\.[0-9]+' | head -1
   ```
   Pin Koenig to the OCI site's version. If local differs, upgrade local Ghost to match
   (`ghost update` in the install folder), or test mainly against OCI.
2. **Scaffold** (outside the Ghost folder):
   ```bash
   npm create tauri-app@latest draftdesk -- --template react-ts
   cd draftdesk
   npm i react@18.3.1 react-dom@18.3.1 && npm i -D @types/react@18 @types/react-dom@18
   npm i @tryghost/koenig-lexical@<OCI version, e.g. 1.11.1>
   npm run tauri add http
   npm run tauri add opener
cd src-tauri
    cargo add keyring --features apple-native-keyring-store   # v4 feature names, see §17
    cargo add hmac@0.12 sha2@0.10 base64@0.22 hex serde_json    # pinned, see §17
    ```
    The HTTP plugin needs Rust 1.90 or newer (`rustup update`).

    **Do not run `npm run tauri dev`** — use `npm run app` (`scripts/dev.sh`), or the
    Keychain will prompt on every rebuild. See §16.1.
3. **Mount Koenig** with a hardcoded draft:
   ```bash
   sqlite3 "/Users/josiahelstrom/Documents/10 Projects/14 Coding/Ghost/content/data/ghost-local.db" \
     "select lexical from posts where length(lexical) > 1000 limit 1;"
   ```
   Paste the output into `initialEditorState`, use a no-op `fileUploader`, and log each change.
   - If hooks error: you have two copies of React. Run `npm ls react`.
   - If init behaves oddly: turn off React StrictMode.
4. **Get a Staff Access Token** for **local** Ghost and for **OCI**: Ghost Admin → avatar →
   Your profile → Staff access token. Test it with the bash JWT script in Ghost's Admin
   API docs, run against `/ghost/api/admin/posts/?limit=1`.

✅ **Checkpoint:** the editor renders, typing logs JSON, and an authenticated curl works.

### Saturday morning (about 4 hours): connect

- Rust: `save_key`, `delete_key`, `get_jwt` (§5.1), plus the capabilities (§5.2).
- `api.ts` and `connect()` (§5.3).
- Connect screen with URL and key fields. Save the `Site` list in localStorage.
- Drafts list (§6), with a site dropdown if more than one site is saved.

✅ **Checkpoint:** connect to local *and* OCI, and see real drafts from both.

### Saturday afternoon (about 4 hours): edit and save

- Open a post, then a title input plus `KoenigComposer` (§7).
- The saver (§8): 1.5 s debounced autosave, Cmd+S with revision, status indicator,
  conflict prompt.
- Upload hook (§7), images only. Paste or drop an image into the editor.

✅ **Checkpoint:** edit a draft in the app, refresh Ghost Admin, and the change is there,
images included.

### Sunday morning (about 4 hours): make it usable

- `cardConfig` with `siteUrl`, `siteTitle` and `fetchEmbed`. Test a YouTube embed and a
  bookmark card.
- "New draft" button (`POST /posts/`).
- Preview button (§9).
- Respect roles: hide Publish for Contributors.

### Sunday afternoon (about 3 hours): publish and ship

- Publish and unpublish by changing `status` only (§6). **No newsletter param.** Show a
  confirmation dialog with the site title.
- Version banner (§10).
- A full pass on OCI: write, add an image, preview, publish, unpublish.
- `npm run tauri build`, then copy the `.app` from `src-tauri/target/release/bundle/macos/`
  to Applications.

✅ **Done:** you're writing real posts for your OCI site in your own app.

---

## 12. Roadmap after the weekend

> **Superseded.** The official roadmap is maintained in
> [`docs/architecture.md`](./architecture.md). It is reproduced here so this historical
> document stays self-contained.

| Version | Status | Contents |
|---|---|---|
| v0.1.0 – v0.4.0 | Shipped | Core editor, metadata sidebar, cards parity, theming, publishing/scheduling modal, newsletter safety gate, post visibility/tiers, revisions drawer |
| v0.5.0 Native | Active | Full macOS design system (`docs/design-system.md`), 3-pane rail, borderless canvas, Koenig retheme |
| v0.6.0 Auth | Planned | Password login in Rust, session cookie, 2FA verification code, Staff Access Token auto-retrieval, token rotation |
| v0.7.0 Scraps | Planned | Local-first private scratchpad in `tauri-plugin-store`, Promote to Draft, Demote to Scrap, zero server leakage |
| v0.8.0 Feature Complete | Planned | Offline draft cache, local autosave queue, edge-case hardening |
| v1.0.0-rc.1 Release Candidate | Planned | Apple code signing & notarization, `tauri-plugin-updater` with GitHub Releases, DMG & Windows installers |
| v1.0.0 General Availability | Planned | First official public release |

---

## 13. Risks

| Risk | Mitigation |
|---|---|
| Accidental newsletter send | Rule 4.2. No `newsletter` param until v0.4's guarded flow. |
| Lexical clobbered by HTML conversion | Rule 4.3 |
| Autosave racing itself, causing 409s | Single-flight saver (§8) |
| Koenig vs Ghost version mismatch | Pin to the target site's version, show a banner, then the full policy in v0.3 |
| Clock drift breaking tokens | Measure the offset from the `/site/` `Date` header |
| Auth dropped on redirect | Find the admin address at connect; `maxRedirections: 0` afterwards |
| Theme JS reaching Tauri IPC | Rule 4.6. Preview never renders inside the app. |
| Keys lost on restart | keyring feature flags (§5.1) |
| Large uploads slow over IPC | Fine for images. For big media, add a Rust upload command in v0.3 that streams from disk. |
| Trademark | Rule 4.7 |

---

## 14. Not yet verified — check during the build

**All resolved.** See §15 for the answers and §16 for what that changed.

1. ~~What `KoenigEditor`'s `onChange` passes~~ — plain JSON. §15.3.
2. ~~The return shape of `useFileUpload` and the `fileTypes` shape~~ — and `fileTypes`
   turned out to be **mandatory**. §15.1, §15.2.
3. ~~The HTTP plugin's URL pattern for arbitrary `https` hosts~~ — `https://*` does
   **not** match a non-default port; it must be `https://*:*`. Verified against the
   plugin's own parser in `src-tauri/tests/http_scope.rs`.
4. ~~Whether Koenig 1.12.0 works against Ghost 6.68~~ — avoided by pinning to 1.11.1
   (an exact version, not a caret range), which is what both sites ship.
5. ~~Ghost(Pro) with a custom domain~~ — `/ghost/` on everywayhuman.com returns **200**,
   no redirect to `*.ghost.io`. It does serve the standalone Koenig bundle.
6. ~~Whether the server accepts `Accept-Version: v6.0`~~ — yes, both sites. §15.5.
7. ~~Whether Koenig behaves under React StrictMode~~ — it does. §15.4.

---

## 15. Corrections found while building (Friday)

Each of these was found by reading the shipped code or running it, not by guessing.

### 15.1 `fileTypes` is mandatory — §7 as written crashes the editor

`makeFileUploader` returns `{ useFileUpload, fileTypes: FILE_TYPES }`, but `FILE_TYPES` is
never defined anywhere in the plan. Returning `undefined` is not survivable: the gallery
and video-thumbnail paths read the mime types **without** optional chaining:

```js
thumbnailMimeTypes: g.fileTypes.image.mimeTypes   // no ?. — throws if fileTypes is undefined
```

Inserting an image card then dies with `Cannot read properties of undefined (reading
'image')` and takes the whole editor tree down. Verified in a browser.

**Fix:** always supply `fileTypes`, at minimum with an `image` key:

```ts
export const FILE_TYPES = {
  image: {mimeTypes: ['image/*']},
  audio: {mimeTypes: ['audio/*']},
  video: {mimeTypes: ['video/*']},
};
```

The values reach the file input's `accept` attribute, so they must be valid MIME types.

### 15.2 The uploader contract, read out of the 1.11.1 bundle

| Thing | Verified shape |
|---|---|
| `useFileUpload(type)` | type ∈ `image`, `audio`, `video`, `file`, **`mediaThumbnail`** |
| return value | `{upload, progress, isLoading, errors, filesNumber}` |
| `upload(files)` | resolves to `{url, fileName}[]` (or `null`) |
| `errors` | rendered as `error.message` |
| `fileTypes` | `{image?: {mimeTypes}, audio?: {...}, video?: {...}}` — but `image` must exist |

`mediaThumbnail` is a fifth type the plan doesn't mention. The video card generates a
thumbnail **blob** client-side and uploads it through `useFileUpload("mediaThumbnail")`.
Mapping unknown types to `/media/upload/` (§7) would send an image blob to the media
endpoint. Map it to `/images/upload/` instead.

### 15.3 `onChange` is plain JSON — the plan is right, now verified

From the bundle: `KoenigEditor`'s `onChange` is `editorState.toJSON()`, i.e. a plain
object. (`KoenigComposableEditor`'s own `onChange` prop takes the `EditorState`.) So
`JSON.stringify(state)` is correct, and the payload round-trips straight into
`posts.lexical`. Verified by typing into a real draft in a browser.

### 15.4 StrictMode is fine

Left `React.StrictMode` **on** and mounted Koenig 1.11.1 with a real draft: no double-mount
errors, no duplicated nodes, typing emits one change. Keep it on.

### 15.5 The `aud` claim is correct, and versioned URLs would break it

`admin.js` verifies `aud` against a regex built from the request path:

```js
audience: new RegExp(`/?${api}/?$`)   // api === 'admin' for every /ghost/api/admin/... call
```

So `"aud": "/admin/"` matches, for every admin endpoint. Two traps:

- Put the version in the **path** (`/ghost/api/v6.0/admin/…`) and the regex becomes
  `/?v6.0/admin/?$`, which `/admin/` no longer matches → every call fails auth. The path
  matcher only accepts `v2|v3|v4|canary` anyway. **Keep URLs versionless and send
  `Accept-Version` as a header only**, as §5.3 already does.
- `jsonwebtoken@9.0.3` is what Ghost 6.68 uses. The Rust `mint()` in §5.1 was verified
  against that exact library: it verifies, and it rejects a tampered signature, a wrong
  secret, and a token older than 5 minutes.

## 16. What actually got built (and the dev-loop traps)

### 16.1 Use `npm run app`, not `npm run tauri dev`

`tauri dev` **always ad-hoc signs** the debug binary — it ignores
`APPLE_SIGNING_IDENTITY`. macOS binds Keychain access to an ad-hoc signature's
**cdhash**, which changes on every rebuild, so every Rust change makes the app a
new "application" as far as the Keychain is concerned:

> draftdesk wants to use your confidential information stored in "app.draftdesk"

That prompt blocks the event loop, the window never appears, and it recurs on each
rebuild. Worse, editing `Cargo.toml` (e.g. `cargo add`) makes `tauri dev` rebuild and
restart in a loop.

**Use `./scripts/dev.sh` (`npm run app`).** It builds, signs the binary with a stable
Apple Development identity (`TeamIdentifier=6SCLL89FZN`) under a fixed identifier, then
runs it. The Keychain ACL is then anchored to the team id, so the prompt happens once
and "Always Allow" sticks.

Delete a stale item after switching signing identities:
`security delete-generic-password -s app.draftdesk`.

### 16.2 Test suite

| Command | Covers |
|---|---|
| `npm run check` | `tsc --noEmit` + vitest (44 tests) |
| `npm run test:rust` | keyring round-trip, HTTP scope, JWT minting |
| `cargo test --test e2e_admin` | keychain → mint → real Ghost request (needs `DRAFTDESK_TEST_BASE` / `DRAFTDESK_TEST_KEY`) |

Credentials are read from the environment and never committed.

### 16.3 The saver's revision latch

§8 captures `revision` when the run starts, so a **Cmd+S arriving while a save is
already in flight never produces a revision** — `pending` is null at that moment.
Latch the flag inside the loop instead, and queue an empty patch when nothing is
pending so the keystroke is never silently dropped. There is a regression test for
exactly this.

### 16.4 Closing a window with unsaved work needs two extra permissions

`beforeunload` does not fire reliably when a Tauri window closes, so the "you have
unsaved changes" guard must hook `onCloseRequested` instead. That needs capabilities
`core:default` does not include — `core:window:default` is read-only and has neither
`close` nor `destroy`:

```json
"core:window:allow-close",
"core:window:allow-destroy"
```

(event listening is already in `core:event:default`.)

### 16.5 The release build

```bash
npm run tauri build
# src-tauri/target/release/bundle/macos/draftdesk.app   (7.6 MiB)
# src-tauri/target/release/bundle/dmg/draftdesk_0.1.0_aarch64.dmg
```

Bundle id `app.draftdesk.desktop`, `CFBundleName` `draftdesk`, no Ghost branding in
the plist. Ad-hoc signed, as expected for an unsigned v0.1.

**The release binary is a different code-signing identity from the dev binary**
(`draftdesk-386004c0ee6ad618` vs `draftdesk-fea7885625434c59`), so it is a different
Keychain principal. The key saved by the dev build is not silently readable by the
released app — the user re-enters it once and clicks Always Allow. That is correct
behaviour, not a bug.

### 16.6 What is still unproven

The React ↔ Tauri glue (`invoke` and `plugin-http` from inside the webview) is only
exercised when a human clicks through the app. Everything either side of it is tested:
the editor in a real browser, the API layer and saver in unit tests, and the Rust auth
path against both live sites.

---

## 17. Rust crate versions — the §11 commands no longer work

```bash
# plan says — both are wrong today
cargo add keyring --features apple-native,windows-native,sync-secret-service
cargo add hmac sha2 base64 hex serde_json
```

- **keyring is v4** and the features were renamed: `apple-native` →
  `apple-native-keyring-store`. The `v1` API the plan uses (`Entry::new(service, user)`,
  `set_password`, `get_password`, `delete_credential`) is unchanged, and `v1` is a
  **default** feature that already selects Keychain Services on macOS. So the §5.1
  "keyring has no default backends" warning is obsolete; the real v4 risk is forgetting
  that `v1` must stay enabled.
- **hmac/sha2 must be pinned to 0.12/0.10.** Current hmac is 0.13 on the RustCrypto
  `digest` 0.11 rewrite, where the `Mac`/`finalize` API changed and §5.1's code does not
  compile. `base64` pinned to 0.22.

```bash
cargo add keyring --features apple-native-keyring-store
cargo add hmac@0.12 sha2@0.10 base64@0.22 hex serde_json
```

---

## 18. Handoff status (Geist v0.4.0 complete → v0.5.0 next)

- **Project path**: `/Users/josiahelstrom/Documents/10 Projects/14 Coding/geist` (renamed from `draftdesk`).
- **App / Bundle ID**: `Geist` / `app.geist.desktop` (Keychain service `app.geist` with fallback migration from `app.draftdesk`).
- **v0.2.0 completed**:
  - Metadata sidebar (`src/components/MetadataSidebar.tsx`): feature image upload/remove + alt (191-char limit) + caption, URL slug, custom excerpt (300-char limit), tags with autocomplete & inline creation, authors with role guard, featured toggle, Open in Ghost Admin, and post deletion.
  - In-app preview window (`open_preview_window` in `src-tauri/src/lib.rs`): isolated external-origin `WebviewWindow` (`preview` label, zero Tauri IPC access) + `?member_status=anonymous|free|paid` toggles + browser fallback.
  - Search & filter in `PostList.tsx`: Drafts / Published / Scheduled / All tabs, instant search across title/slug/excerpt/tag/author, tag dropdown filter, and featured filter.
  - Conflict & error UX: Reload server version or Overwrite on `409`, Retry save on transient errors, and `adoptUpdatedAt` after publish/unpublish.
  - Site persistence via `tauri-plugin-store` (`geist-sites.json`) with migration from `localStorage`.
  - Test suite: 68 frontend tests (`npm run check`) + 19 Rust unit/scope/keychain tests (`npm run test:rust`) + 5 live e2e tests (`cargo test --test e2e_admin`).
- **v0.3.0 completed**:
  - Four 0.2.0 audit bugs fixed: no-op initial-mount `onChange` no longer marks a post `Unsaved`/schedules a `PUT`, `saverRef` is flushed before `← Posts`, `KoenigComposer` is wrapped in an error boundary with an "Open in Ghost Admin ↗" fallback for unknown Lexical nodes, and `MetadataSidebar` saves tags through `serializeTagsForSave`.
  - Full `cardConfig` parity (`src/lib/cardConfig.ts`): site settings (`membersEnabled`, `stripeEnabled`, `siteDescription`, `visibilitySettings`), snippets (fetch/create/delete), labels, link search + autocomplete, Unsplash, Klipy GIF, feature flags (`transistor`, `paywallImprovements`), and post visibility.
  - Full media upload parity (`src/lib/uploader.ts`): `/images/` (+ client-generated `mediaThumbnail`), `/media/` for audio and video, and `/file/` for everything else, all verified against live Ghost.
  - CSS token theming with system/dark/light mode (`src/lib/theme.ts`) plus GPU transform compositing for smoother scrolling.
  - `MIN_GHOST` / `MAX_GHOST` compatibility policy (`src/lib/version.ts`): `5.0`–`6.68` editable, older shows a warning banner, newer is enforced read-only with an explicit per-site override, and an undetectable version stays editable but carries a warning banner.
  - Test suite: 114 frontend tests (`npm run check`, 9 files) + 19 Rust tests + 5 live e2e tests.
- **v0.4.0 completed**:
  - Publish & Schedule modal (`src/components/PublishModal.tsx`, `src/lib/posts.ts`): web-only publish (default), scheduled publishing (`status: "scheduled"` + future ISO `published_at`) and unscheduling back to draft, and guarded newsletter sending (`?newsletter=<slug>&email_segment=<segment>` + optional `email_only: true`) gated behind an explicit confirmation showing the active member count (`GET /newsletters/?filter=status:active&include=count.active_members`).
  - Post access & paid tiers (`src/components/MetadataSidebar.tsx`): `visibility` (`public`, `members`, `paid`, `tiers`) with role guard (`canEditVisibilityRole`) and paid tier selection (`GET /tiers/`).
  - Revisions drawer & restore (`src/components/RevisionsDrawer.tsx`, `src/lib/revisions.ts`): loads `post_revisions` and `post_revisions.author`, previews historical title/excerpt/Lexical plain text, and restores any revision into the editor with a new revision save.

### Next up

The agreed post-v0.4.0 sequence, in order. Each milestone assumes the one before it has
landed; do not start a later one early.

1. **v0.5.0 Native** (7–10 days) — Native macOS design system (`docs/design-system.md`):
   vibrancy shell (`titleBarStyle: "Overlay"`, sidebar vibrancy, native macOS menu bar),
   three-pane Ghost Admin / Apple Notes / Ulysses hybrid layout, borderless
   distraction-free editor canvas, and the Koenig typography/dark-mode retheme.
2. **v0.6.0 Auth** (3–4 days) — Password login (§5.4 in Rust): a session cookie obtained
   from `POST /session/` with the site's own `Origin`, 2FA verification code handling
   (`PUT /session/verify/`), automatic Staff Access Token retrieval (`GET /users/me/token/`)
   so the user never has to paste a key, and token rotation. Built on the v0.5 design system.
3. **v0.7.0 Scraps** (4–6 days) — Local-first private notes and scratchpad area. Scraps are
   stored purely locally on macOS with `tauri-plugin-store` (zero network latency, offline, and
   completely private — never uploaded to Ghost or visible to other publication staff).
   **Promote to Draft** creates a new Ghost draft via `POST /posts/?formats=lexical` with the
   scrap's title and Lexical body and opens it directly in the editor. **Demote to Scrap** (plus
   optional drag-and-drop from the post list) backs up an existing draft's title, excerpt, and
   Lexical JSON to local Scraps storage, confirms with the user, then cleans up the server copy
   via `DELETE /posts/{id}/`. The Scraps list lives in `NavigationRail` with instant local
   search, word count, and last-edited timestamps.
4. **v0.8.0 Distribution** (1 week) — Local draft cache / offline support, macOS
   notarization, `tauri-plugin-updater`, and Windows (WebView2) testing.
