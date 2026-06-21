# Z-Matrix Design System

> A blueprint-grade design system for **Z-Matrix** — Blue Tokai's internal automation platform and **new store opening folder**. Built for operators who live inside dashboards, approvals queues, and pipeline state machines, and want them to feel like a quiet command center, not a Jira clone.

---

## 1. Product context

**Z-Matrix** is an internal workspace for Blue Tokai Coffee Roasters that orchestrates the lifecycle of opening a new café — from a Business Development (BD) executive scoring a sidewalk to a paid LOI, due-diligence, and final boarding. It is hybrid by design:

- A constellation of **web modules** (BD · Payments · Legal · Recce · Design · Project Execution · NOC · Final Boarding), each a small SPA behind one shared auth portal.
- A platform plane of shared services — identity, gateway, event bus, file storage, audit.
- A **desktop workspace** (Electron) that does **not** mirror the modules, but sits on top of them as an agentic surface — natural-language queries, dashboards, PPTX/XLSX skills, MCP servers (`bd-mcp`, `payments-mcp`).

The two surfaces this design system targets first:

| Surface | What it is | Primary user |
|---|---|---|
| **`new-store-folder`** | The internal automation app for store opening — three stages: **Pipeline** (drafts created by BD execs) → **Shortlist queue** (supervisor decides Yes / No, exec adds 20-field site detail, supervisor approves and sets expected LOI timeline) → **Staging** (sites awaiting LOI upload; overdue sites highlighted). Once an LOI is uploaded the site exits this module into the separate Payments module. | BD execs · BD supervisors |
| **`workspace`** | The desktop / agentic surface — sites browser, shortlist approvals stream, NL command bar, dashboards. Read-only mirror of the same data via `bd-mcp`, with PPTX / XLSX Skills. | All roles, scoped by RBAC |

We design for **both** so a supervisor approving a shortlist in the web module and an admin querying "staging sites overdue > 14 days" in the desktop feel like the same product.

> **Out of scope for this kit:** Payments / CA codes / KYC. Those live in a separate Payments module; the workspace can _read_ a stream of payment events for context but does not own them.

### Source material

This design system was derived from:

