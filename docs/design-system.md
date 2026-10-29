# Geist Design System — v0.5.0 "Native"

> **Phase 0 specification.** This document is the source of truth for the v0.5.0 Native
> redesign. It fixes the tokens, metrics, materials, typography, and component contracts
> before any CSS is written. Where this document and an implementation disagree, the
> implementation is wrong.
>
> Reference inputs:
> - Ghost 6.68 Admin and Editor — `docs/ref/Ghost Admin Panel.png`,
>   `docs/ref/Ghost Editor_1.png`, `docs/ref/Ghost Editor_2.png`, local
>   `ghost-test-env` (6.68).
> - Apple Notes and the macOS 27 UI Kit — `docs/ref/apple notes.png`,
>   Figma file [`TipJX5j7GVAc3J1Xoy6IUH`](https://www.figma.com/design/TipJX5j7GVAc3J1Xoy6IUH).
> - Ulysses — `docs/ref/ulysses_1.png` … `docs/ref/ulysses_4.png`.
>
> Target token file (created in Phase 1): `src/styles/tokens.css`. Phase 0 ships this
> document only; no styles are changed yet.

---

## 1. Design Philosophy & Reference Triangulation

Geist is not a Ghost Admin clone, and it is not a generic Electron writing app. It is a
native macOS writing surface that borrows one strength from each reference:

- **Ghost** gives us the information architecture and the publishing model.
- **Apple Notes / macOS 27** gives us the native window, materials, and SF Pro hierarchy.
- **Ulysses** gives us the calm writing measure and focus behaviour.

The resulting rule set:

1. **Content first, chrome recedes.** The editor has no header bar, no card, and no
   visible toolbar frame. Controls float on the canvas and disappear while writing.
2. **Neutral by default.** Surfaces are near-white or near-black neutrals. Color appears
   only for status and the single Publish action.
3. **Hairlines, not shadows.** Separation comes from 1px borders and surface steps.
   Shadows are reserved for floating sheets and the sidebar card.
4. **Compact but not cramped.** 32px controls, 13px UI type, 8px rhythm. Density follows
   macOS sidebars, not web admin panels.
5. **One measure.** Long-form text never exceeds 740px, regardless of window width.

### 1.1 Ghost 6.68 Admin & Editor

From `Ghost Admin Panel.png` and `Ghost Editor_1–2.png`:

| Element | Observation | Geist application |
| --- | --- | --- |
| Information architecture | Site-scoped sidebar (Analytics, Network, View site, Posts with Drafts/Scheduled/Published, Pages, Tags, Members, Comments, Settings, Help) → post list → editor | Same hierarchy, trimmed to writing: Posts group, future Scraps, Settings, Help |
| Palette | Neutral dark/light surfaces with a single cool-grey text ramp; no brand chrome | `--bg-canvas`, `--bg-sidebar`, `--fg-*` tokens below are taken from Ghost 6.68's `--background` and label ramp |
| Sidebar | A **floating rounded card**, visibly inset from the window edge, with its own radius | `12px` radius, `8px` inset, `1px` hairline, no hard-edged panel |
| Post list | Rows carry a 16:10 feature thumbnail, title, byline, status, and a right-aligned edit pencil | `80×50px` thumbnail, `14px` semibold title, `12px` byline, `#fb2d8d` Draft |
| Draft status | Magenta-pink `Draft` label, text-only, no pill background | `--status-draft: #fb2d8d` |
| Editor | Borderless, distraction-free canvas; the document runs edge to edge with no surrounding card | Full-bleed `--bg-canvas` |
| Top-left | `←` back arrow and `Draft - Saved` save state floating directly on the surface | Floating top-left bar at the same baseline |
| Top-right | `Preview`, green `Publish`, and the sidebar/settings toggle icon | Floating top-right bar; add History clock icon for revisions |
| Bottom-right | `123 words`, low-contrast, floating | Floating word count, no footer chrome |
| Prose | Serif body, sans-serif title, generous measure, visible vertical rhythm | `--font-serif`, 48px sans title, 740px measure |

The important lesson from Ghost is **not** the web Admin chrome. It is that the editor
works because everything except the writing is allowed to float and disappear.

### 1.2 Apple Notes & macOS 27

From `apple notes.png` and the macOS 27 UI Kit:

- **Overlay titlebar.** The window uses `titleBarStyle: "Overlay"` with
  `hiddenTitle: true`. Content extends under the titlebar; there is no separate 28px
  title strip.
- **Traffic-light gutter.** Reserve `78px` wide × `52px` high at the top-left for the
  standard `68×14px` window controls. Nothing interactive may sit under it.
- **Translucent sidebar vibrancy.** The sidebar is an `NSVisualEffectView` material
  behind a semi-transparent CSS fill. The desktop tints it; the content remains legible
  at all times.
- **Liquid Glass pill toolbar.** Toolbar groups are rounded pills with a translucent
  fill and `backdrop-filter: blur(16px) saturate(180%)` — used for contextual controls
  (view options, inspector toggle, search), not for primary navigation.
- **SF Pro semantic hierarchy.** LargeTitle → Title1 → Title2 → Title3 → Headline →
  Body → Callout → Subheadline → Footnote/Caption. Sidebar rows and inspector controls
  use Body; section headers use Title3; metadata uses Callout.
- **Disclosure, not tabs.** Inspectors use native-looking disclosure sections with 28px
  compact controls and 32px standard rows.

### 1.3 Ulysses

From `ulysses_1–4.png`:

- **Calm writing column.** Prose uses a `740px` max measure; the eye never tracks a
  long line.
- **Collapsible navigation.** The library rail can disappear, leaving the sheet list and
  editor.
- **Right-hand inspector drawer.** A `300px` drawer for suggestions/notes/revisions in
  Ulysses; Geist uses `320px` for post metadata and revisions (§4.6).
- **Focus mode.** `Cmd+\` enters distraction-free writing. Optionally, chrome fades
  while typing and returns on pointer/key activity. The text itself never moves.
- **Quiet selection.** Selected rows use a solid macOS accent fill, not a colored border.

### 1.4 Triangulation summary

| Dimension | Ghost 6.68 | Apple Notes / macOS 27 | Ulysses | Geist decision |
| --- | --- | --- | --- | --- |
| Navigation | Full site admin | Compact source list | Collapsible library | 260px floating rail, Posts group, collapsible |
| List | Dense rows + thumbs | Note rows + snippet | Sheet rows + snippet | 16:10 thumb, 14px title, 12px byline |
| Editor | Borderless canvas | Inset paper | 740px column | Full-bleed canvas, 740px column |
| Chrome | Floating text actions | Overlay titlebar + glass | Minimal, fades | Floating bars, overlay titlebar, auto-fade |
| Inspector | Post settings drawer | Disclosure sections | 300px drawer | 320px drawer, 28/32px controls |
| Color | Neutral + green/magenta | System materials | Neutral | Neutral + status only |

---

## 2. Color & Surface Tokens (`src/styles/tokens.css`)

All values below are normative. Hex values are the canonical token value; the
`rgba(...)` values in parentheses are the translucent aliases used when text or surfaces
must composite over glass. Both are exported from `tokens.css` (the alpha variant carries
the `-alpha` suffix, e.g. `--fg-primary-alpha`).

### 2.1 Surfaces

| Token | Light | Dark |
| --- | --- | --- |
| `--bg-canvas` | `#ffffff` | `#111112` (Ghost 6.68 `--background`) |
| `--bg-sidebar` | `rgba(250, 250, 251, 0.82)` — fallback `#fafafb` | `rgba(22, 23, 25, 0.82)` — fallback `#161719` |
| `--bg-elevated` | `#ffffff` | `#1d1e20` |
| `--bg-glass-pill` | `rgba(255, 255, 255, 0.72)` | `rgba(35, 36, 37, 0.72)` |
| `--bg-row-hover` | `#fafafb` | `#161719` |
| `--bg-row-selected` | `#ebeef0` | `#2d2f32` |

Rules:

- The glass pill always uses `backdrop-filter: blur(16px) saturate(180%)` **together
  with** its translucent fill. Never use the blur without the fill; never use the fill
  without a solid fallback (see §5).
- `--bg-sidebar` is translucent only when native vibrancy is active. The `#fafafb` /
  `#161719` values are the mandatory reduced-transparency and no-backdrop fallbacks.
- `--bg-elevated` is for the inspector, modal sheets, popovers, and menus. It must never
  be used for the editor canvas.
- Row hover and selection apply inside the post list and sidebar only. The editor has no
  row states.

### 2.2 Text & Labels (macOS 27 + Ghost 6.68)

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--fg-primary` | `#15171a` (`rgba(0, 0, 0, 0.85)`) | `#edeeee` (`rgba(255, 255, 255, 0.85)`) | Titles, selected nav, body UI, editor title |
| `--fg-secondary` | `#7c8b9a` (`rgba(0, 0, 0, 0.55)`) | `#9da0a3` (`rgba(255, 255, 255, 0.55)`) | Byline, excerpt placeholder, inspector labels, captions |
| `--fg-muted` | `#aeb7c1` (`rgba(0, 0, 0, 0.25)`) | `#696c6f` (`rgba(255, 255, 255, 0.25)`) | Word count, timestamps, disabled icon states |
| `--fg-tertiary` | `#aeb7c1` (`rgba(0, 0, 0, 0.25)`) | `#696c6f` (`rgba(255, 255, 255, 0.25)`) | Placeholder text and non-essential hints |

`--fg-muted` and `--fg-tertiary` are aliases by design: Ghost's muted ramp and macOS's
tertiary label are the same step in this system. Do not introduce a fourth grey.

### 2.3 Borders & Hairlines

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--border-default` | `#e4e7eb` | `#232425` | Sidebar card edge, row dividers, inspector edge, input borders |
| `--border-subtle` | `#f4f5f6` | `#28282a` | Group dividers, inner card rules, table rules |

Hairlines are always `1px`. At Retina scale use `0.5px` only for internal dividers when
the browser supports it; never for the sidebar card or modal edge.

### 2.4 Semantic & Status Accents

| Token | Light | Dark | Notes |
| --- | --- | --- | --- |
| `--accent-primary-bg` | `#15171a` | `#edeeee` | Monochrome primary action fill |
| `--accent-primary-fg` | `#ffffff` | `#15171a` | Text on the primary fill |
| `--status-publish` | `#30cf43` | `#58da67` | Ghost 6.68 editor `Publish` action |
| `--status-draft` | `#fb2d8d` | `#fb2d8d` | Ghost 6.68 `Draft` status label |
| `--status-scheduled` | `#30cf43` | `#30cf43` | Scheduled state |
| `--status-sent` | `#7c8b9a` | `#7c8b9a` | Sent / emailed state |
| `--status-danger` | `#f50b23` | `#f50b23` | Destructive actions and errors |

Rules:

- The primary action is **monochrome**, not blue. Blue is not part of this system.
- Publish green is the only chromatic action color. It is text-only in the editor top
  bar and filled only in `PublishModal` when confirming.
- Status colors are semantic, never decorative. A status must always include its word
  (`Draft`, `Scheduled`, `Published`, `Sent`) — color alone is never the signal.
- `--status-danger` is for destructive text/buttons and error icons; error backgrounds
  use a 10% tint of the same hue.

### 2.5 Token file

The Phase 1 implementation must compile to the following contract:

```css
/* src/styles/tokens.css */
:root {
  color-scheme: light;

  /* Surfaces */
  --bg-canvas: #ffffff;
  --bg-sidebar: rgba(250, 250, 251, 0.82);
  --bg-sidebar-solid: #fafafb;
  --bg-elevated: #ffffff;
  --bg-glass-pill: rgba(255, 255, 255, 0.72);
  --bg-row-hover: #fafafb;
  --bg-row-selected: #ebeef0;

  /* Text */
  --fg-primary: #15171a;
  --fg-primary-alpha: rgba(0, 0, 0, 0.85);
  --fg-secondary: #7c8b9a;
  --fg-secondary-alpha: rgba(0, 0, 0, 0.55);
  --fg-muted: #aeb7c1;
  --fg-muted-alpha: rgba(0, 0, 0, 0.25);
  --fg-tertiary: #aeb7c1;
  --fg-tertiary-alpha: rgba(0, 0, 0, 0.25);

  /* Borders */
  --border-default: #e4e7eb;
  --border-subtle: #f4f5f6;

  /* Accents */
  --accent-primary-bg: #15171a;
  --accent-primary-fg: #ffffff;
  --status-publish: #30cf43;
  --status-draft: #fb2d8d;
  --status-scheduled: #30cf43;
  --status-sent: #7c8b9a;
  --status-danger: #f50b23;

  /* Materials */
  --glass-blur: blur(16px) saturate(180%);
}

html.dark {
  color-scheme: dark;

  --bg-canvas: #111112;
  --bg-sidebar: rgba(22, 23, 25, 0.82);
  --bg-sidebar-solid: #161719;
  --bg-elevated: #1d1e20;
  --bg-glass-pill: rgba(35, 36, 37, 0.72);
  --bg-row-hover: #161719;
  --bg-row-selected: #2d2f32;

  --fg-primary: #edeeee;
  --fg-primary-alpha: rgba(255, 255, 255, 0.85);
  --fg-secondary: #9da0a3;
  --fg-secondary-alpha: rgba(255, 255, 255, 0.55);
  --fg-muted: #696c6f;
  --fg-muted-alpha: rgba(255, 255, 255, 0.25);
  --fg-tertiary: #696c6f;
  --fg-tertiary-alpha: rgba(255, 255, 255, 0.25);

  --border-default: #232425;
  --border-subtle: #28282a;

  --accent-primary-bg: #edeeee;
  --accent-primary-fg: #15171a;
  --status-publish: #58da67;
  /* --status-draft, --status-scheduled, --status-sent, --status-danger inherit */
}
```

> `html.dark` is toggled by `src/lib/theme.ts`, which already resolves
> `system | light | dark` and listens to the OS preference. The redesign keeps that
> mechanism and adds no second theme system.

---

## 3. Typography Scale (macOS 27 SF Pro + Ghost 6.68 Editor)

### 3.1 Families

| Token | Stack | Use |
| --- | --- | --- |
| `--font-sans` | `-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Inter", system-ui, sans-serif` | All UI, post titles, excerpts, controls |
| `--font-serif` | `Georgia, "Times New Roman", serif` | Koenig prose body only |
| `--font-mono` | `"SF Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` | Code cards, slugs, revision metadata |

`--font-serif` is intentionally a web-safe serif, not a bundled font: Ghost's editor
theme uses a serif stack and the system must remain dependency-free. Do not apply it to
titles, buttons, captions, or UI labels.

### 3.2 macOS 27 UI scale

| Style | Size / line-height | Weight | Application |
| --- | --- | --- | --- |
| `LargeTitle` | `26px / 32px` | `700` | Empty states, connect screen heading |
| `Title1` | `22px / 26px` | `700` | Post list page title (`Posts`) |
| `Title2` | `17px / 22px` | `600` | Modal title, onboarding card |
| `Title3` | `15px / 20px` | `600` | Sidebar site title and section headers |
| `Headline` | `13px / 16px` | `600` | Selected nav item, inspector section label |
| `Body` | `13px / 16px` | `400` / `500` | Sidebar nav items and inspector controls |
| `Callout` | `12px / 15px` | `400` / `500` | Post list byline and status |
| `Subheadline` | `11px / 14px` | `500` | Status labels, keyboard hints, Alt pill |
| `Footnote` / `Caption` | `10px / 13px` | `400` | Word count, timestamps, helper text |

Rules:

- UI text is never larger than 26px and never smaller than 10px.
- Sidebar items use Body at weight `500`; section headers use Title3 at `600`.
- Post-list titles are the one exception to the UI scale: `14px` semibold (`600`), a
  deliberate Ghost-style list title, not a macOS text style.
- Do not use `font-smoothing` overrides other than the existing
  `-webkit-font-smoothing: antialiased`; macOS handles the rest.

### 3.3 Ghost 6.68 editor scale (740px centered column)

| Element | Specification |
| --- | --- |
| Post title | `48px` (`3rem`), `line-height: 1.1`, `font-weight: 700`, `letter-spacing: -0.017em`, `--font-sans` |
| Custom excerpt (inline subtitle below title) | `17px` (`1.0625rem`), `line-height: 1.5`, `letter-spacing: -0.01em`, `--fg-secondary`, `--font-sans` |
| Body prose (`.koenig-lexical`) | `20px` (`1.25rem`), `line-height: 1.6`, `letter-spacing: 0.1px`, `--font-serif` |

Editor rules:

- The column is `min(740px, calc(100% - 48px))`, centered. The title may wrap to two or
  three lines; it never exceeds the measure.
- The excerpt is an inline, borderless field. When empty it shows `Add an excerpt` in
  `--fg-tertiary` at the same size. It is not a textarea card.
- A `1px` `--border-subtle` divider separates the excerpt from the body. The divider is
  inset to the measure, not full-bleed.
- Body prose uses `--font-serif` for all Koenig cards that carry prose (paragraph,
  quote, list). Card UI chrome (bookmark titles, embed labels, code) uses the UI stack.
- Headings inside Koenig inherit the sans stack and the UI weight ramp; do not let
  Koenig's default web fonts leak through.
- Title, excerpt, and prose are left-aligned. No justified text, no centered body.

---

## 4. Window & Layout Metrics

### 4.1 Window configuration

| Property | Value |
| --- | --- |
| Minimum size | `960 × 640` |
| Default size | `1280 × 820` |
| Titlebar | `titleBarStyle: "Overlay"` |
| Title visibility | `hiddenTitle: true` |
| Traffic-light safe zone | `78px` wide × `52px` high, top-left drag region |
| Sidebar vibrancy | macOS `NSVisualEffectView` (`sidebar` material) behind `--bg-sidebar` |

Target `src-tauri/tauri.conf.json` window block (replaces the current `1160 × 760`
window in Phase 1):

```json
{
  "title": "Geist",
  "width": 1280,
  "height": 820,
  "minWidth": 960,
  "minHeight": 640,
  "titleBarStyle": "Overlay",
  "hiddenTitle": true,
  "windowEffects": {
    "effects": ["sidebar"],
    "state": "followsWindowActiveState"
  }
}
```

The top `52px` is an app-wide drag region:

```html
<div class="titlebar-drag-region" data-tauri-drag-region></div>
```

Rules:

- The drag region must be an empty layer (no buttons inside). Interactive controls sit
  above it in a separate stacking context, with their own hit areas.
- Reserve the `78px × 52px` top-left gutter for the traffic lights. Never place the
  sidebar site switcher, tabs, or search there.
- `hiddenTitle: true` means there is no visible "Geist" title in the titlebar. The app
  name appears only in the macOS menu bar and the sidebar, if at all.
- The content surface starts at `y = 0`; it extends under the titlebar. Use padding, not
  a titlebar background, to clear the controls.

### 4.2 Shell grid

The shell has three slots: the navigation rail, one workspace, and the inspector. The
workspace is either the post list (Library) or the editor (Writing); the two are
mutually exclusive and the editor's back arrow returns to Library. This keeps the
writing measure intact instead of squeezing a list, an editor, and an inspector into
960px.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ 78×52 traffic-light gutter (drag region)                        52px overlay │
│ ┌────────────────┐  ┌──────────────────────────────┐  ┌───────────────────┐ │
│ │ Navigation     │  │ Workspace                    │  │ Inspector         │ │
│ │ rail 260px     │  │ Library: post list           │  │ 320px (when open) │ │
│ │ card inset 8px │  │ Writing: full-bleed editor   │  │ metadata / history│ │
│ │ radius 12px    │  │ 740px measure + floating bars│  │ / publish sheet   │ │
│ └────────────────┘  └──────────────────────────────┘  └───────────────────┘ │
│  8px                                                 8px                    │
└──────────────────────────────────────────────────────────────────────────────┘
```

- Grid: `260px | minmax(0, 1fr) | auto`. The middle workspace is either the post list
  or the editor; the inspector occupies the right `320px` when open.
- The inspector docks at `320px` and reduces the editor width; it always slides in from
  the right edge rather than covering the text. The editor measure is capped at `740px`
  and gracefully narrows below that.
- The rail and workspace are separated by an `8px` gutter. The editor pane has no
  gutter: its `--bg-canvas` runs to the window edge and under the floating controls.
- Minimum supported width is `960px`. At `960–1119px` the rail collapses to an overlay
  and the post list narrows to `300px`; the editor always retains at least `360px` of
  usable width, and the measure shrinks with it.

Layout cascade (normative):

| Width | Rail | Workspace | Inspector |
| --- | --- | --- | --- |
| `≥ 1440px` | docked `260px` | Library list `340px`, or editor with full `740px` measure | docked `320px`; measure preserved |
| `1120–1439px` | docked `260px` | Library list `320px`, or editor | docked `320px`; measure narrows below `740px` |
| `960–1119px` | overlay, toggleable | Library list `300px`, or editor | docked `320px`; measure narrows |
| Focus mode (any width) | hidden | editor full window | hidden until toggled |

### 4.3 Left navigation rail

| Property | Value |
| --- | --- |
| Column width | `260px` |
| Card inset | `8px` from top, bottom, and left of the content area (i.e. top edge at `60px`, clear of the `52px` traffic-light gutter) |
| Card radius | `12px` |
| Card border | `1px solid var(--border-default)` |
| Card surface | `--bg-sidebar` over native vibrancy |
| Card shadow | `0 1px 2px rgba(0, 0, 0, 0.04)`, no large drop shadow |
| Collapse | `Cmd+\` or the sidebar toggle button |
| Item height | `32px` |
| Item radius | `6px` |
| Item padding | `0 10px` |
| Item type | `13px`, weight `500` |
| Item hover | `--bg-row-hover` |
| Item selected | `--bg-row-selected`, text `--fg-primary`, no accent bar |

Structure:

```
[site avatar]  Site title                         Title3 / 600
[search field]  Search site                      32px, glass or hairline
──────────────────────────────────────────────
Analytics
Network
View site
Posts                                            expandable group
  All posts
  Drafts
  Scheduled
  Published
  Scraps                                         (v0.7, via `sections` prop)
Pages
Tags
Members
Comments
──────────────────────────────────────────────
Settings
Help
[user avatar]  Name / email                     bottom-anchored
```

- `Posts` is the only expandable group in v0.5.0. It is expanded when the current view is
  a post list; its children are `All posts`, `Drafts`, `Scheduled`, `Published`.
- The sidebar component accepts a `sections` prop so `Scraps` can be appended in v0.7
  without restructuring. Do not hard-code the group children inside the render tree.
- The search field is a `32px` pill with a `⌘K` hint; it filters the post list, not the
  whole app.
- Icons are 16px SF Symbols (or a matching 1.5px-stroke set), aligned to a 20px column.
  Icon color is `--fg-secondary`; selected item icons use `--fg-primary`.
- The bottom user row is anchored with `margin-top: auto`; it never scrolls with the nav.

### 4.4 Post list workspace

Header:

- Title `Posts` at Title1 (`22px / 26px`, `700`), left-aligned.
- Right cluster: `Filter` pills, sort selector (`Newest first`), and `+ New post` CTA.
- `Filter` pills and the sort selector are text buttons with a 16px icon and a
  transparent background, not filled segmented controls.
- `+ New post` is a filled pill: `height: 32px`, `border-radius: 9999px`,
  `padding: 0 14px`, `--accent-primary-bg` / `--accent-primary-fg`, `13px / 600`.
- The header height is `56px`, with `8px` vertical padding; it sits below the `52px`
  drag region.

Rows:

| Element | Specification |
| --- | --- |
| Thumbnail | `80 × 50px` (16:10), `border-radius: 4px` (`rounded-sm`), `object-fit: cover`; placeholder is `--bg-row-hover` with a 1px `--border-subtle` inset and a centered muted image icon |
| Gap | `12px` between thumbnail and text block |
| Title | `14px`, weight `600`, `--fg-primary`, one line with ellipsis |
| Byline | `12px`, weight `400`, `--fg-secondary`: `By Author · Date` |
| Status | `Draft` at `11px`, weight `600`, `--status-draft`; `Published` / `Scheduled` / `Sent` use their tokens |
| Edit affordance | Right-aligned pencil icon, `16px`, `--fg-secondary`, visible on hover/focus (always visible on the selected row) |
| Row height | Minimum `66px` (`50px` thumb + `8px` vertical padding), divider `1px --border-subtle` between rows |
| Row hover | `--bg-row-hover` |
| Row selected | `--bg-row-selected`; no border, no left accent bar |
| Row padding | `0 8px`; the list itself has `0 16px` page padding |
| Whole row | One interactive target; the pencil is a nested button with its own hit area and `aria-label="Edit <title>"` |

Status values that are not Draft are text-only at `11px / 500`; do not wrap them in a
filled pill. The list shows `Draft` in magenta even though the surrounding palette is
neutral — that is the one Ghost accent we keep.

Empty state: centered `--fg-muted` copy at `13px`, plus a single `+ New post` pill. No
illustration, no card.

### 4.5 Editor canvas

The editor pane is full-bleed `--bg-canvas`: no card, no border, no header background,
no visible toolbar container.

Floating top-left bar:

- `←` back arrow (16px icon, `--fg-secondary`, 32px hit area).
- Save state text: `Draft - Saved` at `13px / 500`, `--fg-secondary`. It reflects
  `Draft`, `Saving…`, `Saved`, `Scheduled`, or `Published` and updates in place.
- Position: `left: 20px`, top aligned to the `52px` titlebar baseline (center at
  `y = 26px`). The bar is `32px` tall and has no background; it floats directly on the
  canvas.

Floating top-right bar (right-aligned, same 32px baseline):

1. `Preview` — text button, `13px`, `--fg-secondary`, hover `--fg-primary`.
2. `Publish` — text button, `13px / 600`, `--status-publish` (Light `#30cf43`, Dark
   `#58da67`). In light appearance, if green-on-white contrast fails, use
   `--accent-primary-bg` fill with `--accent-primary-fg`; never use green body text.
