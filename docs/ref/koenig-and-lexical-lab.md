# Koenig Lexical Cards & the Lexical Lab Editor

> Reference for every native Ghost Koenig card bundled in
> `@tryghost/koenig-lexical@1.13.1`, plus the architecture of Geist's
> `lexical-lab` editor.
>
> Card schemas were extracted from the bundled
> `kg-default-nodes/build/esm/nodes/*` sources (shipped inside
> `koenig-lexical.js.map`), and menu metadata from the `static kgMenu` entries in
> that same bundle. Uploader/card-config contracts are taken from the live
> `src/lib/uploader.ts` and `src/lib/cardConfig.ts` implementations.
>
> **Bundled versions:** Koenig `1.13.1`, Lexical `0.13.1` (Koenig's internal
> copy), app-level Lexical `0.53.x`, React `18.3.1`.
>
> Ghost's supported range in this app is 5.0 – 6.73; Koenig is pinned exactly,
> never floated with a caret.

---

## 1. Executive Summary & Philosophy

Geist ships **two editor engines**, selected by `uiPrefs.editorEngine`:

| Engine | Value | Entry point | What it is |
|---|---|---|---|
| Koenig | `"koenig"` | `src/components/Editor.tsx` | The real Ghost editor (`KoenigComposer` + `KoenigEditor`). Native card UI, native drag/drop, native slash menu. |
| Lexical Lab | `"lexical-lab"` | `src/components/lab/LexicalLabEditor.tsx` | A plain-Lexical editor that fakes a Markdown-first authoring surface while persisting the same Ghost Lexical JSON. |

### 1.1 Path A — Koenig WYSIWYG

Path A is the straightforward integration:

```tsx
<KoenigComposer
  initialEditorState={post.lexical}
  fileUploader={fileUploader}
  cardConfig={cardConfig}
>
  <KoenigEditor onChange={state => save(JSON.stringify(state))} />
</KoenigComposer>
```

- Every card is a first-class `KoenigDecoratorNode` with its own React editor.
- `onChange` receives **plain JSON** (`editorState.toJSON()`), not a Lexical
  `EditorState` object.
- Saving writes that JSON string to `posts.lexical` unchanged.
- Card UI, slash menu, snippets, visibility toggles, Unsplash/Klipy pickers and
  uploaders are all supplied by the bundle.

### 1.2 Fake Path B — the Lexical Lab editor

Path B is deliberately **not** a second storage format. It is a different
authoring surface over the same `posts.lexical` field.

It is "fake" in two directions:

1. **Markdown-native on the surface.** The editor uses standard Lexical nodes
   and `@lexical/markdown` shortcuts. It shows Markdown-ish authoring
   (`# heading`, `> quote`, `---`, `[^1]`) rather than Koenig's card chrome.
2. **Ghost-native underneath.** Ghost has no `markdown` document type. On every
   change the Lab editor unwraps its internal representation back to Ghost's
   expected node names — `extended-text`, `extended-heading`, `extended-quote`,
   `#fn…` links, and an HTML card for footnotes — before handing the JSON to the
   saver.

The key abstraction is `GhostCardNode`: an **opaque decorator node** that stores
an arbitrary native Ghost card payload (`{type, version, ...fields}`) without
trying to understand it. This is what lets unknown or not-yet-modelled cards
survive a Lab edit instead of crashing `parseEditorState` with
`type "image" not found`.

Philosophy:

- **Never lose a card.** Unknown node types become `GhostCardNode`s rather than
  parse errors.
- **Never invent a storage path.** The output is always valid Ghost Lexical
  JSON, not Markdown and not Lab-specific JSON.
- **Prefer standard Lexical.** Lab nodes are public `lexical` /
  `@lexical/*` classes, not Koenig internals, so the editor owns its typography
  and keyboard model.
- **Degrade visibly.** A card the Lab cannot render becomes a labelled opaque
  block with a payload inspector; an HTML card gets a source/preview editor.

Trade-offs (and known gaps at the time of writing):

- There is **no native card editing UI** for non-HTML cards. They render as an
  opaque "Ghost Card / `<type>`" block with an optional JSON payload view.
- The Markdown presentation pass (`lexicalJsonToMarkdown` →
  `markdownToLexicalJson`) **cannot represent `GhostCardNode`s**. A decorator
  with no Markdown transformer exports as its `getTextContent()`, which for a
  Ghost card is `\n[Ghost Card: <type>]\n`. Cards are therefore preserved by the
  wrap/unwrap conversions but are not preserved by that Markdown normalization
  path. See §6.8.
- Standard Lexical code fences produce a `code` node. Ghost expects a
  `codeblock` card. A conversion is still on the roadmap (§7.5).

### 1.3 Invariants

1. `posts.lexical` is a **JSON string** with a `{root: {...}}` envelope.
2. Ghost node names must be preserved exactly (`extended-text`, `codeblock`,
   `call-to-action`, …).
3. Unknown cards must round-trip **byte-for-byte** through
   `wrapUnknownGhostCards` → `unwrapGhostCards`.
4. Never send `html` when saving Lexical. Never use `?source=html`; Ghost will
   overwrite the Lexical document with a lossy HTML conversion.
5. Absolute URLs are required in payloads; Ghost rewrites them to
   `__GHOST_URL__/…` on storage.

---

## 2. Card System Primer

### 2.1 Serialized shape

Every card is a decorator node in `root.children`:

```json
{
  "root": {
    "type": "root",
    "version": 1,
    "direction": "ltr",
    "format": "",
    "indent": 0,
    "children": [
      /* card nodes here */
    ]
  }
}
```

A card's serialized form is:

```ts
type SerializedKoenigCard = {
  type: string;      // card type, e.g. "image"
  version: number;   // usually 1; header uses 1 or 2
  [field: string]: unknown;
};
```

Koenig cards are generated by `generateDecoratorNode({nodeType, version,
properties, hasVisibility})`:

- A `properties` map supplies each field's `default`.
- `exportJSON()` emits **`type` + `version` + every property**, in property
  declaration order (some cards override to rename or omit fields).
- `importJSON()` copies known properties and **drops unknown properties**.
- With `hasVisibility: true`, a `visibility` property is added and migrated from
  old formats on import.

> **Important for `GhostCardNode`:** because the Lab wrapper stores the raw
> payload rather than using Koenig's `importJSON`, fields that Koenig itself
> would drop (for example `metadata.url` in a bookmark payload) are preserved.

### 2.2 Card menu contract (`kgMenu`)

Koenig builds its plus/slash menu by scanning registered nodes for a `kgMenu`
entry (`static kgMenu = {...}` or `[...]`). The menu item shape is:

```ts
type KgMenuItem = {
  section?: string;             // default "Primary"
  label: string;                // visible label
  desc: string;                 // helper text, often shows the shortcut
  Icon: React.ComponentType;    // SVG component
  insertCommand: Command;       // Lexical command dispatched on insert
  insertParams?: object | ((ctx: {config: CardConfig}) => object);
  matches: string[] | ((query: string, label?: string) => boolean);
  queryParams?: string[];       // e.g. ["url"] -> /image https://...
  priority?: number;            // ascending within a section
  shortcut?: string;            // "/image", "/image [url]"
  postType?: "post";            // hide on pages
  isHidden?: (ctx: {config: CardConfig}) => boolean;
};
```

Menu building semantics (`src/utils/buildCardMenu.ts`):

- `isHidden({config})` removes unavailable cards.
- `postType` removes cards when `config.post.displayName` differs (email CTA).
- With a query, `matches` entries are tested with **`startsWith`** (not fuzzy).
- `insertParams` may be a function evaluated with `{config}`.
- Items are grouped by `section`; `"Primary"` always comes first.
- Each section is sorted by ascending `priority`; items without priority sort
  last.
- Snippets are appended as a `"Snippets"` section when
  `cardConfig.snippets` is present.

### 2.3 Visibility model

Ghost's visibility object gates **web** and **email** independently:

```ts
const ALL_MEMBERS_SEGMENT = "status:free,status:-free";
const PAID_MEMBERS_SEGMENT = "status:-free";
const FREE_MEMBERS_SEGMENT = "status:free";
const NO_MEMBERS_SEGMENT = "";

const DEFAULT_VISIBILITY = {
  web: {nonMember: true, memberSegment: ALL_MEMBERS_SEGMENT},
  email: {memberSegment: ALL_MEMBERS_SEGMENT},
};
```

Semantics:

- `web.nonMember: true` → public visitors can see it.
- `web.memberSegment: ""` → no members can see it.
- `web.memberSegment: "status:free"` → free members only.
- `web.memberSegment: "status:-free"` → paid/comped/gift members.
- `email.memberSegment` has the same segment rules.

In this document, each card is labelled with one of:

| Label | Meaning |
|---|---|
| `VIS_FULL` | No `visibility` field. The card is rendered for everyone its medium allows. Adding a `visibility` key to the payload is ignored by Koenig (unknown field). |
| `VIS_MEMBERS_ONLY` | The card is gated by membership or delivery. It either defaults to members-only (`transistor`), draws a members boundary (`paywall`), or only renders in email (`email`, `email-cta`). |

Only **three** card nodes in 1.13.1 opt into the editable visibility property via
`hasVisibility: true`:

- `call-to-action`
- `html`
- `transistor` (with a members-only default)

