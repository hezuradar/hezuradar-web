# 004 — Replace bare `ease` with easing tokens on modal/cart backdrops

- **Status**: DONE
- **Commit**: d89ce16
- **Severity**: LOW
- **Category**: Easing & duration / Cohesion & tokens
- **Estimated scope**: 1 file (`assets/css/style.css`), 4 one-line edits

## Problem

This project introduced four custom easing tokens for exactly this kind of
UI motion:

```css
/* assets/css/style.css:14-17 — current, already in the file */
--ease-out:cubic-bezier(.23,1,.32,1);
--ease-in-out:cubic-bezier(.77,0,.175,1);
--ease-in:cubic-bezier(.4,0,1,1);
--ease-drawer:cubic-bezier(.32,.72,0,1);
```

The modal box (`.modal`) and the cart drawer (`.cart-drawer`) correctly use
`var(--ease-out)` on entrance and `var(--ease-in)` on exit. But the two
backdrop elements behind them were left on the browser's bare, weak `ease`
curve instead of adopting the same tokens:

```css
/* assets/css/style.css:190-197 — current */
.modal-backdrop{
  position:fixed;inset:0;background:rgba(15,25,35,.6);
  display:flex;align-items:center;justify-content:center;padding:20px;
  z-index:100;
  opacity:1;transition:opacity 200ms ease;
  @starting-style{opacity:0}
}
.modal-backdrop.closing{opacity:0;transition:opacity 160ms ease}
```

```css
/* assets/css/style.css:286-292 — current */
.cart-backdrop{
  position:fixed;inset:0;background:rgba(15,25,35,.55);
  display:flex;justify-content:flex-end;z-index:110;
  opacity:1;transition:opacity 220ms ease;
  @starting-style{opacity:0}
}
.cart-backdrop.closing{opacity:0;transition:opacity 180ms ease}
```

Per AUDIT.md category 2, a bare `ease` on an entrance/exit is a finding —
entering/exiting content should use `ease-out` for entry and (per this
repo's own established asymmetric pattern) `ease-in` for exit. It's also a
tokens/cohesion gap: two near-identical hand-typed `ease` values sitting right
next to code that correctly uses the tokenized curves.

## Target

```css
/* assets/css/style.css:190-197 — target */
.modal-backdrop{
  position:fixed;inset:0;background:rgba(15,25,35,.6);
  display:flex;align-items:center;justify-content:center;padding:20px;
  z-index:100;
  opacity:1;transition:opacity 200ms var(--ease-out);
  @starting-style{opacity:0}
}
.modal-backdrop.closing{opacity:0;transition:opacity 160ms var(--ease-in)}
```

```css
/* assets/css/style.css:286-292 — target */
.cart-backdrop{
  position:fixed;inset:0;background:rgba(15,25,35,.55);
  display:flex;justify-content:flex-end;z-index:110;
  opacity:1;transition:opacity 220ms var(--ease-out);
  @starting-style{opacity:0}
}
.cart-backdrop.closing{opacity:0;transition:opacity 180ms var(--ease-in)}
```

Only the word `ease` inside each of these four `transition:opacity ...`
declarations changes to `var(--ease-out)` (entrance rules) or
`var(--ease-in)` (the two `.closing` exit rules). Durations (200ms, 160ms,
220ms, 180ms) are unchanged — this plan is an easing-curve swap only, not a
timing change.

## Repo conventions to follow

- The tokens already exist at `assets/css/style.css:14-17` — this plan only
  consumes them, it does not define new ones.
- Exemplar already in the same file showing the exact entrance/exit pairing
  to copy: `assets/css/style.css:202-205` —
  ```css
  .modal{
    ...
    opacity:1;transform:scale(1);transition:opacity 220ms var(--ease-out),transform 220ms var(--ease-out);
    @starting-style{opacity:0;transform:scale(.95)}
  }
  .modal-backdrop.closing .modal{opacity:0;transform:scale(.97);transition:opacity 160ms var(--ease-in),transform 160ms var(--ease-in)}
  ```
  This plan makes `.modal-backdrop` and `.cart-backdrop` follow that same
  entrance-uses-`ease-out`/exit-uses-`ease-in` pairing that `.modal` and
  `.cart-drawer` already use.

## Steps

1. In `assets/css/style.css` line 194, change
   `opacity:1;transition:opacity 200ms ease;` to
   `opacity:1;transition:opacity 200ms var(--ease-out);` (inside
   `.modal-backdrop{}`).
2. In line 197, change
   `.modal-backdrop.closing{opacity:0;transition:opacity 160ms ease}` to
   `.modal-backdrop.closing{opacity:0;transition:opacity 160ms var(--ease-in)}`.
3. In line 289, change
   `opacity:1;transition:opacity 220ms ease;` to
   `opacity:1;transition:opacity 220ms var(--ease-out);` (inside
   `.cart-backdrop{}`).
4. In line 292, change
   `.cart-backdrop.closing{opacity:0;transition:opacity 180ms ease}` to
   `.cart-backdrop.closing{opacity:0;transition:opacity 180ms var(--ease-in)}`.

## Boundaries

- Do NOT change any duration value (200ms, 160ms, 220ms, 180ms stay exactly
  as they are).
- Do NOT touch `.modal`, `.cart-drawer`, or any other rule — only the four
  `transition:opacity ...` declarations on `.modal-backdrop` and
  `.cart-backdrop` (base and `.closing`).
- Do NOT touch the checkout-view desktop override block
  (`assets/css/style.css:353-364`, the `@media (min-width:761px)` block with
  `.cart-drawer.checkout-view`) — it already uses `var(--ease-out)` /
  `var(--ease-in)` correctly and is out of scope for this plan.
- If lines 190-197 or 286-292 don't match the code quoted in **Problem**
  verbatim (drift since commit `d89ce16`), STOP and report instead of
  guessing which occurrence of `ease` to replace.

## Verification

- **Mechanical**: none (CSS-only). Confirm with
  `grep -n "transition:opacity.*ease;" assets/css/style.css` finding zero
  matches for bare `ease` on `.modal-backdrop`/`.cart-backdrop`, and
  `grep -n "var(--ease-out)\|var(--ease-in)" assets/css/style.css` showing the
  two backdrop rules now among the matches.
- **Feel check**: this is a subtle curve change on an opacity-only fade, so
  the visual difference is intentionally small. Open `index.html` via the
  repo's static server (`.claude/launch.json` → `hezuradar-static`, port
  8090):
  - Open and close a product modal a few times; the dark backdrop fade should
    feel at least as snappy as before, not slower.
  - Open and close the cart drawer a few times; same check.
  - In DevTools Animations panel, set playback to 10% and compare the
    backdrop's opacity ramp to the modal box's opacity ramp (which already
    uses `var(--ease-out)`) — they should now visibly ease the same way
    instead of the backdrop looking slightly more linear/mechanical.
- **Done when**: all four `transition:opacity` declarations on
  `.modal-backdrop`/`.cart-backdrop` use `var(--ease-out)` (entrance) or
  `var(--ease-in)` (exit) instead of bare `ease`, with no duration changes.