3. `History` — clock icon, 16px, `--fg-secondary`, opens `RevisionsDrawer`.
4. `Settings` — sidebar/inspector icon, 16px, `--fg-secondary`, toggles
   `MetadataSidebar`.

All four are 32px hit targets with 8px gaps. They have no visible container; on hover,
each gets a `6px` radius `--bg-row-hover` background.

Centered column, top to bottom:

1. **Feature image** — full measure width, natural aspect ratio, `border-radius: 4px`.
   When empty: a dashed `1px --border-default` dropzone at 16:9 with a centered
   `Add feature image` label and an upload icon. Drag/drop and click both work.
2. **Caption** — `13px / 400`, `--fg-secondary`, directly below the image, with an
   inline `Alt` pill at the right (`11px / 500`, `--border-default` border, `9999px`,
   `padding: 2px 6px`). Caption is editable inline.
3. **Post title** — the Ghost editor scale: `48px`, `line-height: 1.1`, `700`,
   `letter-spacing: -0.017em`, `--font-sans`. Borderless, placeholder `Post title`,
   auto-growing.
4. **Excerpt** — `17px`, `line-height: 1.5`, `--fg-secondary`, inline; placeholder
   `Add an excerpt`.
5. **Divider** — `1px --border-subtle`, full measure, `24px` above and below.
6. **Koenig Lexical prose** — `20px / 1.6`, `--font-serif`, `letter-spacing: 0.1px`.
   The editor is borderless; focus is indicated by the caret, not a ring.

