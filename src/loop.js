/** A display-synchronised loop with a deterministic fixed-step simulation. */
export function createLoop({ step = 1 / 60, simulate, render }) {
  let animationId = null;
  let last = 0;
  let accumulator = 0;
  let stats = { stepsPerSecond: 0, framesPerSecond: 0, frameMs: 0 };
  let frames = 0;
  let statsAt = 0;

  function frame(now) {
    const elapsed = Math.min((now - last) / 1000, 0.25);
    last = now;
    accumulator += elapsed;
    stats.frameMs = elapsed * 1000;

    while (accumulator >= step) {
      simulate(step);
      accumulator -= step;
    }

    frames += 1;
    if (now - statsAt >= 1000) {
      const seconds = (now - statsAt) / 1000;
      stats = {
        // The simulation frequency is set by `step`; update-window boundaries
        // can contain 59 or 61 ticks even while the fixed rate is exactly 60 Hz.
        stepsPerSecond: Math.round(1 / step),
        framesPerSecond: Math.round(frames / seconds),
        frameMs: stats.frameMs,
      };
      frames = 0;
      statsAt = now;
    }
    render(accumulator / step, stats);
    animationId = requestAnimationFrame(frame);
  }

  return {
    start() {
      if (animationId !== null) return;
      last = performance.now();
      statsAt = last;
      animationId = requestAnimationFrame(frame);
    },
    stop() {
      if (animationId === null) return;
      cancelAnimationFrame(animationId);
      animationId = null;
    },
  };
}
