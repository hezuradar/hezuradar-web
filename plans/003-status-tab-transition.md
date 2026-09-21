# 003 — Add transition + press feedback to admin order-status tabs

- **Status**: DONE
- **Commit**: d89ce16
- **Severity**: MEDIUM
- **Category**: Cohesion & tokens
- **Estimated scope**: 1 file (`assets/css/style.css`), 2 line edits

## Problem

`.status-tab` is the pill-shaped filter used in the admin panel to switch
between order statuses (Pendiente/Confirmado/Enviado/Entregado/Cancelado). It
is functionally identical to `.chip` (a pill filter that toggles an `.active`
state) and to `.admin-tab` (a tab that toggles `.active`), both of which
received a `transition` and `:active` press feedback earlier in this
project's motion pass. `.status-tab` was missed:

```css
/* assets/css/style.css:477-485 — current */
.status-tab{
  flex:none;display:flex;align-items:center;gap:6px;padding:8px 14px;border-radius:999px;border:1px solid var(--color-border);
  background:#fff;color:var(--color-muted);font-size:.84rem;font-weight:700;white-space:nowrap;
}
.status-tab.active{background:var(--color-primary-dark);border-color:var(--color-primary-dark);color:#fff}
.status-tab-count{
  background:var(--color-bg);color:var(--color-muted);border-radius:999px;padding:1px 7px;font-size:.74rem;font-weight:800;
}
.status-tab.active .status-tab-count{background:rgba(255,255,255,.25);color:#fff}
```

There is no `transition` property anywhere on `.status-tab`, so clicking
between status tabs — something the shop owner does many times per admin
session while triaging orders — snaps the background/border/text color
instantly, and gives no press feedback, unlike every sibling filter/tab
control in the same panel.

## Target

```css
/* assets/css/style.css:477-485 — target */
.status-tab{
  flex:none;display:flex;align-items:center;gap:6px;padding:8px 14px;border-radius:999px;border:1px solid var(--color-border);
  background:#fff;color:var(--color-muted);font-size:.84rem;font-weight:700;white-space:nowrap;
  transition:background .15s ease,border-color .15s ease,color .15s ease,transform 120ms var(--ease-out);
}
.status-tab:active{transform:scale(.96)}
.status-tab.active{background:var(--color-primary-dark);border-color:var(--color-primary-dark);color:#fff}
.status-tab-count{
  background:var(--color-bg);color:var(--color-muted);border-radius:999px;padding:1px 7px;font-size:.74rem;font-weight:800;
}
.status-tab.active .status-tab-count{background:rgba(255,255,255,.25);color:#fff}
```

Two additions only: a `transition` line inside `.status-tab{}` and a new
`.status-tab:active{transform:scale(.96)}` rule immediately after it. Nothing
else changes — `.status-tab.active`, `.status-tab-count`, and
`.status-tab.active .status-tab-count` stay byte-for-byte identical.

## Repo conventions to follow

- This is the exact pattern already used for the sibling control
  `.admin-tab`, at `assets/css/style.css:453-459`:
  ```css
  .admin-tab{
    padding:10px 18px;border:none;background:none;font-weight:700;font-size:.92rem;
    color:var(--color-muted);border-bottom:2px solid transparent;margin-bottom:-1px;
    display:flex;align-items:center;gap:8px;
    transition:color .15s ease,border-color .15s ease,transform 120ms var(--ease-out);
  }
  .admin-tab:active{transform:scale(.97)}
  ```
  Use `scale(.96)` (not `.97`) to match `.chip:active` at
  `assets/css/style.css:123`, since `.status-tab` is a pill shape like
  `.chip`, not a full-width bar like `.admin-tab`.
- Background/border/color transitions in this file are always written as
  three explicit comma-separated properties (`background`, `border-color`,
  `color`), each `.15s ease` — never `transition:all`. Follow that exact
  wording, don't shorten it.

## Steps

1. In `assets/css/style.css`, locate the `.status-tab{...}` rule (line
   477-480).
2. Add a `transition` declaration as the last line inside that rule's braces,
   directly above the closing `}`:
   `transition:background .15s ease,border-color .15s ease,color .15s ease,transform 120ms var(--ease-out);`
3. Immediately after the closing `}` of `.status-tab{}` (and before the
   existing `.status-tab.active{...}` line), insert a new rule on its own
   line: `.status-tab:active{transform:scale(.96)}`.
4. Do not reorder or edit `.status-tab.active`, `.status-tab-count`, or
   `.status-tab.active .status-tab-count` — leave them exactly as they are,
   immediately following the new `:active` rule.

## Boundaries

- Do NOT touch `.status-tab.active`, `.status-tab-count`, or
  `.status-tab.active .status-tab-count`.
- Do NOT touch `.admin-tab` (already correct — used only as the exemplar to
  copy the pattern from).
- Do NOT add a transition to `.order-status-select` (the native `<select>`
  used elsewhere in the orders panel) — that is out of scope for this finding.
- If the current content of lines 477-485 does not match the code quoted in
  **Problem** verbatim (drift since commit `d89ce16`), STOP and report instead
  of guessing where to insert the new rules.

## Verification

- **Mechanical**: none (CSS-only). Confirm with
  `grep -n "status-tab" assets/css/style.css` that `.status-tab{}` now
  contains a `transition` line and that a new `.status-tab:active{...}` rule
  exists between `.status-tab{}` and `.status-tab.active{}`.
- **Feel check**: open `admin.html` via the repo's static server
  (`.claude/launch.json` → `hezuradar-static`, port 8090), unlock the admin
  panel, go to the Pedidos tab, and:
  - Click between the status filter pills (Pendiente, Confirmado, Enviado,
    Entregado, Cancelado, and "Todos" if present) — the background/border/text
    color should ease over ~150ms instead of snapping.
  - Click and hold one of the pills — it should visibly compress to 96% scale
    like the category chips on the storefront do.
  - In DevTools Animations panel, set playback to 10% and click a tab: the
    color change and the scale dip should be visible as a smooth ease, not an
    instant jump.
- **Done when**: switching status tabs eases in color instead of snapping, and
  clicking a tab gives the same `scale(.96)` press feedback as `.chip` on the
  storefront.