All other cards are structurally `VIS_FULL`; any extra `visibility` field is not
part of their schema.

---

## 3. Complete Catalog of All 22 Native Ghost Koenig Cards

### 3.1 Summary table

| # | `type` | Menu label | Shortcut | Visibility | Renders |
|---|---|---|---|---|---|
| 1 | `image` | Image (+ Unsplash, GIF) | `/image` | `VIS_FULL` | web + email |
| 2 | `codeblock` | *(no menu entry)* | ` ``` ` + space | `VIS_FULL` | web + email |
| 3 | `markdown` | Markdown | `/md` | `VIS_FULL` | web + email |
| 4 | `video` | Video | `/video` | `VIS_FULL` | web + email |
| 5 | `audio` | Audio | `/audio` | `VIS_FULL` | web + email |
| 6 | `callout` | Callout | `/callout` | `VIS_FULL` | web + email |
| 7 | `call-to-action` | Call to action | `/cta` | `VIS_FULL` (editable) | web + email |
| 8 | `horizontalrule` | Divider | `/hr` | `VIS_FULL` | web + email |
| 9 | `html` | HTML | `/html` | `VIS_FULL` (editable) | web + email |
| 10 | `toggle` | Toggle | `/toggle` | `VIS_FULL` | web only |
| 11 | `button` | Button | `/button` | `VIS_FULL` | web + email |
| 12 | `bookmark` | Bookmark | `/bookmark [url]` | `VIS_FULL` | web + email |
| 13 | `file` | File | `/file` | `VIS_FULL` | web + email |
| 14a | `header` v1 | Header1 | `/header` | `VIS_FULL` | web + email |
| 14b | `header` v2 | Header | `/header` | `VIS_FULL` | web + email |
| 15 | `paywall` | Public preview | `/paywall` | `VIS_MEMBERS_ONLY` | web + email |
| 16 | `product` | Product | `/product` | `VIS_FULL` | web + email |
| 17 | `embed` | Other… (+ YouTube/Twitter/Vimeo/CodePen/Spotify/SoundCloud) | `/embed [url]` etc. | `VIS_FULL` | web + email |
| 18 | `email` | Email content | `/email` | `VIS_MEMBERS_ONLY` (email only) | email only |
| 19 | `gallery` | Gallery | `/gallery` | `VIS_FULL` | web + email |
| 20 | `email-cta` | Email call to action | `/email-cta` | `VIS_MEMBERS_ONLY` (email only) | email only |
| 21 | `signup` | Signup | `/signup` | `VIS_FULL` | web only |
| 22 | `transistor` | Transistor | `/transistor` | `VIS_MEMBERS_ONLY` | web + email |

Cards are listed below in the prompt's catalog order. Each "Default payload"
block is the JSON a fresh `new Node().exportJSON()` produces (or the minimal
canonical payload for stateless cards). Nulls, `false`, `0` and empty strings are
intentional defaults.

---

### 3.2 `image`

- **Menu:** label `Image`; desc `Upload, or embed with /image [url]`; matches
  `["image", "img"]`; priority `1`; shortcut `/image`; `queryParams: ["src"]`;
  `insertParams: {triggerFileDialog: true}`.
- **Extra menu entries** (all insert `image` nodes):
  - `Unsplash` — `/unsplash [search term or url]`, matches
    `["unsplash", "uns"]`, priority `3`, query param `src`, hidden unless
    `config.unsplash`.
  - `GIF` — `Search and embed gifs`, matches `["gif", "giphy", "klipy"]`,
    priority `17`, query param `src`, hidden unless `config.klipy`.
- **Description:** upload, URL, Unsplash, or Klipy GIF.
- **Visibility:** `VIS_FULL`.
- **Default payload:**

```json
{
  "type": "image",
  "version": 1,
  "src": "",
  "width": null,
  "height": null,
  "title": "",
  "alt": "",
  "caption": "",
  "cardWidth": "regular",
  "href": ""
}
```

Notes:

- `cardWidth` is `regular | wide | full`.
- `href` makes the image a link.
- `width` / `height` drive srcset generation.
- `src` beginning with `data:` is replaced with `"<base64String>"` on
  serialization; uploads must finish before saving.

---

### 3.3 `codeblock`

- **Menu:** **no `kgMenu` entry in 1.13.1.** The card is not inserted from the
  slash menu. It is created by the Markdown shortcut transformer:
  `CODE_BLOCK` regex `/^```(\w{1,10})?\s/` (triple backticks, optional language,
  then space).
