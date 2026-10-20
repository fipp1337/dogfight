export interface LoopStats {
  stepsPerSecond: number;
  framesPerSecond: number;
  frameMs: number;
}
export interface Loop {
  start(): void;
  stop(): void;
}

export function createLoop(options: {
  step?: number;
  simulate: (dt: number) => void;
  render: (alpha: number, stats: LoopStats) => void;
}): Loop {
  const step = options.step ?? 1 / 60;
  let animationId: number | undefined;
  let last = 0;
  let accumulator = 0;
  let stats: LoopStats = {
    stepsPerSecond: Math.round(1 / step),
    framesPerSecond: 0,
    frameMs: 0,
  };
  let frameCount = 0;
  let statsAt = 0;
  let previousFrameAt = 0;
  const frame = (now: number): void => {
    const elapsed = Math.min((now - last) / 1000, 0.25);
    last = now;
    accumulator += elapsed;
    stats.frameMs = previousFrameAt ? now - previousFrameAt : 0;
    previousFrameAt = now;
    let steps = 0;
    while (accumulator >= step && steps < 15) {
      options.simulate(step);
      accumulator -= step;
      steps += 1;
    }
    frameCount += 1;
    if (now - statsAt >= 1000) {
      stats = {
        stepsPerSecond: Math.round(1 / step),
        framesPerSecond: Math.round((frameCount * 1000) / (now - statsAt)),
        frameMs: stats.frameMs,
      };
      frameCount = 0;
      statsAt = now;
    }
    options.render(accumulator / step, stats);
    animationId = requestAnimationFrame(frame);
  };
  return {
    start() {
      if (animationId !== undefined) return;
      last = performance.now();
      statsAt = last;
      animationId = requestAnimationFrame(frame);
    },
    stop() {
      if (animationId === undefined) return;
      cancelAnimationFrame(animationId);
      animationId = undefined;
    },
  };
}
