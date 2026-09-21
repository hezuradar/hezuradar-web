# 002 — Respect prefers-reduced-motion for movement-based transitions

- **Status**: DONE
- **Commit**: d89ce16
- **Severity**: MEDIUM
- **Category**: Accessibility
- **Estimated scope**: 1 file (`assets/css/style.css`), one new media-query block near the end of the file + one attribute change in `index.html`

## Problem

`assets/css/style.css` has zero `@media (prefers-reduced-motion: reduce)`
rules. Several of the site's transitions move or scale content, not just fade
it:

```css
/* assets/css/style.css:198-205 — current (modal: scale + opacity) */
.modal{
  background:#fff;border-radius:16px;max-width:820px;width:100%;
  max-height:88vh;overflow:auto;display:grid;grid-template-columns:1fr 1fr;
  position:relative;
  opacity:1;transform:scale(1);transition:opacity 220ms var(--ease-out),transform 220ms var(--ease-out);
  @starting-style{opacity:0;transform:scale(.95)}
}
.modal-backdrop.closing .modal{opacity:0;transform:scale(.97);transition:opacity 160ms var(--ease-in),transform 160ms var(--ease-in)}
```

```css
/* assets/css/style.css:293-299 — current (cart drawer: translateX slide) */
.cart-drawer{
  background:#fff;width:100%;max-width:420px;height:100%;overflow-y:auto;
  padding:26px 22px;position:relative;
  transform:translateX(0);transition:transform 260ms var(--ease-drawer);
  @starting-style{transform:translateX(100%)}
}
.cart-backdrop.closing .cart-drawer{transform:translateX(100%);transition:transform 200ms var(--ease-in)}
```

```css
/* assets/css/style.css:250-259 — current (WhatsApp float: hover scale) */
.wa-float{
  position:fixed;right:22px;bottom:22px;width:56px;height:56px;border-radius:50%;
  background:var(--color-whatsapp);color:#fff;display:grid;place-items:center;
  box-shadow:0 6px 18px rgba(0,0,0,.25);z-index:50;
  transition:transform 150ms var(--ease-out);
}
@media (hover:hover) and (pointer:fine){
  .wa-float:hover{transform:scale(1.06)}
}
.wa-float:active{transform:scale(.94)}
```

```css
/* assets/css/style.css:144-147 — current (product card: hover lift) */
.card{
  background:var(--color-card);border-radius:var(--radius);overflow:hidden;
  box-shadow:var(--shadow);border:1px solid var(--color-border);
  display:flex;flex-direction:column;
  transition:transform 180ms var(--ease-out),box-shadow 180ms var(--ease-out);
}
.card:hover{transform:translateY(-3px);box-shadow:var(--shadow-lg)}
```

Separately, `index.html` runs an infinite, un-pausable hero crossfade:

```html
<!-- index.html:45-49 — current -->
<img src="images/site/hero/photo-1.jpg" alt="" class="hero-slide" style="animation-delay:0s">
<img src="images/site/hero/photo-2.jpg" alt="" class="hero-slide" style="animation-delay:4s">
<img src="images/site/hero/photo-3.jpg" alt="" class="hero-slide" style="animation-delay:8s">
<img src="images/site/hero/photo-4.jpg" alt="" class="hero-slide" style="animation-delay:12s">
<img src="images/site/hero/photo-5.jpg" alt="" class="hero-slide" style="animation-delay:16s">
```

```css
/* assets/css/style.css:68-78 — current */
.hero-slide{
  position:absolute;inset:0;width:100%;height:100%;object-fit:cover;
  opacity:0;animation:hero-fade 20s infinite;
}
@keyframes hero-fade{
  0%{opacity:0}
  5%{opacity:.9}
  20%{opacity:.9}
  25%{opacity:0}
  100%{opacity:0}
}
```

Per AUDIT.md category 6: reduced motion means fewer/gentler animations, not
zero — opacity/color feedback should stay, movement (`transform: translate*`,
`scale` beyond press feedback, and continuous looping motion) should go.

## Target

Add one media-query block at the end of `assets/css/style.css` (after the
final existing rule, currently the `@media (max-width:600px)` block starting
around line 620 for `.designer-page`) that removes movement/scaling while
keeping opacity fades:

```css
/* assets/css/style.css — new block, appended at end of file */
@media (prefers-reduced-motion: reduce){
  .modal-backdrop,.modal-backdrop.closing,
  .cart-backdrop,.cart-backdrop.closing{
    transition:opacity 160ms ease;
  }
  .modal,.modal-backdrop.closing .modal{
    transform:none;
    transition:opacity 160ms ease;
    @starting-style{transform:none}
  }
  .cart-drawer,.cart-backdrop.closing .cart-drawer{
    transform:none;
    transition:opacity 160ms ease;
    @starting-style{transform:none}
  }
  .card:hover{transform:none}
  .wa-float:hover{transform:none}
  .hero-slide{animation-play-state:paused;opacity:.9}
}
```