- **Shortcut:** ` ``` ` + optional language + space.
- **Description:** fenced code block with optional syntax-highlight language and
  caption.
- **Visibility:** `VIS_FULL`.
- **Default payload:**

```json
{
  "type": "codeblock",
  "version": 1,
  "code": "",
  "language": "",
  "caption": ""
}
```

`language` is a highlight.js name (`javascript`, `python`, `bash`, …).

> The Lab editor currently registers Lexical's standard `CodeNode` for fenced
> code, whose serialized `type` is `code`, not `codeblock`. See §7.5.

---

### 3.4 `markdown`

- **Menu:** label `Markdown`; desc `Insert a Markdown editor card`; matches
  `["markdown", "md"]`; priority `19`; shortcut `/md`.
- **Description:** a card whose `markdown` string is rendered server-side.
- **Visibility:** `VIS_FULL`.
- **Default payload:**

```json
{
  "type": "markdown",
  "version": 1,
  "markdown": ""
}
```

---

### 3.5 `video`

- **Menu:** label `Video`; desc `Upload and play a video file`; matches
  `["video"]`; priority `13`; shortcut `/video`;
  `insertParams: {triggerFileDialog: true}`.
- **Visibility:** `VIS_FULL`.
- **Default payload:**

```json
{
  "type": "video",
  "version": 1,
  "src": "",
  "caption": "",
  "fileName": "",
  "mimeType": "",
  "width": null,
  "height": null,
  "duration": 0,
  "thumbnailSrc": "",
  "customThumbnailSrc": "",
  "thumbnailWidth": null,
  "thumbnailHeight": null,
  "cardWidth": "regular",
  "loop": false
}
```

Notes:

- `duration` is seconds.
- `thumbnailSrc` is the generated poster frame. `customThumbnailSrc` overrides
  it when the user picks one.
- `loop: true` renders autoplay/muted/controls-hidden.
- The video card calls the uploader with `mediaThumbnail` to generate the still
  frame; that still goes to `/images/upload/` (see §5).

---

### 3.6 `audio`

- **Menu:** label `Audio`; desc `Upload and play an audio file`; matches
  `["audio"]`; priority `14`; shortcut `/audio`;
  `insertParams: {triggerFileDialog: true}`.
- **Visibility:** `VIS_FULL`.
- **Default payload:**

```json
{
  "type": "audio",
  "version": 1,
  "duration": 0,
  "mimeType": "",
  "src": "",
  "title": "",
  "thumbnailSrc": ""
}
```

`duration` is seconds. `src`/`thumbnailSrc` must be absolute URLs.

---

### 3.7 `callout`

- **Menu:** label `Callout`; desc `Info boxes that stand out`; matches
  `["callout"]`; priority `9`; shortcut `/callout`.
- **Visibility:** `VIS_FULL`.
- **Default payload:**

```json
{
  "type": "callout",
  "version": 1,
  "calloutText": "",
  "calloutEmoji": "💡",
  "backgroundColor": "blue"
}
```

Notes:

- `calloutText` is HTML. Allowed tags are a small subset: `A`, `STRONG`, `EM`,
  `B`, `I`, `BR`, `CODE`, `MARK`, `S`, `DEL`, `U`, `SUP`, `SUB`.
- `calloutEmoji` can be `""` to render no emoji.
- `backgroundColor` accepts named tokens (`grey`, `white`, `blue`, `green`,
  `yellow`, `red`, `pink`, `purple`, `accent`) or a hex value.

---

### 3.8 `call-to-action`

- **Menu:** label `Call to action`; desc `Add a call to action to your post`;
  matches `["cta", "call-to-action", "email", "email-cta", "ad", "sponsored",
  "hidden"]`; priority `7`; shortcut `/cta`; `isHidden: () => false` (always
  shown in 1.13.1).
- **Visibility:** `VIS_FULL` by default; `hasVisibility: true`, so it accepts a
  `visibility` object and can be restricted.
- **Default payload:**

```json
{
  "type": "call-to-action",
  "version": 1,
  "layout": "minimal",
  "alignment": "left",
  "textValue": "",
  "showButton": true,
  "showDividers": true,
  "buttonText": "Learn more",
  "buttonUrl": "",
  "buttonColor": "#000000",
  "buttonTextColor": "#ffffff",
  "hasSponsorLabel": true,
  "sponsorLabel": "<p><span style=\"white-space: pre-wrap;\">SPONSORED</span></p>",
  "backgroundColor": "grey",
  "linkColor": "text",
  "imageUrl": "",
  "imageWidth": null,
  "imageHeight": null,
  "visibility": {
    "web": {"nonMember": true, "memberSegment": "status:free,status:-free"},
    "email": {"memberSegment": "status:free,status:-free"}
  }
}
```

Notes:

- `layout`: `minimal | immersive`.
- `textValue` is HTML.
- `linkColor`: `text | accent`.
- `imageUrl` is only rendered by the immersive layout.
- `backgroundColor`: named token or hex.

---

### 3.9 `horizontalrule`

- **Menu:** label `Divider`; desc `Insert a dividing line`; matches
  `["divider", "horizontal-rule", "hr"]`; priority `2`; shortcut `/hr`.
- **Visibility:** `VIS_FULL`.
- **Default payload:**

```json
{"type": "horizontalrule", "version": 1}
```

No other properties. `getTextContent()` returns `"---\n\n"`, which is how the
Lab's Markdown transformer round-trips it.

---

### 3.10 `html`

- **Menu:** label `HTML`; desc `Insert a HTML editor card`; matches `["html"]`;
  priority `18`; shortcut `/html`.
- **Visibility:** `VIS_FULL` by default; `hasVisibility: true`, so it accepts a
  `visibility` object.
- **Default payload:**

```json
{
  "type": "html",
  "version": 1,
  "html": "",
  "visibility": {
    "web": {"nonMember": true, "memberSegment": "status:free,status:-free"},
    "email": {"memberSegment": "status:free,status:-free"}
  }
}
```

Notes:

- Raw HTML is passed through. Ghost wraps it in
  `<!--kg-card-begin: html-->…<!--kg-card-end: html-->` on render.
- This is also the card type the Lab footnote pipeline emits for definitions
  and for inline references that need `id="fnref…"`.
- Unknown fields are dropped by Koenig's `importJSON`; `GhostCardNode` keeps
  them.

---

### 3.11 `toggle`

- **Menu:** label `Toggle`; desc `Add collapsible content`; matches
  `["toggle", "collapse"]`; priority `12`; shortcut `/toggle`.
- **Visibility:** `VIS_FULL` (renders web only; not a membership gate).
- **Default payload:**

```json
{
  "type": "toggle",
  "version": 1,
  "heading": "",
  "content": ""
}
```

Both fields are HTML strings. The card is a no-op in email.

---

### 3.12 `button`

- **Menu:** label `Button`; desc `Add a button to your post`; matches
  `["button"]`; priority `3`; shortcut `/button`.
- **Visibility:** `VIS_FULL`.
- **Default payload:**

```json
{
  "type": "button",
  "version": 1,
  "buttonText": "",
  "alignment": "center",
  "buttonUrl": ""
}
```

`alignment`: `left | center`. `buttonUrl` must be absolute.

---

### 3.13 `bookmark`

- **Menu:** label `Bookmark`; desc `Embed a link as a visual bookmark`; matches
  `["bookmark"]`; priority `4`; shortcut `/bookmark [url]`; query param `url`.
- **Visibility:** `VIS_FULL`.
- **Default payload:**

```json
{
  "type": "bookmark",
  "version": 1,
  "url": "",
  "metadata": {
    "icon": "",
    "title": "",
    "description": "",
    "author": "",
    "publisher": "",
    "thumbnail": ""
  },
  "caption": ""
}
```

Notes:

- The human-readable card content lives in **`metadata`**, not at the top level.
- Ghost's canonical stored payload sometimes includes `metadata.url`. Koenig's
  `BookmarkNode.exportJSON()` omits it, but `GhostCardNode` preserves it because
  it never reconstructs the object.
- `fetchEmbed(url, {type: "bookmark"})` supplies the metadata.

---

### 3.14 `file`

- **Menu:** label `File`; desc `Upload a downloadable file`; matches `["file"]`;
  priority `15`; shortcut `/file`;
  `insertParams: {triggerFileDialog: true}`.
- **Visibility:** `VIS_FULL`.
- **Default payload:**

```json
{
  "type": "file",
  "version": 1,
  "src": "",
  "fileTitle": "",
  "fileCaption": "",
  "fileName": "",
  "fileSize": 0
}
```

`fileSize` is bytes; Ghost formats it for display. `fileCaption` is plain text
in this node (no `urlType`).

---

### 3.15 `header` (v1 and v2)

One `header` node type with a `version` property. The menu exposes two entries:

**v1 (`Header1`)**

- label `Header1`; desc `Add a header`; matches `["v1_header", "v1_heading"]`;
  priority `11`; shortcut `/header`; `insertParams: () => ({version: 1})`.
- **Hidden by default:** `isHidden: ({config}) => config.deprecated?.headerV1 ??
  true`. Geist's `buildCardConfig` sets `deprecated: {headerV1: true}`, so v1 is
  hidden in the app's card menu.
- Legacy default payload:

```json
{
  "type": "header",
  "version": 1,
  "size": "small",
  "style": "dark",
  "buttonEnabled": false,
  "buttonUrl": "",
  "buttonText": "",
  "header": "",
  "subheader": "",
  "backgroundImageSrc": ""
}
```

**v2 (`Header`)**

- label `Header`; desc `Add a header`; matches `["header", "heading"]`;
  priority `11`; shortcut `/header`; `insertParams: () => ({version: 2})`.
- **Default payload (full current schema):**

```json
{
  "type": "header",
  "version": 2,
  "size": "small",
  "style": "dark",
  "buttonEnabled": false,
  "buttonUrl": "",
  "buttonText": "",
  "header": "",
  "subheader": "",
  "backgroundImageSrc": "",
  "accentColor": "#FF1A75",
  "alignment": "center",
  "backgroundColor": "#000000",
  "backgroundImageWidth": null,
  "backgroundImageHeight": null,
  "backgroundSize": "cover",
  "textColor": "#FFFFFF",
  "buttonColor": "#ffffff",
  "buttonTextColor": "#000000",
  "layout": "full",
  "swapped": false
}
```

Notes:

- `layout`: `regular | wide | full | split`.
- Colors accept hex or `accent` / `transparent` where the renderer supports it.
- `swapped` flips image/text in the split layout.
- `version` is a real property, so the serialized card drives which renderer is
  used (`1` or `2`).

---

### 3.16 `paywall`

- **Menu:** label `Public preview`; desc `Attract signups with a public intro`;
  matches `["public preview", "preview", "public intro", "members only",
  "paywall"]`; priority `6`; shortcut `/paywall`.
- **Visibility:** `VIS_MEMBERS_ONLY` (structural boundary; not a
  `visibility` property).
- **Default payload:**

```json
{"type": "paywall", "version": 1}
```

Renders `<!--members-only-->`. Everything below the divider follows the post's
access level. Free/paid segmentation is controlled by post settings, not by
fields on the card.

---

### 3.17 `product`

- **Menu:** label `Product`; desc `Add a product recommendation`; matches
  `["product"]`; priority `16`; shortcut `/product`.
- **Visibility:** `VIS_FULL`.
- **Default payload:**

```json
{
  "type": "product",
  "version": 1,
  "productImageSrc": "",
  "productImageWidth": null,
  "productImageHeight": null,
  "productTitle": "",
  "productDescription": "",
  "productRatingEnabled": false,
  "productStarRating": 5,
  "productButtonEnabled": false,
  "productButton": "",
  "productUrl": ""
}
```

Notes:

- `productTitle` and `productDescription` are HTML.
- `productStarRating` is `1`–`5`.
- `productButton` is the button label; `productUrl` is its destination.

---

### 3.18 `embed`

- **Menu:** a **list of entries**, all inserting the same `embed` node:
  - `Other...` — desc `/embed [url]`; matches `["embed"]`; priority `100`;
    shortcut `/embed [url]`; hidden in email editor.
  - `YouTube` — desc `/youtube [video url]`; matches `["youtube"]`;
    priority `1`; shortcut `/youtube [url]`.
  - `X (formerly Twitter)` — desc `/twitter [tweet url]`; matches
    `["twitter", "x"]`; priority `3`; shortcut `/twitter [url]`; hidden in
    email.
  - `Vimeo` — `/vimeo [video url]`; matches `["vimeo"]`; priority `4`;
    shortcut `/vimeo [url]`; hidden in email.
  - `CodePen` — `/codepen [pen url]`; matches `["codepen"]`; priority `5`;
    shortcut `/codepen [url]`; hidden in email.
  - `Spotify` — `/spotify [track or playlist url]`; matches `["spotify"]`;
    priority `6`; shortcut `/spotify [url]`; hidden in email.
  - `SoundCloud` — `/soundcloud [track or playlist url]`; matches
    `["soundcloud"]`; priority `7`; shortcut `/soundcloud [url]`; hidden in
    email.
- **Visibility:** `VIS_FULL`.
- **Default payload:**

```json
{
  "type": "embed",
  "version": 1,
  "url": "",
  "embedType": "",
  "html": "",
  "metadata": {},
  "caption": ""
}
```

Notes:

- `embedType`: `video | rich | photo | link`.
- `html` is the raw `<iframe>`/embed markup returned by `fetchEmbed`.
- `metadata` is provider-specific and opaque.
- If `fetchEmbed` returns `{type: "bookmark"}`, Koenig replaces the embed node
  with a bookmark node.

---

### 3.19 `email`

- **Menu:** label `Email content`; desc `Only visible when delivered by email`;
  matches `["email content", "only email"]`; priority `8`; shortcut `/email`;
  `postType: "post"` (hidden for pages).
- **Visibility:** `VIS_MEMBERS_ONLY` in the delivery sense — renders only in
  newsletters and is empty on the web.
- **Default payload:**

```json
{
  "type": "email",
  "version": 1,
  "html": ""
}
```

`html` supports Ghost replacement strings such as
`{first_name, "there"}`. It is not a visible card on the web.

---

### 3.20 `gallery`

- **Menu:** label `Gallery`; desc `Create an image gallery`; matches
  `["gallery"]`; priority `5`; shortcut `/gallery`;
  `insertParams: {triggerFileDialog: true}`.
- **Visibility:** `VIS_FULL`.
- **Default payload:**

```json
{
  "type": "gallery",
  "version": 1,
  "images": [],
  "caption": ""
}
```

Each image item:

```json
{
  "fileName": "a.png",
  "row": 0,
  "src": "https://example.com/a.png",
  "width": 1600,
  "height": 900,
  "title": "",
  "alt": ""
}
```

`row` groups images into rows (0-indexed). `caption` is HTML.

---

### 3.21 `email-cta`

- **Menu:** label `Email call to action`; desc `Target free or paid members with
  a CTA`; matches `["email", "cta", "email-cta"]`; priority `7`;
  `postType: "post"`; shortcut `/email-cta`.
- **Hidden by default:** `isHidden: ({config}) => config.deprecated?.emailCta ??
  true`. Geist does not set `deprecated.emailCta`, so this card is hidden.
- **Visibility:** `VIS_MEMBERS_ONLY` (email only; `segment` chooses audience).
- **Default payload:**

```json
{
  "type": "email-cta",
  "version": 1,
  "alignment": "left",
  "buttonText": "",
  "buttonUrl": "",
  "html": "",
  "segment": "status:free",
  "showButton": false,
  "showDividers": true
}
```

`segment` examples: `status:free`, `status:-free` (paid/comped/gift), or an
empty string for everyone. `html` is the CTA copy.

---

### 3.22 `signup`

- **Menu:** label `Signup`; desc `Convert visitors into members`; matches
  `["signup", "subscribe"]`; priority `10`; shortcut `/signup`.
- **Hidden unless** `config.membersEnabled`.
- **Dynamic insert params:**

```ts
{
  header: config.siteTitle ? `Sign up for ${config.siteTitle}` : "",
  subheader: config.siteDescription || "",
  disclaimer: "No spam. Unsubscribe anytime."
}
```

- **Visibility:** `VIS_FULL` (renders web only).
- **Default payload:**

```json
{
  "type": "signup",
  "version": 1,
  "alignment": "left",
  "backgroundColor": "#F0F0F0",
  "backgroundImageSrc": "",
  "backgroundSize": "cover",
  "textColor": "#000000",
  "buttonColor": "accent",
  "buttonTextColor": "#FFFFFF",
  "buttonText": "Subscribe",
  "disclaimer": "",
  "header": "",
  "layout": "wide",
  "subheader": "",
  "successMessage": "Email sent! Check your inbox to complete your signup.",
  "swapped": false,
  "labels": []
}
```

Notes:

- Property default for `textColor` is `""`, but the constructor normalizes it to
  `"#000000"` unless the background is `transparent` (and there is no image in
  a split layout). A stored default card therefore usually has `#000000`.
