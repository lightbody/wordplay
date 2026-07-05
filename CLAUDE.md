# Wordplay

A Scrabble-like word game for two, played over the web.

## Stack

- `frontend/` — React 18 + TypeScript + Vite. Plain global stylesheet (`frontend/src/App.css`,
  CSS custom properties, no Tailwind/CSS-modules). `motion` (Framer Motion) for tile/layout
  animations. Data sync via ElectricSQL shapes (`useGamesShape`/`useMovesShape`/`useRacksShape`
  in `frontend/src/shapes.ts`) against a Rust backend. Auth via WorkOS AuthKit.
- `backend/` — Rust (Cargo), authoritative game engine + dictionary + Postgres.
- `electric/` — ElectricSQL sync service config.

## Frontend commands

Run from `frontend/`:
- `npm install` — dependencies aren't pre-installed in a fresh checkout/session; run this first.
- `npx tsc --noEmit` — typecheck.
- `npx vitest run` — unit tests (plain function tests, no jsdom/testing-library — keep new test
  targets DOM-free like `frontend/src/engine.test.ts` / `zoomMath.test.ts`).
- `npm run build` — `tsc && vite build`, the full gate before calling a change done.

## Verifying UI/gesture changes in this sandbox

`GameScreen` requires WorkOS auth + a live backend + ElectricSQL, none of which are available in
a Claude Code remote session. To actually exercise a layout/component change end-to-end here (not
just typecheck/build), use a harness that mounts the real components (`Board`, `BoardViewport`,
`Rack`, `Tile`, `ScoreBar`, etc.) with hand-built mock data, no routing/auth/API involved. Vite's
dev server picks up any `.html` file at the project root automatically — no config changes needed,
just `npm run dev -- --port <port>` and navigate to `/<name>-harness.html`. Neither harness is
imported from `main.tsx` or linked from any route, so they never affect the shipped app.

- **`frontend/drag-harness.html` + `frontend/src/drag-harness.tsx`** — persistent, committed to the
  repo. Covers the rack drag-and-drop interactions (drag a tile onto the board, drag within the
  rack to reorder with the live "make room" slide). Extend this one in place as drag/board/rack
  behavior evolves, rather than writing a new throwaway harness for the same components — the
  Playwright setup below and the touch-gesture gotchas took real time to work out the first time,
  and re-deriving them from scratch each session is wasted effort now that a working harness
  exists. If you add a genuinely new scenario, add a new mock/state variant inside this file rather
  than spinning up a parallel harness for the same components.
- **`frontend/zoom-harness.html` + `frontend/src/zoom-harness.tsx`** — throwaway. Recreate it when
  you need to verify `BoardViewport`'s pinch/pan/zoom behavior specifically, and delete both files
  before committing; they're scaffolding, not part of the app.

Only build a new harness from scratch when the components under test aren't already covered by
one of the above.

Playwright + a pre-installed Chromium are available in this environment
(`/opt/pw-browsers/chromium`), but the `playwright` npm package isn't a project dependency and
isn't resolvable via `NODE_PATH` for ESM (`NODE_PATH` only affects CommonJS resolution). To use it
from a throwaway script: symlink the global install into a scratch `node_modules/`, e.g.
```bash
mkdir -p /path/to/scratchpad/node_modules
ln -sf /opt/node22/lib/node_modules/playwright /path/to/scratchpad/node_modules/playwright
ln -sf /opt/node22/lib/node_modules/playwright-core /path/to/scratchpad/node_modules/playwright-core
node /path/to/scratchpad/verify.mjs   # now `import { chromium } from "playwright"` resolves
```
then `chromium.launch({ executablePath: "/opt/pw-browsers/chromium" })`.

### Testing touch gestures / native pinch-zoom / touch-action

**`page.evaluate(() => el.dispatchEvent(new PointerEvent(...)))` does NOT exercise the browser's
own native gesture pipeline** — it only reaches your own JS event listeners. It's fine for
asserting your own pointermove/pinch math, but it will pass even if `touch-action` /
`preventDefault` are completely broken and the browser's real native pinch-zoom is still active,
because synthetic JS-dispatched events never reach the browser's default-action handling. This
bit us once already in this codebase (`BoardViewport`'s pinch/double-tap zoom) — a CSS/JS fix that
looked verified via synthetic PointerEvents turned out not to actually block native zoom on the
scorebar, because ancestor `touch-action: none` isn't reliably honored by browsers for the *zoom*
gesture specifically (only for panning), and Chrome only respects your own code, not the OS gesture
recognizer, via synthetic events.

To actually verify native pinch-zoom is blocked (or allowed) somewhere, drive real touch input via
CDP directly, and check `window.visualViewport.scale` (the ground truth for native zoom state, independent
of any of your own JS transforms):
```js
const cdp = await page.context().newCDPSession(page);
await cdp.send("Input.dispatchTouchEvent", {
  type: "touchStart",
  touchPoints: [{ x: cx - 20, y: cy, id: 1 }, { x: cx + 20, y: cy, id: 2 }],
});
// ...touchMove steps spreading the two points apart...
await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
const scale = await page.evaluate(() => window.visualViewport.scale); // stays 1 if truly blocked
```
Launch the browser with `args: ["--touch-events=enabled"]` and the page with
`{ hasTouch: true, isMobile: true }` for this to work.

Also worth knowing for any future touch/zoom work on this app:
- iOS Safari has ignored `<meta viewport>` `maximum-scale`/`user-scalable=no` since iOS 10 (an
  intentional accessibility decision) — don't rely on the viewport meta alone to block page zoom.
- Blocking native pinch-zoom reliably requires **all** of: explicit `touch-action: none` on every
  element you actually want it on (don't just set it on a distant ancestor and assume it
  propagates — it doesn't reliably, for the zoom gesture specifically), a document-level
  `touchstart`/`touchmove` listener that `preventDefault()`s when `e.touches.length > 1` (covers
  Chrome/Android), and a `gesturestart` listener on `document` calling `preventDefault()` (covers
  Safari's legacy proprietary pinch-gesture events).

## CSS/layout gotchas hit in this codebase

- A CSS Grid with `repeat(N, 1fr)` columns does **not** shrink a track below its content's
  intrinsic min-width unless grid items have `min-width: 0` — an errant `min-width`/`min-height`
  on a deeply nested child (e.g. `.tile` inside `.cell` inside the 15-column `.board`) can force
  the whole grid wider than the viewport with no visual indication of why. Add `min-width: 0` to
  grid items defensively.
- An element with `aspect-ratio: 1` and `width: 100%` only ever sizes off *width* — it will never
  grow to use extra available *height* even inside a flex container with room to spare (`max-height`
  only clamps down, it can't make something grow). To get "largest square that fits an
  irregularly-shaped flex area" (e.g. the board between a fixed header and fixed footer), measure
  the container with a `ResizeObserver` and set an explicit pixel `width`/`height` to
  `Math.min(containerWidth, containerHeight)` — see `BoardViewport.tsx`.