Spacing: `32px` from the top floating bar to the feature image; `16px` image → caption;
`40px` caption → title; `16px` title → excerpt; `24px` excerpt → divider; `24px`
divider → prose. The column bottom padding is `96px` so the word count never overlaps
the last line.

Floating bottom-right:

- `123 words` at `12px / 400`, `--fg-muted`.
- Position: `right: 20px`, `bottom: 16px`, no background, `pointer-events: none`.
- Updates after a 250ms debounce. It is not a footer and does not participate in layout.

Focus mode:

- `Cmd+\` hides the rail, post list, and inspector; the editor fills the window. The
  floating bars remain, but at 40% opacity.
- While typing, the bars fade to 0% after 1.5s of inactivity in the pointer; any
  pointer move, keypress, or scroll restores them. The text column never moves.
- `Esc` exits focus mode and restores the previous layout.
- Under `prefers-reduced-motion`, fades are instant and the auto-fade behavior is
  disabled (bars stay at their normal opacity).

### 4.6 Right inspector drawer & publish sheet

`MetadataSidebar` and `RevisionsDrawer` share one panel shell:

| Property | Value |
| --- | --- |
| Width | `320px` |
| Surface | `--bg-elevated` |
| Edge | `1px solid var(--border-default)` on the left |
| Motion | `180ms` slide from the right, `cubic-bezier(0.2, 0, 0, 1)` |
| Scrim | None; the panel docks against the editor edge and reduces its width |
| Header | `44px`, title at `13px / 600`, close icon button `28px` |
| Sections | macOS disclosure sections: `28px` compact controls, `32px` standard rows |
| Padding | `16px` horizontal, `12px` vertical per section |
| Divider | `1px --border-subtle` between sections |
| Scroll | Independent scroll; header stays pinned |

`MetadataSidebar` sections, in order:

1. Feature image (preview, replace/remove, alt text).
2. Slug (with site-prefix hint).
3. Excerpt (multiline, character counter).
4. Visibility (public / members / paid tiers; tier chips).
5. Tags (chips with a primary tag).
6. Authors (chips).
7. Advanced (canonical URL, code injection entry point, delete post in
   `--status-danger`).

Controls use `--bg-canvas` fields with `1px --border-default`, `6px` radius, `13px` text,
and a `2px` focus ring in `--accent-primary-bg` at 30% opacity. Labels are `11px / 500`
`--fg-secondary`, uppercase optional — do not uppercase in the UI; sentence case is the
macOS default.

`RevisionsDrawer` uses the same shell. The list rows are `44px`, with time (`12px`),
reason (`11px --fg-secondary`), title (`13px`), and author (`11px`). Selecting a revision
shows a read-only preview and a `Restore this version` primary button. Destructive
restores require confirmation.

`PublishModal` is a macOS sheet, not a web modal:

- Backdrop: `rgba(0, 0, 0, 0.24)` with `backdrop-filter: blur(8px)`.
- Sheet: centered, `max-width: 480px`, `border-radius: 12px`,
  `background: --bg-elevated`, `1px --border-default`, shadow
  `0 24px 64px rgba(0, 0, 0, 0.24)`.
- Header: Title2 (`17px / 600`), close icon `28px`.
- Sections: delivery (Web / Web + email / Email only), timing (Now / Schedule),
  newsletter selection, and confirmation.
- **Mandatory newsletter recipient-count gate.** When delivery includes email, the
  sheet must display the recipient count (e.g. `Sending to 1,248 subscribers`) and
  require an explicit checkbox/confirmation before the publish button enables. This gate
  cannot be skipped, pre-checked, or hidden behind an "advanced" disclosure. It is the
  one place the design deliberately adds friction.
- Actions: `Cancel` (secondary, text) and `Publish` (primary, monochrome fill; green
  only if the action sends email, to match the editor's green Publish signal).
- Focus is trapped while open; `Esc` cancels; focus returns to the Publish trigger.

### 4.7 Component architecture

Target structure (Phase 1 refactor; existing flat components are migrated, not rewritten
from scratch):

```
src/
  styles/
    tokens.css          # §2 + typography + geometry custom properties
    base.css            # reset, scrollbars, selection, focus ring, color-scheme
    chrome.css          # drag region, rail, glass pills, window edges
    posts.css           # post list header, rows, thumbnails, empty state
    editor.css          # 740px canvas, floating bars, Koenig overrides
    inspector.css       # drawer, disclosure sections, publish sheet
  components/
    AppShell.tsx        # window chrome, grid, focus mode, drawer orchestration
    chrome/
      TitleBarDragRegion.tsx
      WindowControlsGutter.tsx   # 78×52 reservation, no controls
      ThemeToggle.tsx
    navigation/
      Sidebar.tsx       # 260px floating card, sections prop
      SidebarItem.tsx   # 32px row, 6px radius
      SidebarGroup.tsx  # expandable Posts group
    posts/
      PostList.tsx      # header + list
      PostListHeader.tsx
      PostRow.tsx       # 80×50 thumb, title, byline, status, edit
      PostStatus.tsx
    editor/
      Editor.tsx        # state, autosave, Koenig, preview/publish actions
      EditorTopBar.tsx  # floating left/right clusters
      EditorCanvas.tsx  # 740px column, feature image, title, excerpt, divider
      FeatureImage.tsx
      WordCount.tsx
    inspector/
      InspectorShell.tsx
      MetadataSidebar.tsx
      RevisionsDrawer.tsx
      PublishModal.tsx
    primitives/
      Button.tsx        # primary / secondary / ghost / danger
      IconButton.tsx    # 28/32px hit area, 16px glyph
      Pill.tsx          # 32px, 9999px radius
      Disclosure.tsx    # macOS section
      Field.tsx         # label + input + hint
      Sheet.tsx         # 12px radius + backdrop