- `labels` is an array of Ghost label names applied to new members. It is added
  outside the generated property list.
- `buttonColor`: `accent` or hex.
- No-op in email.

---

### 3.23 `transistor`

- **Menu:** section `Embeds`; label `Transistor`; desc `Embed a Transistor
  podcast player`; matches `["transistor", "podcast"]`; priority `2`;
  shortcut `/transistor`.
- **Hidden unless** `config.feature.transistor === true`.
- **Visibility:** `VIS_MEMBERS_ONLY` by default. `hasVisibility: true`; the
  default visibility is:

```json
{
  "web": {"nonMember": false, "memberSegment": "status:free,status:-free"},
  "email": {"memberSegment": "status:free,status:-free"}
}
```

- **Default payload:**

```json
{
  "type": "transistor",
  "version": 1,
  "accentColor": "",
  "backgroundColor": "",
  "visibility": {
    "web": {"nonMember": false, "memberSegment": "status:free,status:-free"},
    "email": {"memberSegment": "status:free,status:-free"}
  }
}
```

Notes:

- The card has **no URL field**. It always renders the Transistor/Ghost embed
  (`https://partner.transistor.fm/ghost/embed/{uuid}`) and substitutes the
  member UUID at request/email time.
- Public visitors cannot use the embed because it needs a member UUID, hence
  `web.nonMember: false`.
- `isEmpty()` always returns `false`; the card is never considered empty.

---

## 4. Card Configuration Contract (`cardConfig.ts`)

Koenig's `cardConfig` is the bridge between the bundled editor and the Ghost
Admin API. Geist builds it with `buildCardConfig(site, state)` and adds
`fetchEmbed` at the call site (the caller owns that dependency).

### 4.1 Assembled shape

```ts
type CardConfigState = {
  settings: SiteSettings;
  snippets: Snippet[];
  postVisibility?: PostVisibility;
  onSnippetsChanged: () => void;
};

const cardConfig = {
  siteUrl: site.siteUrl,
  siteTitle: site.title,
  siteDescription: settings.siteDescription,
  membersEnabled: settings.membersEnabled,
  stripeEnabled: settings.stripeEnabled,
  unsplash: settings.unsplashEnabled ? DEFAULT_UNSPLASH_HEADERS : null,
  klipy: settings.klipy, // {apiKey, contentFilter?} | null
  deprecated: {headerV1: true},
  post: {
    displayName: "post",
    isPage: false,
    showTitleAndFeatureImage: true,
    visibility: postVisibility ?? "public",
  },
  feature: {
    transistor: settings.feature.transistor,
    paywallImprovements: settings.feature.paywallImprovements,
  },
  // only when /settings/ loaded:
  visibilitySettings: settings.membersEnabled ? "web and email" : "none",

  searchLinks: (term?: string) => Promise<LinkGroup[]>,
  fetchAutocompleteLinks: () => Promise<{label: string; value: string}[]>,

  // staff keys only:
  snippets,
  createSnippet: async ({name, value}) => void,
  deleteSnippet: async (snippet) => void,

  // staff key + members enabled:
  renderLabels: true,
  fetchLabels: () => Promise<string[]>,
};
```

And at the call site (`Editor.tsx`):

```ts
{
  ...buildCardConfig(site, {settings, snippets, postVisibility, onSnippetsChanged}),
  fetchEmbed: (url, {type}) => fetchEmbed(site, url, type),
}
```

`fetchEmbed` in `posts.ts` is:

```ts
export async function fetchEmbed(site: Site, url: string, type: string) {
  return api(site, `/oembed/?url=${encodeURIComponent(url)}&type=${type}`);
}
```

`type` is `"embed"` or `"bookmark"`. A bookmark response causes Koenig to
replace a newly inserted embed node with a bookmark node.

### 4.2 Key-by-key table

| Key | Type / return | Backed by | Notes |
|---|---|---|---|
| `siteUrl` | `string` | `/site/` | Absolute origin, used by link search and relative→absolute transforms. |
| `siteTitle` | `string` | `/site/` | Signup card default header. |
| `siteDescription` | `string` | `description` setting | Signup card default subheader. |
| `membersEnabled` | `boolean` | `members_signup_access !== "none"` or `members_enabled` | Hides Signup when false. |
| `stripeEnabled` | `boolean` | `paid_members_enabled` (preferred) or `stripe_connect_account_id` | Only true when members are enabled. Removes paid-member visibility toggles when false. |
| `unsplash` | headers object or `null` | `unsplash` setting; defaults **on** when missing | Enables the Unsplash menu entry. |
| `klipy` | `{apiKey, contentFilter?}` or `null` | `/config/` `klipy` or `klipy` setting | Enables the GIF menu entry. |
| `deprecated.headerV1` | `true` | hard-coded | Hides the v1 Header menu entry in Geist. Set to `false` to expose it. |
| `post` | `{displayName, isPage, showTitleAndFeatureImage, visibility}` | post metadata | `displayName: "post"` gates email-only menu entries (`postType: "post"`). |
| `feature.transistor` | `boolean` | `transistor` setting | Shows/hides the Transistor card. |
| `feature.paywallImprovements` | `boolean` | `labs.paywallImprovements` or `/config/` labs | Passed through for Koenig's newer paywall UI. |
| `visibilitySettings` | `"web and email" \| "none"` | settings loaded + members | Omitted entirely when `/settings/` failed, so Koenig keeps its default. |
| `searchLinks(term?)` | `Promise<LinkGroup[]>` | `/posts/`, `/pages/`, `/tags/` | Empty term returns Homepage + latest 5 posts. With a term: posts (10), pages (5), tags (5). NQL title/name search. |
| `fetchAutocompleteLinks()` | `Promise<{label,value}[]>` | same resources, 50 each | Used by Button and CTA URL pickers. Prefixes `Post:`/`Page:`/`Tag:`. |
| `snippets` | `{id,name,value}[]` | `/snippets/?limit=all&formats=lexical` | `value` is a **JSON string** of serialized Lexical nodes. Mobiledoc-only snippets are skipped. Staff only. |
| `createSnippet({name,value})` | `Promise<void>` | `POST /snippets/` or `PUT /snippets/{id}/` | Updates an existing snippet with the same name. Sends an empty mobiledoc alongside `lexical`. Staff only. |
| `deleteSnippet(snippet)` | `Promise<void>` | `DELETE /snippets/{id}/` | Staff only. |
| `fetchLabels()` | `Promise<string[]>` | `/labels/?limit=all&fields=name` | Staff + members only. |
| `renderLabels` | `true` | derived | Only present for staff + members. |