Note the last rule: pausing `hero-fade` mid-cycle would leave whichever slide
happens to be at 0 opacity permanently invisible, so `.hero-slide{opacity:.9}`
forces every slide visible (stacked, `object-fit:cover`, so the top one in DOM
order — `photo-1.jpg` — reads as a normal static hero image) while
`animation-play-state:paused` stops the animation clock. This trades the
slideshow for a single static photo under reduced motion, which is the
correct trade per AUDIT.md ("remove position/movement changes").

Press-feedback `:active` scale rules (`.btn`, `.chip`, `.icon-btn`, etc.) are
**not** touched — a 96% press scale is not the kind of movement reduced-motion
users need removed; it's instantaneous confirmation feedback with no
sustained motion, and AUDIT.md's own example keeps "transitions that aid
comprehension."

## Repo conventions to follow

- All easing/motion rules for a given component live together in
  `assets/css/style.css`, not in a separate stylesheet — add the new block
  in the same file.
- The codebase already uses nested `@starting-style` inside a normal
  selector (see `assets/css/style.css:194-196` for `.modal-backdrop`) — reuse
  that same nesting syntax for the reduced-motion overrides of `.modal` and
  `.cart-drawer` so `@starting-style` doesn't fight the override.
- Media queries in this file are appended in a block per breakpoint/concern,
  not scattered — follow the existing `@media (max-width:...)` blocks near
  the end of the file as placement precedent, and put this new
  `prefers-reduced-motion` block after all of them (last in the file).

## Steps

1. Open `assets/css/style.css` and go to the very end of the file (653 lines
   total at commit `d89ce16`). The file currently ends with the
   `@media (max-width:600px)` block for `.designer-page`:
   ```css
   @media (max-width:600px){
     .designer-page{padding-top:20px}
     .material-swatch{width:80px}
     .material-swatch img{width:64px;height:64px}
   }
   ```
2. Append the exact `@media (prefers-reduced-motion: reduce){ ... }` block
   from the **Target** section above, verbatim, as the new final block in
   the file.
3. Open `index.html`, confirm lines 45-49 still match the `<img class="hero-slide" ...>` markup quoted in **Problem** — no HTML change is needed, the CSS override in step 2 handles it entirely via `.hero-slide{animation-play-state:paused;opacity:.9}`.

## Boundaries

- Do NOT remove or modify the existing `@starting-style` blocks used for the
  normal (non-reduced-motion) entrance animations — only add overrides inside
  the new `prefers-reduced-motion` media query.
- Do NOT touch `.btn`, `.chip`, `.subchip`, `.payment-method-btn`,
  `.material-swatch`, `.small-btn`, `.admin-tab`, `.icon-btn`, `.modal-close`,
  `.qty-stepper button`, or `.cart-line-remove` `:active` press-feedback rules
  — those stay animated under reduced motion per AUDIT.md.
- Do NOT add a JS-based `matchMedia('(prefers-reduced-motion: reduce)')`
  check — this site has no animation logic in JS that depends on motion
  preference (the modal/cart open-close delay in `main.js`/`cart.js` is a
  fixed `setTimeout` used to defer DOM removal, not a duration that needs to
  change under reduced motion, since the CSS transition duration inside the
  media query is still 160ms, safely under the JS timeout).
- If the end of `assets/css/style.css` no longer ends with the
  `.material-swatch img` rule quoted in step 1 (drift since commit
  `d89ce16`), STOP and report instead of guessing where to append.

## Verification

- **Mechanical**: none (CSS-only). Confirm with
  `grep -n "prefers-reduced-motion" assets/css/style.css` that exactly one
  new block was added, at the end of the file.
- **Feel check**: open `index.html` via the repo's static server
  (`.claude/launch.json` → `hezuradar-static`, port 8090).
  - In Chrome DevTools, open the Rendering tab (Cmd/Ctrl+Shift+P → "Show
    Rendering") and set "Emulate CSS media feature
    prefers-reduced-motion" to "reduce".
  - Reload the page: the hero should show one static photo, not a crossfade.
  - Open a product modal: it should fade in/out (opacity only), with no
    scale/pop.
  - Open the cart drawer: it should fade in/out, with no slide-in from the
    right.
  - Hover a product card: it should NOT lift (`translateY`).
  - Hover the WhatsApp button: it should NOT grow.
  - Click any button/chip: the press-feedback `scale(.96)`-style squeeze
    should still happen — reduced motion removes movement, not all feedback.
  - Turn the emulation back to "No emulation" and confirm every animation
    from plan 001's feel-check still works normally (modal scales in, cart
    slides in, card lifts on hover).
- **Done when**: with `prefers-reduced-motion: reduce` emulated, the modal and
  cart drawer only fade (no scale/slide), the hero shows a static image, hover
  lift/scale effects are gone, and press feedback on buttons/chips is
  unchanged; with no emulation, nothing regresses from the current behavior.