```

Ownership and contracts:

| Component | Owns | Key props / contract |
| --- | --- | --- |
| `AppShell` | Grid mode, focus mode, which drawer is open, theme application | `site`, `view`, `onNavigate`; renders `Sidebar`, workspace, inspector slot |
| `Sidebar` | Navigation selection, Posts group expansion, collapse state | `sections`, `collapsed`, `onToggle`, `onSelect`, `activeId`; `sections` is the v0.7 Scraps seam |
| `PostList` | Filter/sort/search state, list fetch, empty/error states | `site`, `view` (`all`/`draft`/`scheduled`/`published`), `onOpenPost`, `onNewPost` |
| `PostRow` | Presentation only | `post`, `selected`, `onOpen`, `onEdit`; status is text + token, never color alone |
| `Editor` | Title/excerpt/body state, autosave, conflict handling, publish actions, drawer state | `site`, `postId`, `onBack`; keeps all existing data behaviour |
| `EditorTopBar` | Save-state copy, Preview/Publish/History/Settings actions | `status`, `postStatus`, `onPreview`, `onPublish`, `onHistory`, `onSettings` |
| `EditorCanvas` | Layout of feature image → title → excerpt → divider → Koenig | `post`, `meta`, `onChange`, `readOnly`; no chrome |
| `MetadataSidebar` | Metadata form state, upload, tags/authors/tiers | `meta`, `site*`, `onChange`, `onClose`, `readOnly` |
| `RevisionsDrawer` | Selection + restore confirmation | `revisions`, `onRestore`, `onClose` |
| `PublishModal` | Delivery/timing/newsletter confirmation | `newsletters`, `postStatus`, `busy`, `onExecute`, `onClose`; must expose recipient count |
| `ThemeToggle` | `system`/`light`/`dark` persistence | Existing `src/lib/theme.ts` contract is unchanged |

Primitive rules:

- `Button` variants: `primary` (monochrome fill), `secondary` (hairline border),
  `ghost` (text only), `danger` (`--status-danger`). All are 32px tall; compact
  inspector variants are 28px.
- `IconButton` is always `28px` or `32px` square, with a 16px glyph and an
  `aria-label`. No icon-only button without a label.
- `Pill` is `32px` tall, `9999px` radius, `0 14px` padding; used for `+ New post`,
  filter chips, and the `Alt` affordance (compact variant).
- `Disclosure` is a single `<details>`-style section with a rotating chevron; state is
  not persisted across posts.
- No component may hard-code a hex color, radius, or font size. Everything comes from
  `tokens.css`.

Existing code mapping:

| Existing file | v0.5.0 action |
| --- | --- |
| `src/App.tsx` | Becomes the data/navigation controller behind `AppShell` |
| `src/components/PostList.tsx` | Split into `PostList`, `PostListHeader`, `PostRow` |
| `src/components/Editor.tsx` | Keep save/publish logic; extract `EditorTopBar` and `EditorCanvas` |
| `src/components/MetadataSidebar.tsx` | Re-skin with `InspectorShell` + `Disclosure`; keep all fields |
| `src/components/RevisionsDrawer.tsx` | Reuse `InspectorShell`; keep restore flow |
| `src/components/PublishModal.tsx` | Re-skin as `Sheet`; **keep the recipient-count gate** |
| `src/components/ThemeToggle.tsx` | Keep behavior; restyle as a 28px icon button |
| `src/App.css` | Split into `src/styles/*.css`; delete legacy grays/blue accent |

### 4.8 Geometry tokens

These accompany the color tokens in `tokens.css`:

```css
:root {
  --radius-sm: 4px;        /* thumbnails, images */
  --radius-md: 6px;        /* sidebar items, fields */
  --radius-lg: 12px;       /* sidebar card, publish sheet */
  --radius-pill: 9999px;   /* CTAs, chips, Alt pill */

  --window-min-width: 960px;
  --window-min-height: 640px;
  --titlebar-height: 52px;
  --traffic-light-gutter: 78px;

  --rail-width: 260px;
  --rail-inset: 8px;
  --list-min-width: 300px;
  --editor-measure: 740px;
  --inspector-width: 320px;

  --row-height: 32px;
  --control-height: 32px;
  --control-height-compact: 28px;

  --motion-duration: 180ms;
  --motion-ease: cubic-bezier(0.2, 0, 0, 1);
}
```

---

## 5. Accessibility & Appearance Matrix

The app supports four appearance/accessibility states. Every state must be reachable
without JavaScript-only fixes and must preserve the same DOM order and focus order.

| Concern | Light (default) | Dark (`html.dark`) | Reduced Transparency | Reduced Motion |
| --- | --- | --- | --- | --- |
| Trigger | `:root` + `color-scheme: light` | `html.dark` + `color-scheme: dark`; set by `theme.ts`, follows OS when `system` | `@media (prefers-reduced-transparency: reduce)` | `@media (prefers-reduced-motion: reduce)` |
| Canvas | `#ffffff` | `#111112` | unchanged | unchanged |
| Sidebar | `rgba(250, 250, 251, 0.82)` over vibrancy | `rgba(22, 23, 25, 0.82)` over vibrancy | solid `#fafafb` / `#161719`, no vibrancy tint | unchanged |
| Glass pill | translucent white + blur(16px) saturate(180%) | translucent `#232425` + blur(16px) saturate(180%) | solid `#ffffff` / `#232425`, `backdrop-filter: none` | unchanged |
| Inspector / sheet | `--bg-elevated` + hairline | `--bg-elevated` + hairline | solid, no backdrop blur | unchanged |
| Row hover / selected | `#fafafb` / `#ebeef0` | `#161719` / `#2d2f32` | unchanged | unchanged |
| Dividers | `--border-subtle` | `--border-subtle` | unchanged | unchanged |
| Focus ring | `2px` `--accent-primary-bg` at 30% opacity + `1px` offset | same, light fill | same | same |
| Drawer / sheet motion | `180ms` slide + fade | same | same | instant (`0ms`), no transform |
| Focus-mode chrome fade | 1.5s delay, 200ms fade | same | same | disabled; bars stay visible |
| Hover lifts | none (no translate/scale) | none | none | none |
| Scrollbars | overlay, `--fg-muted` thumb | overlay, `--fg-muted` thumb | unchanged | unchanged |