### 4.3 Degradation rules

Every loader catches failures and returns an empty/disabled result:

- `/settings/` failure → `DEFAULT_SETTINGS` (`loaded: false`,
  `membersEnabled: false`, `unsplashEnabled: false`).
- Snippets/labels failure → `[]`.
- Link search failure → empty groups.
- `klipy` malformed/missing key → `null`.
- `visibilitySettings` is omitted when settings did not load, rather than
  guessing `"none"`.

### 4.4 Unsplash headers

```ts
export const DEFAULT_UNSPLASH_HEADERS = {
  Authorization:
    "Client-ID 8672af113b0a8573edae3aa3713886265d9bb741d707f6c01a486cde8c278980",
  "Accept-Version": "v1",
  "Content-Type": "application/json",
  "App-Pragma": "no-cache",
  "X-Unsplash-Cache": true,
} as const;
```

Passed as `cardConfig.unsplash` only when the site's `unsplash` setting is
enabled. Koenig hides the Unsplash menu item when this is `null`.

### 4.5 Snippet serialization detail

Ghost's snippet create/edit schema requires `mobiledoc` next to `name` and
forbids unknown fields. Geist therefore sends a valid empty mobiledoc document:

```ts
export const EMPTY_MOBILEDOC = JSON.stringify({
  version: "0.3.1",
  atoms: [],
  cards: [],
  markups: [],
  sections: [[1, "p", [[0, [], 0, ""]]]],
});
```

`lexical` remains the authoritative content. This is why `listSnippets` asks for
`formats=lexical`; the default response is mobiledoc-only.

---

## 5. Media Uploader Contract (`uploader.ts`)

Koenig expects a **React hook**, not a plain function:

```ts
type FileUploader = {
  useFileUpload(type: FileUploadType): {
    upload(files: FileList | File[]): Promise<{url: string; fileName?: string}[]>;
    progress: number;       // 0–100
    isLoading: boolean;
    errors: {fileName?: string; message: string}[];
    filesNumber: number;    // number of files in the current batch
  };
  fileTypes: Record<"image" | "audio" | "video" | "file", {mimeTypes: string[]}>;
};
```

### 5.1 Types and MIME hints

```ts
export const FILE_TYPES = {
  image: {mimeTypes: ["image/*"]},
  audio: {mimeTypes: ["audio/*"]},
  video: {mimeTypes: ["video/*"]},
  file: {mimeTypes: ["*/*"]},
};
```

`fileTypes` is **mandatory**. Without it, inserting an image card throws
`Cannot read properties of undefined (reading 'mimeTypes')`. `mediaThumbnail` is
an upload *type* but not a file-input type, so it has no `fileTypes` entry.

### 5.2 Endpoints

```ts
export const ENDPOINTS = {
  image: "/images/upload/",
  mediaThumbnail: "/images/upload/", // client-generated still-frame blob
  file: "/files/upload/",
  audio: "/media/upload/",
  video: "/media/upload/",
};

export function endpointFor(type: string): string {
  return ENDPOINTS[type] ?? "/media/upload/";
}
```

Critical detail: `mediaThumbnail` goes to **`/images/upload/`**, not
`/media/upload/`, even though its name does not start with `image`. The video
card generates a still frame client-side and uploads it as an image.

### 5.3 Response parsing

Each endpoint returns its result under a different collection key:

```ts
export function urlFromUploadResponse(json: {
  images?: {url: string}[];
  files?: {url: string}[];
  media?: {url: string}[];
}): string | undefined {
  return json.images?.[0]?.url ?? json.files?.[0]?.url ?? json.media?.[0]?.url;
}
```

`upload()` posts `multipart/form-data` with a single `file` field per file,
sequentially, updating `progress` after each. Successful results are returned as
`{url, fileName}`; failures are accumulated in `errors` and rendered by Koenig
from `error.message`.

### 5.4 Upload flow summary

| Card | Upload type | Endpoint | Result fields used |
|---|---|---|---|
| Image / Gallery | `image` | `/images/upload/` | `src`, `width`, `height`, `fileName` |
| Video | `video` | `/media/upload/` | `src`, `fileName`, `mimeType`, dimensions, duration |
| Video poster | `mediaThumbnail` | `/images/upload/` | `thumbnailSrc`, thumbnail dimensions |
| Audio | `audio` | `/media/upload/` | `src`, `mimeType`, duration, thumbnail |
| File | `file` | `/files/upload/` | `src`, `fileName`, `fileSize` |

All URLs returned by Ghost are absolute and must be stored as-is.

---

## 6. Lexical Lab Editor Architecture

### 6.1 File map