- **`Adityashandilya555/Matrix`** @ `d9a94b58…` — repo for the Electron workspace. The architecture brief lives at [`website/blue-tokai/architecture.md`](https://github.com/Adityashandilya555/Matrix/blob/d9a94b581d9377217481093e1229f0a076f8f848/website/blue-tokai/architecture.md). Existing renderer code already uses Plus Jakarta Sans, JetBrains Mono, and a CSS-variable token system — the Z-Matrix palette extends that direction toward "command center" rather than "warm chat client."
- **`Adityashandilya555/designer-skills`** — companion design-ops skills repo.
- **Aesthetic brief** from product: *Structured Breathing Room · Precision Linework · Micro-Interactions*; "Digital Quartz" light + "Deep Obsidian" dark; logo concept "The Dimension Shift."

Open these repos if you want to extend or audit anything in this system.

---

## 2. Index — what's in this folder

```
.
├── README.md                  ← you are here (design system overview)
├── SKILL.md                   ← Agent Skills-compatible entry point
├── colors_and_type.css        ← all CSS vars (color + type + spacing + motion)
├── assets/                    ← logos, favicons, raster placeholders
│   ├── zmatrix-mark.svg       ← the "Dimension Shift" emblem (mono-line Z)
│   ├── zmatrix-mark-dark.svg  ← inverted for dark surfaces
│   ├── zmatrix-wordmark.svg   ← emblem + Z-MATRIX wordmark, light bg
│   ├── zmatrix-wordmark-dark.svg
│   ├── zmatrix-favicon.svg
│   └── blueprint-grid.svg     ← repeating thin-line background pattern
├── fonts/                     ← font notice (we use Google Fonts CDN)
├── preview/                   ← Design-system tab cards (HTML)
├── ui_kits/
│   ├── new-store-folder/      ← BD module: pipeline, shortlist, LOI, 20-field form
│   │   ├── README.md
│   │   ├── index.html
│   │   └── *.jsx
│   └── workspace/             ← Desktop / agentic workspace
│       ├── README.md
│       ├── index.html
│       └── *.jsx
```

---

## 3. Content fundamentals

Copy in Z-Matrix is written like a senior operator talks at a quiet 10am stand-up: **direct, numerate, low-affect.** We are not a consumer brand. We are not selling anything. We are confirming what just happened and what needs to happen next.

### Voice rules

1. **State the fact, then the action.** "12 sites stuck at LOI > 14 days. Open queue →" beats "You have some pending items!"
2. **Numbers first.** Lead with the metric, follow with the label: `42 sites · 9 cities · 6 stuck`. Never spell out small integers in UI ("12", not "twelve").
3. **Second person, used sparingly.** "You" appears in invitations and toasts ("You approved this LOI 2 min ago"). System voice elsewhere is impersonal ("Pipeline updated", "Awaiting supervisor review").
4. **Sentence case everywhere.** No Title Case headers. ALL CAPS is reserved for `eyebrow` labels (tracking +0.14em) and status pills (`DRAFT`, `LOI PENDING`).
5. **No filler.** Cut "great", "awesome", "successfully". A check icon is enough.
6. **Currency and dates are explicit.** `₹1,42,000` not `1.42L` in primary fields. Dates as `19 May 2026` in prose, `2026-05-19` in tables.
7. **Empty states are instructive, not cute.** "No sites in your queue. Submit a pipeline to start →" — never "Nothing here yet 🎉".

### Tone, by surface

| Surface | Vibe | Example |
|---|---|---|
| Form field labels | Plain noun | `Carpet area (sq ft)`, `SPOC phone`, `LOI signing date` |
| Buttons | Imperative verb | `Submit for shortlist`, `Approve payment`, `Mark LOI signed` |
| Confirmations | One sentence, past tense | `Pipeline submitted. Supervisor notified.` |
| Errors | What broke, what to do | `KYC document missing. Upload PAN before submitting.` |
| Toasts | 4–8 words | `LOI uploaded · 2 of 4 approvals` |
| AI agent replies | Conversational, but precise; offers next action | `8 sites in Mumbai stuck > 14 days at LOI. Want me to draft the supervisor digest?` |

### What we don't do

- No emoji in UI chrome. (Speaker notes and chat agent may use rare ✓/→ for emphasis only.)
- No exclamation marks in system copy.
- No "we" — Z-Matrix is a tool, not a company speaking to you.
- No marketing-flavored adjectives ("powerful", "seamless", "delight").

---

## 4. Visual foundations

### 4.1 Palettes

Two named, interchangeable modes. Same semantic role per token; never invent new colors at the component level — extend the variable instead.

**Light — "Digital Quartz"** is the default for the web modules where execs scan tables under fluorescent office lighting. **Dark — "Deep Obsidian"** is the default for the desktop workspace, where supervisors live in approvals queues at 9pm.

| Role | Light token | Dark token | Notes |
|---|---|---|---|
| Page bg | `#F5F7FA` | `#0B0C10` | Off-white quartz vs warm-tinted black — never pure white or pure black |
| Card surface | `#FFFFFF` | `#171923` | Cards literally lift off bg |
| Primary text | `#111827` | `#E2E8F0` | High contrast graphite / platinum |
| Brand accent | `#005F60` | `#00B4D8` | Deep teal in light → luminous cyan-teal in dark; **only for primary CTA, focused inputs, current selection, and key data lines** |
| Data highlight | `#D97706` | `#F59E0B` | Burnished copper / amber — used for **secondary data**, warnings, copper rules under hero numbers |
| Linework | `#E1E5EB` | `#262A38` | Default 1px borders — these are the "blueprint" |

Full token list in [`colors_and_type.css`](./colors_and_type.css).

### 4.2 Typography

Three families, one role each. No mixing.

- **Plus Jakarta Sans** (`var(--zm-font-display)`) — page titles, h1–h4, hero metric labels. Tight tracking (`-0.02em`) on display sizes. Space Grotesk is an approved alternative for landing/marketing surfaces but the product is Jakarta-only.
- **Inter** (`var(--zm-font-body)`) — every other piece of UI text: nav, form labels, buttons, table cells. 14px default, 16px paragraph.
- **JetBrains Mono** (`var(--zm-font-mono)`) — *every* number that appears in a data context: metrics, table values, IDs, CA codes, file hashes, percentages, currency. Tabular numerals (`font-feature-settings: 'tnum' 1`) so columns align. **This is non-negotiable** — it is what gives Z-Matrix its "matrix" feel.

Eyebrow labels use Inter 11/12px, **uppercase**, `letter-spacing: 0.14em`. Reserve for the row above a metric or a section divider — never as a heading.

### 4.3 Spacing, radii, layout

- 4px base unit. Spacing scale `4 · 8 · 12 · 16 · 24 · 32 · 48 · 64 · 96`. Tight pads (8–12px) inside data dense tables; generous gutters (32–48px) between dashboard widgets — *that's* the breathing room.
- Radii are **understated**. `10px` is the workhorse for cards and buttons; `6px` for inputs and chips; `14px` for big modal containers. Never `>16px` — this is not consumer SaaS.
- Page layout is **column-grid**. Sidebar (240–280px) + main canvas. Inside main, 12-col grid; widgets snap to 4 / 6 / 8 / 12 columns. No floating, no asymmetric overlap.
- **Sticky chrome** (titlebar, sidebar, table headers) lifts with `--zm-shadow-1` only when content scrolls beneath it — flush with the surface when at top.

### 4.4 Backgrounds — the blueprint

This is the brand's signature visual. We use a **0.5px ultra-thin grid pattern** at `rgba(17,24,39,0.04)` on dashboard backgrounds (`--zm-grid`). Cell size 40px. It is **architectural reference**, not decoration — you should feel it more than see it. Never on data cards themselves.

- No image-heavy hero banners.
- No gradients as background fills. The only allowed gradients are **protection scrims** (linear, 0→0.6 alpha, under sticky overlays) and the **copper rule** under hero metrics (a 2px horizontal line, sometimes faded copper→transparent).
- No textures. No grain. No noise.

### 4.5 Animation

Motion exists to confirm causality, never to delight.

- **Defaults**: 120ms hover, 200ms press / panel open, 360ms layout shift, 520ms hero entry. Ease via `--zm-ease` (`cubic-bezier(0.2, 0.7, 0.2, 1)`) — soft, confident, no bounce.
- **Hover**: surface lifts to `--zm-surface-hover` (≈+3% lightness in light, +4% in dark) **and** card shadow steps from `shadow-1` → `shadow-2`. No scale, no translate.
- **Press**: brief darken to `--zm-accent-press` / `--zm-surface-active`. No squish, no inset shadow.
- **Focus**: 3px ring at `rgba(0,95,96,0.18)` light / `rgba(0,180,216,0.24)` dark. Always visible — accessibility is not optional.
- **Charts**: lines redraw left-to-right on first paint (520ms ease-out). Bars grow from baseline. Tooltips fade+rise 8px in 160ms. **No bounce, no spring, no particles.**
- **Number changes**: tween via `requestAnimationFrame` over 360ms, JetBrains Mono — the value scrolls, not the box.
- Respect `prefers-reduced-motion`: collapse all to 0.01ms.

### 4.6 Borders, shadows, depth

- **One pixel, always.** Borders are `1px solid var(--zm-line)`. We never go to 2px to draw attention — we use shadow elevation or accent ring.
- **Inner shadows**: only on inset inputs in dark mode (`inset 0 1px 0 rgba(0,0,0,0.2)`).
- Shadow ladder (3 steps):
  - `shadow-1` — sticky chrome, hover cards
  - `shadow-2` — default raised card, dropdowns
  - `shadow-3` — modal, popover above modal
  - `shadow-pop` — toast / command-palette
- **Dark mode**: shadows are darker AND we add `0 0 0 1px rgba(226,232,240,0.04)` (hairline halo) — borders alone are too faint against `#171923`.

### 4.7 Hover, press, disabled, focus

| State | Surface | Text | Accent CTA |
|---|---|---|---|
| Default | `--zm-surface` | `--zm-fg` | `--zm-accent` |
| Hover   | `--zm-surface-hover` + shadow up one step | unchanged | `--zm-accent-hover` |
| Press   | `--zm-surface-active` | unchanged | `--zm-accent-press` |
| Focus   | unchanged + 3px focus ring | unchanged | accent ring |
| Disabled| `--zm-surface` 60% alpha | `--zm-fg-4` | `--zm-fg-4` bg, no shadow, `cursor: not-allowed` |
| Selected| `--zm-accent-soft` | `--zm-fg` | n/a |

### 4.8 Cards

A card is `bg: --zm-surface · border: 1px solid --zm-line · radius: 10px · shadow: --zm-shadow-1 · padding: 20–24px`. Cards never have colored left borders or accent fills as their primary chrome. If you need to communicate state, use an **eyebrow pill** in the top-left, or a small status dot, or a copper rule under the hero number — *not* a colored card background.

### 4.9 Transparency + blur

Almost never. Two allowed uses:
- **Command palette / overlay scrim**: `rgba(11,12,16,0.6)` with `backdrop-filter: blur(8px)` over content.
- **Sticky table headers**: `--zm-surface` at 92% alpha + `blur(6px)` only when content scrolls beneath.

No glassmorphism cards, no frosted sidebars, no translucent buttons.

### 4.10 Imagery

Z-Matrix is data-first; imagery is rare. When it appears:
- Site photos in the BD module — full-color, rendered with a `1px solid --zm-line` frame and `radius: 10px`. No filters.
- Avatars — 28/32/40px circles. Initials fallback uses `--zm-accent-soft` bg + `--zm-accent` text.
- Maps / Google pins — embed at native colors. We do not retint them.

---

## 5. Iconography

We standardize on **Lucide** (mono-line, 1.5px stroke, 24px native, rounded caps/joins) — it matches the "precision linework" aesthetic of the brand mark exactly and is what the existing Matrix renderer already ships (`lucide-react` is in `package.json`).

- **Loaded via CDN** for HTML mocks: `<script src="https://unpkg.com/lucide@latest"></script>` + `lucide.createIcons()`. For React: `import { ChevronRight } from 'lucide-react'`.
- **Stroke**: 1.5px default, 1.25px when rendered at 16px or smaller. 2px only inside primary CTA buttons on dark mode.
- **Sizes**: 14px (chip), 16px (button / table cell), 18px (sidebar nav), 20px (page header), 24px (empty state).
- **Color**: `currentColor` always — icons inherit text color. Brand mark / logo file is the only colored vector.
- **No emoji** in UI chrome.
- **No unicode symbol icons** (no `▲ ▼ ▶`). Use Lucide's `ChevronUp`/`Down`/`Right` so weight and alignment match the rest.
- **No filled icons** in nav. Only line icons. (Lucide ships some filled variants — avoid them.)

The Z-Matrix mark itself (`assets/zmatrix-mark.svg`) is a continuous single-line geometric Z folded to suggest a dimensional cube. It's a logo, not an icon — never use it inline.

---

## 6. Component recipes

See `ui_kits/*/` for live component code. Quick reference:

- **Button**: 36px tall, 16px h-pad, radius 10px, font-weight 600. Primary = teal fill + white text. Secondary = surface + 1px line. Ghost = transparent + accent text on hover.
- **Input**: 40px tall, radius 6px, 1px border, 12px h-pad. Focus → accent border + 3px ring.
- **Status pill**: 22px tall, radius 999px, 8px h-pad, 11px uppercase mono-tracked text. Pair a colored dot (6px) with the matching label.
- **Metric card**: eyebrow → hero number (JetBrains Mono, 48px) → optional copper rule → delta (with `ChevronUp/Down` icon + colored text).
- **Data table**: sticky header, 12px row pad, mono numerics, zebra OFF by default — use linework only.

---

## 7. How to use this system

In a new HTML mock:
```html
<link rel="stylesheet" href="colors_and_type.css">
<body class="zm-prose" data-theme="dark">
  <h1 class="zm-h1">Sites stuck at LOI</h1>
  <p class="zm-meta">12 sites · across 9 cities · &gt;14 days idle</p>
</body>
```

In a React component, prefer `var(--zm-*)` in CSS modules / styled components — never hardcode hex.

If you only have one thing to take away: **the linework is the brand**. Get the grid right, give numbers room to breathe in mono, and Z-Matrix will look like itself.