Media-query contract:

```css
@media (prefers-reduced-transparency: reduce) {
  :root {
    --bg-sidebar: #fafafb;
    --bg-glass-pill: #ffffff;
    --glass-blur: none;
  }
  html.dark {
    --bg-sidebar: #161719;
    --bg-glass-pill: #232425;
  }
  .glass-pill,
  .sidebar-card,
  .sheet-backdrop {
    backdrop-filter: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  :root {
    --motion-duration: 0ms;
  }
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

Fallback for browsers without `backdrop-filter`:

```css
@supports not (backdrop-filter: blur(16px)) {
  :root { --bg-glass-pill: #ffffff; }
  html.dark { --bg-glass-pill: #232425; }
}
```

### 5.1 Contrast guardrails

Measured against the canvas (WCAG 2.1 relative luminance):

| Pair | Ratio | Allowed use |
| --- | --- | --- |
| `--fg-primary` on `--bg-canvas` (light) | `17.96:1` | All text |
| `--fg-primary` on `--bg-canvas` (dark) | `16.23:1` | All text |
| `--fg-secondary` on light canvas | `3.49:1` | 12px+ metadata and UI labels only; not body copy |
| `--fg-secondary` on dark canvas | `7.18:1` | All text |
| `--fg-muted` on light canvas | `2.03:1` | Word count, placeholders, disabled states only |
| `--fg-muted` on dark canvas | `3.57:1` | Word count, placeholders, disabled states only |
| `--status-draft` on light canvas | `3.58:1` | Status label at 11px/600; never body copy |
| `--status-draft` on dark canvas | `5.27:1` | Status label |
| `--status-publish` (dark) on dark canvas | `10.46:1` | Publish action |
| `--accent-primary-fg` on `--accent-primary-bg` | `17.96:1` (light) / `15.45:1` (dark) | Primary buttons |

Rules:

- Body copy always uses `--fg-primary`. Secondary/muted are for metadata, never for a
  paragraph the user must read.
- Where a light-mode status label must meet 4.5:1 at small size, render it at `600`
  weight on `--bg-elevated` or use `--fg-primary` with a colored 6px dot. Do not invent
  a new color token.
- Color is never the only carrier of state: every status has a word, every error has an
  icon plus text, every selected row also uses the selected surface.

### 5.2 Keyboard and assistive technology

| Action | Shortcut / behavior |
| --- | --- |
| Toggle focus mode | `Cmd+\` |
| Toggle navigation rail | Sidebar toggle button (focusable, `aria-expanded`) |
| Save revision | `Cmd+S` (existing) |
| Close drawer / sheet | `Esc`, restores focus to the trigger |
| Move through nav | `Up`/`Down` within the sidebar, `Tab` between regions |
| Open post | `Enter`/`Space` on the row button |

Requirements:

- The sidebar is `<nav aria-label="Primary">`; the active item uses
  `aria-current="page"`. The Posts group uses `aria-expanded` and `aria-controls`.
- The post list is a list of buttons/links, not clickable `<div>`s. Each row's accessible
  name includes title, author, date, and status.
- The editor title is a labelled text field. The Koenig contenteditable has an
  `aria-label="Post body"` and a visible caret. The word count is exposed as
  `aria-label="Word count: 123"` with `aria-live="off"` (do not announce every
  keystroke).
- The inspector and publish sheet are `role="dialog"` with `aria-modal="true"`,
  labelled by their title. Focus is trapped while open.
- `PublishModal`'s newsletter confirmation is a real checkbox with a programmatic label
  that includes the recipient count; the Publish button is `disabled` until it is
  checked. Screen readers must hear the count before the confirm control.
- Respect `prefers-reduced-motion` for every transform, including the drawer slide and
  the focus-mode fade. Nothing may rely on animation to convey state.

### 5.3 Appearance QA checklist

- [ ] Light and dark screenshots of: connect, post list, editor (empty and full), feature
      image, metadata drawer, revisions drawer, publish sheet.
- [ ] Sidebar card hairline and 12px radius remain visible on both wallpapers.
- [ ] No pure black (`#000`) or pure white text on dark; use the token ramp.
- [ ] `Draft` is `#fb2d8d` and remains legible at 11px in both appearances.
- [ ] Reduced Transparency: no `backdrop-filter` remains; sidebar and pills are solid.
- [ ] Reduced Motion: drawer opens instantly, focus-mode bars do not fade.
- [ ] Keyboard-only pass: focus visible on every control; `Esc` closes every overlay.
- [ ] The 78×52 traffic-light gutter is clear at 960×640 and 1280×820.
- [ ] The 740px measure is preserved at 1280px or wider with the inspector closed, and
      narrows without clipping when the inspector is open.
- [ ] The newsletter recipient count appears before the publish confirmation.