| File | Responsibility |
|---|---|
| `src/components/lab/LexicalLabEditor.tsx` | React shell, composer, load/save lifecycle, footnote drawer, title, save status, engine switch. |
| `src/lib/lab/labNodes.ts` | Node registry passed to `createEditor` / `LexicalComposer`. |
| `src/lib/lab/GhostCardNode.ts` | Opaque card wrapper, HTML preview/sanitizer, Ghost↔Lab JSON conversion. |
| `src/lib/lab/FootnoteReferenceNode.ts` | Inline `[^label]` decorator node. |
| `src/lib/lab/footnoteSerializer.ts` | Footnote HTML compilation/parsing, reference↔link conversion, block wrapping. |
| `src/lib/lab/markdownTransformers.ts` | HR, footnote text-match, footnote definition transformers. |
| `src/lib/lab/markdownRoundtrip.ts` | `lexicalJsonToMarkdown` / `markdownToLexicalJson`. |
| `src/lib/lab/htmlCardShortcut.ts` | ` ```html ` / `/html` → HTML card; Enter/Space handlers. |
| `src/lib/lab/*.test.ts` | Unit and render coverage for the above. |

### 6.2 Node registry (`labNodes.ts`)

```ts
import {HeadingNode, QuoteNode} from "@lexical/rich-text";
import {HorizontalRuleNode} from "@lexical/extension";
import {ListNode, ListItemNode} from "@lexical/list";
import {LinkNode, AutoLinkNode} from "@lexical/link";
import {CodeNode} from "@lexical/code";
import {GhostCardNode} from "./GhostCardNode";
import {FootnoteReferenceNode} from "./FootnoteReferenceNode";

export const LAB_NODES = [
  HeadingNode,
  QuoteNode,
  HorizontalRuleNode,
  ListNode,
  ListItemNode,
  LinkNode,
  AutoLinkNode,
  CodeNode,
  GhostCardNode,
  FootnoteReferenceNode,
];
```

Design points:

- Standard Lexical nodes only. No Koenig node classes are imported, so the Lab
  does not depend on Koenig's React context or card components.
- `GhostCardNode` covers every Ghost card type, including types the Lab has
  never heard of.
- `FootnoteReferenceNode` is custom and inline.
- Paragraph and text nodes are Lexical built-ins and do not need registration.

The same list is used by `createEditor` in `markdownRoundtrip.ts` and by the
`LexicalComposer` `initialConfig`.

### 6.3 `GhostCardNode` — the opaque wrapper

Serialized shape:

```ts
export type SerializedGhostCardNode = Spread<
  {
    cardType: string;
    data: Record<string, unknown>;
  },
  SerializedLexicalNode
>;
```

Node API:

```ts
class GhostCardNode extends DecoratorNode<JSX.Element> {
  getCardType(): string;
  setCardType(cardType: string): void;
  getData(): Record<string, unknown>;
  setData(data: Record<string, unknown>): void;
  updateData(patch: Record<string, unknown>): void;
}
```

Serialization:

```json
{
  "type": "ghost-card",
  "cardType": "image",
  "data": {"type": "image", "version": 1, "src": "…"},
  "version": 1
}
```

Key behaviours:

- `data` is stored as a shallow copy and returned/mutated by reference through
  `getData()`; `setData` / `updateData` clone the top level.
- `exportDOM()` emits a placeholder
  `<div class="kg-card" data-kg-card="<type>">`; it is **not** a faithful Ghost
  renderer and is not used for saving.
- `getTextContent()` returns `\n[Ghost Card: <type>]\n`.
- `isInline()` is `false`; `isKeyboardSelectable()` is `true`.
- `decorate()` renders `GhostCardComponent`, which:
  - For `cardType === "html"`: renders a header (`Ghost Card` + `HTML` badge),
    a **View source / Preview** toggle, an auto-sizing `<textarea>` bound to
    `data.html`, and a sanitized preview.
  - For every other card: renders a dashed “Ghost Card / `<type>`” block with an
    **Inspect payload** toggle that pretty-prints `data`.
- HTML previews are sanitized by `sanitizeGhostCardHtml`, a conservative
  regex-based sanitizer (no DOMPurify dependency):
  - removes comments;
  - removes `script`, `style`, `iframe`, `object`, `embed`, `applet`, `frame`,
    `frameset`, `base`, `meta`, `link`, `form`;
  - strips `on*` event attributes;
  - neutralizes `javascript:`, `vbscript:`, and `data:text/html` in URL
    attributes (`href`, `src`, `action`, `formaction`, `poster`, `data`,
    `xlink:href`).
- An empty HTML card opens directly in source mode so a snippet can be pasted
  immediately.

### 6.4 Bidirectional conversion: `wrapUnknownGhostCards` (Ghost → Lab)

`wrapUnknownGhostCards(node, knownTypes?, options?)` recursively transforms a
Ghost/Koenig document:

1. **`extended-text` → `text`.**
   Koenig stores body copy as `extended-text`; standard Lexical has no such
   type. The text is preserved, not turned into a card.
2. **`extended-heading` → `heading`.**
   Recurses into children; `tag` is preserved.
3. **`extended-quote` → `quote`.**
   Recurses into children.
4. **Ghost footnote link → `footnote-reference`.**
   A `link` whose `url` starts with `#fn` but **not** `#fnref` becomes
   `{type: "footnote-reference", label, version: 1}`.
5. **Footnote HTML card → dropped + extracted.**
   If an array item is a footnotes card (detected by `isFootnotesHtmlCard`), its
   definitions are parsed by `extractFootnoteDefinitionsFromHtml` and passed to
   `options.onExtractFootnotes`; the card is removed from the editor state.
6. **Inline footnote reference HTML card → lexical nodes.**
   If an inline reference was saved as an HTML card (to keep
   `id="fnref…"`), `convertFootnoteHtmlCardToLexicalNodes` parses it back into
   inline text/link/footnote nodes.
7. **Unknown node type → `ghost-card`.**
   Any type not in `knownTypes` becomes:

   ```json
   {
     "type": "ghost-card",
     "cardType": "<original type>",
     "data": { /* the original node, untouched */ },
     "version": 1
   }
   ```

   This is what prevents `parseEditorState` from throwing on native cards.
8. **Already-wrapped `ghost-card`** is returned unchanged (idempotent).

Known types:

```ts
const DEFAULT_KNOWN_TYPES = new Set([
  "root", "paragraph", "text",
  "extended-text", "heading", "extended-heading",
  "quote", "extended-quote", "horizontalrule",
  "list", "listitem", "link", "autolink", "code",
  "ghost-card", "footnote-reference",
]);
```

### 6.5 Bidirectional conversion: `unwrapGhostCards` (Lab → Ghost)

`unwrapGhostCards(node, footnoteDefinitions?)` applies `unwrapNodes` and then
rebuilds Ghost-only structures:

1. **`text` → `extended-text`.**
2. **`quote` → `extended-quote`** (recursing into children).
3. **`heading` → `extended-heading`** (recursing into children).
4. **`footnote-reference` → Ghost link.**

   ```json
   {
     "type": "link",
     "version": 1,
     "url": "#fn<label>",
     "children": [
       {"type": "extended-text", "version": 1, "text": "<label>", "format": 64}
     ]
   }
   ```

   `format: 64` is Lexical's superscript bit. This matches Ghost's
   `<a href="#fn1"><sup>1</sup></a>` rendering.
5. **`ghost-card` → original payload.**
   The wrapper is discarded and `data` is returned (recursively normalized).
   This is the lossless step: the payload is emitted exactly as it was captured,
   not reconstructed field-by-field.
6. **Footnote card is appended** by `attachFootnoteCardIfNeeded` (see §6.6).
7. **Footnote-bearing blocks become HTML cards** by
   `convertFootnotedParagraphsToHtmlCards`, so the `id="fnref…"` back-reference
   target survives a Ghost render. It only wraps block types in
   `BLOCK_TYPES` (paragraph, heading, quote) and deliberately skips lists and
   nested cards.

### 6.6 Footnotes pipeline

The Lab implements Markdown-style footnotes end to end, but stores them in
Ghost's native footnote HTML shape.

#### 6.6.1 Inline reference node

`FootnoteReferenceNode`:

- Type: `footnote-reference`
- Serialized: `{type: "footnote-reference", label: "1", version: 1}`
- `createDOM()`: `<span class="lexical-lab-fn-ref-wrapper" data-label="1"
  id="fnref1">`
- `exportDOM()`: `<sup class="lexical-lab-fn-ref" data-label="1"><a
  href="#fn1">[1]</a></sup>`
- `getTextContent()`: `[^1]`
- Inline, keyboard selectable.
- `decorate()` renders a `<sup>` badge. Clicking it dispatches:

```ts
window.dispatchEvent(
  new CustomEvent("lexical-lab:jump-footnote", {detail: {label}})
);
```

The editor listens for that event, expands the footnotes drawer, and focuses the
matching `[data-footnote-editor]` textarea.

#### 6.6.2 Typing `[^1]`

`FOOTNOTE_TEXT_MATCH_TRANSFORMER` in `markdownTransformers.ts`:

```ts
{
  dependencies: [FootnoteReferenceNode],
  export: node => $isFootnoteReferenceNode(node) ? `[^${node.getLabel()}]` : null,
  importRegExp: /(?:\[\^([a-zA-Z0-9_-]+)\])/,
  regExp: /(?:\[\^([a-zA-Z0-9_-]+)\])$/,
  trigger: "]",
  type: "text-match",
  replace: (textNode, match) => {
    textNode.replace($createFootnoteReferenceNode(match[1]));
  },
}
```

Typing `[^1]` and then `]` converts the text node into an inline decorator.

#### 6.6.3 Definition drawer

Definitions are **not stored as nodes** while editing. They live in React state:

```ts
const [footnotes, setFootnotes] = useState<Record<string, string>>({});
const footnotesRef = useRef<Record<string, string>>({});
```

UI:

- Bottom drawer: `data-testid="footnotes-section"`.
- Header shows count and a `+ Add Footnote` button.
- Each item: label `[1]`, an auto-growing `<textarea>`
  `data-footnote-editor="1"`, a live rich preview, a jump button (`↩`), and a
  delete button.
- Typing a definition line `[^1]: some text` and pressing Enter also defines
  it: `FootnoteDefinitionPlugin` matches
  `/^\[\^([a-zA-Z0-9_-]+)\]:\s*(.*)$/`, calls `onDefineFootnote`, and removes the
  paragraph.
- `OnChangePlugin` adds an empty definition for any new reference label it sees.

Definitions may contain HTML (`<i>`, `<em>`, `<b>`, `<a>`) or Markdown
(`*italic*`, `**bold**`, `[label](url)`). `formatFootnoteDefinitionText`
normalizes both into HTML for the stored footnote card, and
`hasFootnoteDefinitionFormatting` decides whether to show a preview.

#### 6.6.4 Export: compile to a Ghost HTML card

`unwrapGhostCards(json, definitions)` calls `attachFootnoteCardIfNeeded`:

1. Remove any existing footnotes card.
2. Collect reference labels **in document order** via
   `findFootnoteReferenceLabels`.
3. Add definitions not referenced at the end.
4. Compile:

```ts
compileFootnotesCard([{id: "1", text: "First note"}]);
```

produces:

```json
{
  "type": "html",
  "version": 1,
  "html": "<hr class=\"footnotes-sep\">\n<section class=\"footnotes\">\n  <ol class=\"footnotes-list\">\n    <li id=\"fn1\" class=\"footnote-item\">\n      <p>First note <a href=\"#fnref1\" class=\"footnote-backref\">↩</a></p>\n    </li>\n  </ol>\n</section>"
}
```

Exact HTML shape (`compileFootnotesHtml`):

```html
<hr class="footnotes-sep">
<section class="footnotes">
  <ol class="footnotes-list">
    <li id="fn1" class="footnote-item">
      <p>Definition text <a href="#fnref1" class="footnote-backref">↩</a></p>
    </li>
  </ol>
</section>
```

Then `convertFootnotedParagraphsToHtmlCards` walks the document. Any
paragraph/heading/quote containing a footnote reference becomes:

```json
{
  "type": "html",
  "version": 1,
  "html": "<p>Text<a href=\"#fn1\" id=\"fnref1\"><sup>1</sup></a></p>"
}
```

Why: Ghost renders a Lexical `link` as `<a href="#fn1"><sup>1</sup></a>` with no
`id`. The footnote card's `href="#fnref1"` back-reference therefore cannot find
its target. Emitting the reference inside an HTML card lets the Lab include
`id="fnref1"`.

#### 6.6.5 Import: parse the Ghost card back

On load:

1. `wrapUnknownGhostCards` sees the footnotes HTML card.
2. `isFootnotesHtmlCard` detects it by `class="footnotes"`,
   `class="footnotes-sep"`, or `<section class="footnotes">`.
3. `extractFootnoteDefinitionsFromHtml` matches
   `<li id="fn…">…</li>`, strips the backref `<a class="footnote-backref">`
   and `<p>` wrappers, and returns `{label: text}`.
4. The card is dropped from the editor state.
5. Inline reference HTML cards are converted back to inline nodes by
   `convertFootnoteHtmlCardToLexicalNodes`.
6. Ghost links `#fn1` (but not `#fnref1`) become `FootnoteReferenceNode`s.

`importDocumentWithFootnotes` / `exportDocumentWithFootnotes` expose the same
pipeline as standalone helpers for tests and other callers.

### 6.7 Markdown shortcuts & HTML insertion

#### 6.7.1 Transformer set

