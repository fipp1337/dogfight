# Dogfight — Lab 01

A small canvas flight game built to make the JavaScript event loop and a fixed-timestep game loop visible.

## Run it

Requires Node 24 (see `.nvmrc`).

```bash
npm install
npm run dev
```

Use **Left/Right Arrow** to rotate, **Up Arrow** to thrust, and **R** to reset. The HUD reports fixed simulation steps per second, render frames per second, and the latest frame duration.

## Design

- `src/loop.js` runs a `requestAnimationFrame` loop with a 1/60 s accumulator. Frame deltas are clamped to 250 ms, preventing a long hitch from causing an unbounded catch-up loop.
- `src/sim/` is deterministic game logic: it has no Canvas or DOM dependency. Each simulation tick receives exactly the same `dt`.
- Rendering blends the previous and current ship state using `alpha = accumulator / step`. Angles use shortest-path interpolation, avoiding a full spin across the `-π` / `π` boundary.
- Canvas backing pixels follow `devicePixelRatio`; CSS dimensions remain in normal device-independent pixels.

## Experiments (M4)

These baseline measurements were made on a 60 Hz display with the production game unchanged. Exact values vary by machine and browser.

### 1. Synchronous 100 ms render block

Adding `while (performance.now() < started + 100) {}` on every 60th render made the ship visibly jump and produced one roughly 100 ms frame each second. FPS dipped to about 54–56 and the simulation briefly caught up using several 16.67 ms updates. The browser cannot paint, process input, or run another callback until the current JavaScript call returns: all of them share the main thread and its run-to-completion call stack.

### 2. `setInterval(frame, 16)` instead of rAF

For a 10-second foreground run, `setInterval` averaged about 62 callbacks/s, with a typical frame delta near 16 ms but occasional 20–32 ms jitter. `requestAnimationFrame` stayed near 60 fps and painted in sync with the display. In a background tab, rAF paused; timer callbacks were heavily throttled and resumed with a large gap. rAF is preferred because it is display-aligned, avoids unnecessary background rendering, and provides a paint-ready timestamp.

### 3. Variable timestep under 6× CPU throttling

Replacing the accumulator with a single `simulate(realDt)` per render produces a different post-5-second position when thrust is held under CPU throttling: the larger per-frame `dt` changes drag integration and can overshoot collision/wrap boundaries. With the fixed 1/60 s loop, the same recorded input sequence advances the same number of simulation steps and ends at the same position; rendering speed only affects interpolation.

## Quality checks

```bash
npm run lint
npm run format:check
npm run build
```

## Event-loop note

After a task finishes, the browser drains microtasks before it can render or take the next task. `requestAnimationFrame` runs in the rendering opportunity after tasks and microtasks, immediately before paint. A promise callback therefore runs before an already-ready timer callback; neither can interrupt synchronous JavaScript currently on the call stack.
