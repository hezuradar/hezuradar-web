# 001 — Unify press-feedback scale values across small controls

- **Status**: DONE
- **Commit**: d89ce16
- **Severity**: MEDIUM
- **Category**: Physicality & origin / Cohesion & tokens
- **Estimated scope**: 1 file (`assets/css/style.css`), 5 one-line edits

## Problem

Emil Kowalski's guidance for `:active` press feedback is `transform: scale(0.95–0.98)` —
subtle. Most interactive controls in this codebase correctly sit in that range
(`.btn`, `.chip`, `.subchip`, `.payment-method-btn`, `.material-swatch`,
`.small-btn`, `.admin-tab` all use `scale(.96)` or `scale(.97)`), but five small
controls were given much more aggressive, mutually inconsistent values:

```css
/* assets/css/style.css:63 — current */
.icon-btn:active{transform:scale(.92)}
```

```css
/* assets/css/style.css:212 — current */
.modal-close:active{transform:scale(.9)}
```

```css
/* assets/css/style.css:259 — current */
.wa-float:active{transform:scale(.94)}
```

```css
/* assets/css/style.css:276 — current */
.qty-stepper button:active{transform:scale(.9)}
```

```css
/* assets/css/style.css:308 — current */
.cart-line-remove:active{transform:scale(.88)}
```

Five different values (.88, .9, .9, .92, .94) for what is functionally the same
gesture (tap feedback on a small icon-ish control) reads as arbitrary rather than
designed, and the more extreme ones (.88–.9) look like a wobble rather than a press.

## Target

All five controls use the same `scale(.96)` the rest of the site already
standardized on:

```css
/* assets/css/style.css:63 — target */
.icon-btn:active{transform:scale(.96)}
```

```css
/* assets/css/style.css:212 — target */
.modal-close:active{transform:scale(.96)}
```

```css
/* assets/css/style.css:259 — target */
.wa-float:active{transform:scale(.96)}
```

```css
/* assets/css/style.css:276 — target */
.qty-stepper button:active{transform:scale(.96)}
```

```css
/* assets/css/style.css:308 — target */
.cart-line-remove:active{transform:scale(.96)}
```

No other property on any of these five rules changes. The existing `transition`
declarations on each of these elements (durations 120–150ms, `var(--ease-out)`)
are already correct and must not be touched.

## Repo conventions to follow

- Press feedback in this codebase is always `transform: scale(<value>)` written
  directly on the `:active` pseudo-class, paired with a `transition` on the base
  rule using `var(--ease-out)` at 120–150ms. Do not introduce a new pattern.
- Exemplar to imitate exactly: `assets/css/style.css:177` —
  `.btn:active{transform:scale(.97)}` combined with `assets/css/style.css:174`'s
  `transition:...,transform 120ms var(--ease-out);`. Use `.96` (not `.97`) for
  the five controls in this plan, matching `assets/css/style.css:123`
  (`.chip:active{transform:scale(.96)}`), since these are smaller/icon-style
  controls closer in spirit to chips than to full-width buttons.

## Steps

1. In `assets/css/style.css`, change line 63 from
   `.icon-btn:active{transform:scale(.92)}` to
   `.icon-btn:active{transform:scale(.96)}`.
2. Change line 212 from `.modal-close:active{transform:scale(.9)}` to
   `.modal-close:active{transform:scale(.96)}`.
3. Change line 259 from `.wa-float:active{transform:scale(.94)}` to
   `.wa-float:active{transform:scale(.96)}`.
4. Change line 276 from `.qty-stepper button:active{transform:scale(.9)}` to
   `.qty-stepper button:active{transform:scale(.96)}`.
5. Change line 308 from `.cart-line-remove:active{transform:scale(.88)}` to
   `.cart-line-remove:active{transform:scale(.96)}`.

## Boundaries

- Do NOT touch any other property on these five rules (transitions, colors,
  sizes, hover states).
- Do NOT change `.btn`, `.chip`, `.subchip`, `.payment-method-btn`,
  `.material-swatch`, `.small-btn`, or `.admin-tab` — they already use the
  correct value.
- Do NOT add new CSS variables or tokens for this — `scale(.96)` is written
  literally at each site, matching the existing convention (the repo does not
  tokenize scale values, only easing curves).
- If any of the five line numbers no longer match the quoted current code
  (drift since commit `d89ce16`), STOP and report instead of guessing which
  rule was meant.

## Verification

- **Mechanical**: none (CSS-only, no build step in this repo). Confirm with
  `grep -n "scale(\." assets/css/style.css` that the five values listed above
  now all read `scale(.96)` and no other `:active` rule in the file was
  altered.
- **Feel check**: open `index.html` via the repo's static server
  (`.claude/launch.json` → `hezuradar-static`, port 8090) in a browser.
  - Click the cart icon (`.icon-btn`) and the Instagram icon in the header —
    the press should look like a gentle squeeze, not a snap.
  - Open a product modal and click the `×` close button (`.modal-close`) —
    same subtle squeeze.
  - Hover/click the floating WhatsApp button (`.wa-float`, bottom-right).
  - Open the product modal and click the `+`/`−` quantity buttons
    (`.qty-stepper button`).
  - Open the cart with an item in it and click the small `×` next to a line
    item (`.cart-line-remove`).
  - All five should now feel like the same family of press feedback as the
    "Añadir a la cesta" button and the category chips — subtle, not wobbly.
  - In Chrome DevTools → More tools → Animations, set playback to 10% and
    step through one of the clicks: the scale dip should be barely visible,
    not a large jump.
- **Done when**: all five selectors read `scale(.96)` and pressing each control
  in the browser feels consistent with `.chip`/`.btn` press feedback.