`LAB_MARKDOWN_TRANSFORMERS` is:

```ts
[
  HORIZONTAL_RULE_TRANSFORMER,
  FOOTNOTE_TEXT_MATCH_TRANSFORMER,
  ...TRANSFORMERS, // @lexical/markdown defaults
]
```

`HORIZONTAL_RULE_TRANSFORMER` adds what `@lexical/markdown` no longer ships:

```ts
{
  dependencies: [HorizontalRuleNode],
  export: node => $isHorizontalRuleNode(node) ? "---" : null,
  regExp: /^(?:---|\*\*\*|___)\s*$/,
  replace: parentNode => parentNode.replace($createHorizontalRuleNode()),
  type: "element",
}
```

Result: `---`, `***`, and `___` round-trip to `horizontalrule` nodes, which
`unwrapGhostCards` leaves as Ghost's native `horizontalrule`.

When `onDefineFootnote` is supplied, `createLabMarkdownTransformers` also
prepends a definition transformer:

```ts
{
  regExp: /^\[\^([a-zA-Z0-9_-]+)\]:\s*(.*)$/,
  replace: (parentNode, _children, match) => {
    onDefineFootnote(match[1], match[2].trim());
    parentNode.remove();
  },
  triggerOnEnter: true,
  type: "element",
}
```

#### 6.7.2 HTML card insertion

`htmlCardShortcut.ts` recognizes three forms:

```ts
// bare trigger: empty card
const EMPTY_HTML_CARD_PATTERN = /^(?:```html|\/html)$/i;

// complete fenced block
const FENCED_HTML_PATTERN = /^```html\s*([\s\S]*?)```$/i;

// opening fence with inline content and no closing fence yet
const OPEN_FENCED_HTML_PATTERN = /^```html(?:[ \t]+|\r?\n+)([\s\S]*)$/i;
```

Examples:

| Typed text | Result |
|---|---|
| ` ```html ` + Space/Enter | empty HTML card |
| `/html` + Space/Enter | empty HTML card |
| ` ```html <div>Hi</div> ` + Enter | HTML card with `<div>Hi</div>` |
| ` ```html\n<div>Hi</div>\n``` ` + Enter | HTML card with the fenced content |

`registerHtmlCardShortcut(editor)` registers the handler on both
`KEY_ENTER_COMMAND` and `KEY_SPACE_COMMAND` at `COMMAND_PRIORITY_HIGH`.

Important details:

- It ignores events whose target is a `TEXTAREA` or `INPUT`, so typing in the
  HTML card's own source editor is never treated as a shortcut.
- `$applyHtmlCardShortcut` only acts on a collapsed selection in a top-level
  paragraph whose entire text matches a trigger.
- The paragraph is replaced with
  `$createGhostCardNode("html", {type: "html", version: 1, html})`.
- If the card is the last block, a trailing paragraph is inserted and selected;
  otherwise the next block is selected. This keeps the user typing.

#### 6.7.3 Markdown round-trip helpers

```ts
lexicalJsonToMarkdown(json: string): string
markdownToLexicalJson(md: string): string
```

- `lexicalJsonToMarkdown` first calls `wrapUnknownGhostCards` so
  `extended-text` is not lost, then parses with `LAB_NODES`, then
  `$convertToMarkdownString(LAB_MARKDOWN_TRANSFORMERS)`.
- `markdownToLexicalJson` uses `$convertFromMarkdownString` with the same
  transformers.
- Both catch errors and return `""` / an empty editor state rather than
  throwing.

### 6.8 Load/save lifecycle (and the card caveat)

On open, `LexicalLabEditor`:

1. Fetches the post (`fetchPost`) or scrap.
2. Parses `post.lexical` / `scrap.lexical`.
3. `wrapUnknownGhostCards(parsed, undefined, {onExtractFootnotes})` extracts
   footnote definitions and wraps cards.
4. Converts the wrapped JSON to Markdown and back to Lexical
   (`lexicalJsonToMarkdown` → `markdownToLexicalJson`) to get a clean Lab
   document.
5. Stores the result as `lastSavedContentRef` and passes it to
   `LexicalComposer`.

On every change (`OnChangePlugin`):

1. `findFootnoteReferenceLabels(json)` adds missing footnote definitions.
2. `unwrapGhostCards(json, currentDefs)` converts Lab nodes back to Ghost
   nodes and appends the footnote HTML card.
3. `JSON.stringify` is sent to `onSave` / the saver (`queueDebounced`).

**Caveat:** step 4 is text-centric. `GhostCardNode` has no Markdown
transformer, so a card exports as `getTextContent()` — the literal string
`[Ghost Card: image]` — and is then re-created as a plain paragraph. In other
words, the wrap/unwrap conversions are lossless, but the Markdown presentation
pass is **not** card-preserving. Until this is changed, opening a card-heavy post
in the Lab can flatten its cards. The safe fix is to skip the Markdown
normalization when `wrapUnknownGhostCards` produced any `ghost-card`, or to add
lossless Markdown sentinels for cards.

### 6.9 Relationship to the Koenig editor

Both engines write the same field. Switching engines is safe only after a
flush:

```ts
handleToggleEngine = () => {
  const flip = () => setUiPrefs({
    editorEngine: uiPrefs.editorEngine === "lexical-lab" ? "koenig" : "lexical-lab",
  });
  if (scrapId) void flushSave().then(flip);
  else void saverRef.current?.flush().then(flip);
};
```

The Lab uses `createSaver` exactly like the Koenig path, so collision handling,
`updated_at` adoption and revision queuing are unchanged.

---

## 7. Future Roadmap: Slash Menu for Lexical Lab

The Lab currently only special-cases `/html`. The goal is a full slash menu that
mirrors Koenig's `kgMenu`, but inserts a native Ghost payload wrapped in
`GhostCardNode`.

### 7.1 Target behaviour

- Typing `/` at the start of an empty top-level paragraph opens a menu.
- Typing further characters filters (`/im` → Image).
- Query parameters are supported (`/image https://…` fills `src`).
- Arrow keys navigate; Enter inserts; Esc closes and restores the caret.
- Sections follow Koenig: `Primary` first, then `Embeds`, then any other
  sections.
- Unavailable cards are hidden using the same rules as Koenig
  (`membersEnabled`, `feature.transistor`, `deprecated.*`, `postType`, etc.).
- Insertion creates `GhostCardNode(cardType, {type: cardType, version: 1, ...data})`
  and then `unwrapGhostCards` emits the native payload on save.

### 7.2 Card menu registry

Create `src/lib/lab/cardMenu.ts`:

```ts
import {VIS_FULL, VIS_MEMBERS_ONLY} from "./visibility";

export type LabCardMenuContext = {
  siteUrl: string;
  siteTitle: string;
  siteDescription: string;
  membersEnabled: boolean;
  stripeEnabled: boolean;
  unsplashEnabled: boolean;
  klipyEnabled: boolean;
  transistorEnabled: boolean;
  emailCtaEnabled: boolean;
  headerV1Enabled: boolean;
  postType: "post" | "page";
};

export type LabCardMenuEntry = {
  cardType: string;
  label: string;
  desc: string;
  shortcut: string;
  matches: string[];
  section?: "Primary" | "Embeds" | "Membership" | "Email" | "Snippets";
  priority: number;
  visibility: typeof VIS_FULL | typeof VIS_MEMBERS_ONLY;
  /** Resolve insert-time defaults (signup, header version, etc.). */
  insertParams?: (ctx: LabCardMenuContext) => Record<string, unknown>;
  isHidden?: (ctx: LabCardMenuContext) => boolean;
  /** Optional URL/query params, in the same order as the shortcut. */
  queryParams?: Array<"src" | "url">;
  /** Opens an upload/file picker instead of inserting an empty card. */
  triggerFileDialog?: boolean;
};
```

Seed it from the catalog in §3. A representative slice:

```ts
export const LAB_CARD_MENU: LabCardMenuEntry[] = [
  {
    cardType: "image",
    label: "Image",
    desc: "Upload, or embed with /image [url]",
    shortcut: "/image",
    matches: ["image", "img"],
    priority: 1,
    visibility: VIS_FULL,
    queryParams: ["src"],
    triggerFileDialog: true,
  },
  {
    cardType: "callout",
    label: "Callout",
    desc: "Info boxes that stand out",
    shortcut: "/callout",
    matches: ["callout"],
    priority: 9,
    visibility: VIS_FULL,
  },
  {
    cardType: "html",
    label: "HTML",
    desc: "Insert a HTML editor card",
    shortcut: "/html",
    matches: ["html"],
    priority: 18,
    visibility: VIS_FULL,
  },
  {
    cardType: "header",
    label: "Header",
    desc: "Add a header",
    shortcut: "/header",
    matches: ["header", "heading"],
    priority: 11,
    visibility: VIS_FULL,
    insertParams: () => ({version: 2}),
  },
  {
    cardType: "header",
    label: "Header1",
    desc: "Add a header",
    shortcut: "/header",
    matches: ["v1_header", "v1_heading"],
    priority: 11,
    visibility: VIS_FULL,
    insertParams: () => ({version: 1}),
    isHidden: ctx => !ctx.headerV1Enabled,
  },
  {
    cardType: "signup",
    label: "Signup",
    desc: "Convert visitors into members",
    shortcut: "/signup",
    matches: ["signup", "subscribe"],
    priority: 10,
    visibility: VIS_FULL,
    isHidden: ctx => !ctx.membersEnabled,
    insertParams: ctx => ({
      header: ctx.siteTitle ? `Sign up for ${ctx.siteTitle}` : "",
      subheader: ctx.siteDescription,
      disclaimer: "No spam. Unsubscribe anytime.",
    }),
  },
  {
    cardType: "transistor",
    label: "Transistor",
    desc: "Embed a Transistor podcast player",
    shortcut: "/transistor",
    matches: ["transistor", "podcast"],
    section: "Embeds",
    priority: 2,
    visibility: VIS_MEMBERS_ONLY,
    isHidden: ctx => !ctx.transistorEnabled,
  },
];
```

Add a `DEFAULT_CARD_PAYLOADS` map mirroring §3, so insertion can fill every
field rather than relying on Ghost's implicit defaults:

```ts
export const DEFAULT_CARD_PAYLOADS: Record<string, Record<string, unknown>> = {
  image: {
    type: "image", version: 1, src: "", width: null, height: null,
    title: "", alt: "", caption: "", cardWidth: "regular", href: "",
  },
  callout: {
    type: "callout", version: 1, calloutText: "", calloutEmoji: "💡",
    backgroundColor: "blue",
  },
  horizontalrule: {type: "horizontalrule", version: 1},
  paywall: {type: "paywall", version: 1},
  // …one entry per catalog card
};
```

### 7.3 Fuzzy matching that respects Koenig semantics

Koenig uses `startsWith` in `buildCardMenu`; the Lab can improve on that without
changing section/priority rules:

```ts
/**
 * Score a menu item against a query. Lower is better.
 * - 0: exact label or exact match keyword
 * - 1: label/keyword starts with the query
 * - 2: word boundary hit
 * - 3: substring hit
 * - 4: ordered subsequence (fuzzy)
 * - Infinity: no match
 */
export function scoreCardMenuEntry(
  entry: LabCardMenuEntry,
  rawQuery: string,
): number {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return 0;

  const label = entry.label.toLowerCase();
  const shortcut = entry.shortcut.toLowerCase();
  const candidates = [label, ...entry.matches.map(m => m.toLowerCase())];

  let best = Infinity;
  for (const candidate of candidates) {
    if (candidate === query) return 0;
    if (candidate.startsWith(query)) best = Math.min(best, 1);
    else if (candidate.split(/[\s/_-]+/).some(part => part.startsWith(query))) {
      best = Math.min(best, 2);
    } else if (candidate.includes(query)) best = Math.min(best, 3);
    else if (isSubsequence(query, candidate)) best = Math.min(best, 4);
  }

  if (best === Infinity && shortcut.includes(query)) return 3;
  return best;
}

function isSubsequence(needle: string, haystack: string): boolean {
  let i = 0;
  for (const ch of haystack) {
    if (ch === needle[i]) i++;
    if (i === needle.length) return true;
  }
  return needle.length === 0;
}
```

Sorting:

```ts
export function buildLabCardMenu(
  entries: LabCardMenuEntry[],
  query: string,
  ctx: LabCardMenuContext,
) {
  const visible = entries
    .filter(entry => !entry.isHidden?.(ctx))
    .filter(entry => scoreCardMenuEntry(entry, query) !== Infinity);

  const sections = new Map<string, LabCardMenuEntry[]>();
  for (const entry of visible) {
    const section = entry.section ?? "Primary";
    if (!sections.has(section)) sections.set(section, []);
    sections.get(section)!.push(entry);
  }

  for (const items of sections.values()) {
    items.sort((a, b) => {
      const scoreDiff = scoreCardMenuEntry(a, query) - scoreCardMenuEntry(b, query);
      return scoreDiff !== 0 ? scoreDiff : a.priority - b.priority;
    });
  }

  // Primary always first; preserve insertion order for the rest.
  return [...sections.entries()].sort(([a], [b]) =>
    a === "Primary" ? -1 : b === "Primary" ? 1 : 0,
  );
}
```

### 7.4 Insertion command

Add `src/lib/lab/insertGhostCard.ts`:

```ts
import {
  $createParagraphNode,
  $getSelection,
  $isElementNode,
  $isParagraphNode,
  $isRangeSelection,
  type LexicalNode,
} from "lexical";
import {$createGhostCardNode} from "./GhostCardNode";
import type {LabCardMenuEntry} from "./cardMenu";
import {DEFAULT_CARD_PAYLOADS} from "./cardMenu";

export function $insertGhostCard(
  entry: LabCardMenuEntry,
  queryParams: Record<string, string>,
  ctx: Parameters<NonNullable<LabCardMenuEntry["insertParams"]>>[0],
) {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null;

  const block = selection.anchor.getNode().getTopLevelElement();
  if (!$isParagraphNode(block)) return null;

  const defaults = DEFAULT_CARD_PAYLOADS[entry.cardType] ?? {
    type: entry.cardType,
    version: 1,
  };
  const insertParams = entry.insertParams?.(ctx) ?? {};
  const data = {...defaults, ...insertParams, ...queryParams};

  const card = $createGhostCardNode(entry.cardType, data);
  block.replace(card);

  const next = card.getNextSibling();
  if (next !== null) {
    if ($isElementNode(next)) next.selectStart();
    else card.selectNext();
  } else {
    const paragraph = $createParagraphNode();
    card.insertAfter(paragraph);
    paragraph.selectStart();
  }

  return card;
}
```

If `triggerFileDialog` is set, the menu should insert the empty card first and
then open the same file picker Koenig uses; alternatively it can open the picker
first and only insert on success. Keep the empty card when the picker is
cancelled, matching Koenig's behaviour.

### 7.5 Supporting work required before the slash menu ships

1. **Card-preserving import.** Do not run `lexicalJsonToMarkdown` over a
   document that contains `ghost-card` nodes, or add lossless Markdown sentinels
   (for example `<!-- kg-card:<type> <base64-json> -->`) so cards survive the
   presentation pass. Without this, the slash menu is undermined the next time
   the post is opened.
2. **`code` → `codeblock` on export.** The Lab uses `@lexical/code`'s
   `CodeNode` (`type: "code"`), but Ghost expects `codeblock`. Add a transformer
   or an `unwrapNodes` branch that converts the node and extracts `language`
   and caption.
3. **Native previews.** At minimum, add lightweight previews for `image`,
   `bookmark`, `callout`, `video`, `audio`, and `gallery` using the payload
   fields. Native Koenig React card components cannot be mounted outside
   `KoenigComposer` because they depend on Koenig contexts.
4. **Upload wiring.** Reuse `makeFileUploader(site)` and `FILE_TYPES` for
   `triggerFileDialog` entries; do not duplicate endpoint logic.
5. **`cardConfig`-driven visibility.** Build `LabCardMenuContext` from
   `buildCardConfig` so `membersEnabled`, `transistor`, `unsplash`, `klipy`,
   `deprecated.headerV1`, and `deprecated.emailCta` produce the same menu as
   Koenig.
6. **Keyboard isolation.** Ignore slash handling when the target is the HTML
   card `<textarea>`, an input, or a contenteditable outside the Lab root.
7. **Tests.** Cover: empty paragraph trigger, non-empty paragraph does nothing,
   fuzzy ranking, section/priority ordering, hidden cards, query params, card
   payload shape, trailing paragraph creation, and a wrap→insert→unwrap
   round-trip equal to the original Ghost payload.

### 7.6 Definition of done

- `/` on an empty paragraph opens a menu whose entries and ordering match
  Koenig's `kgMenu` for the current site configuration.
- Selecting any of the 22 cards inserts a `GhostCardNode` with a complete
  default payload.
- Saving produces Ghost-valid Lexical JSON; no `ghost-card` wrapper escapes to
  the server.
- Existing cards survive open → edit → save unchanged.
- `pnpm tsc --noEmit` and `pnpm test` stay green.

---

## 8. Quick Reference

### 8.1 Ghost node names the Lab must preserve

| Ghost type | Lab representation |
|---|---|
| `extended-text` | Lexical `text` |
| `extended-heading` | Lexical `heading` |
| `extended-quote` | Lexical `quote` |
| `link` with `#fn<label>` | `footnote-reference` |
| `horizontalrule` | Lexical `HorizontalRuleNode` |
| Any card type | `ghost-card` + `{cardType, data}` |
| Footnotes HTML card | definitions in React state; recompiled on save |

### 8.2 Commands

```bash
pnpm tsc --noEmit   # typecheck
pnpm test           # vitest
pnpm check          # typecheck + tests
```

### 8.3 Source anchors

- Card properties/defaults: `koenig-lexical.js.map` →
  `kg-default-nodes/build/esm/nodes/*/…Node.js`.
- Card menu entries: `static kgMenu` in the same bundle.
- Menu ordering/hiding: `src/utils/buildCardMenu.ts` in the bundle.
- Visibility defaults: `kg-default-nodes/build/esm/utils/visibility.js`.
- Lab conversions: `src/lib/lab/GhostCardNode.ts`.
- Footnote HTML: `src/lib/lab/footnoteSerializer.ts`.
- HTML shortcut: `src/lib/lab/htmlCardShortcut.ts`.
