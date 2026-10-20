import {
  runSimulationBenchmark,
  type SimulationBenchmark,
} from "./perf-core.js";

interface WorkerResult {
  simulation: SimulationBenchmark;
  workerExecutionMs: number;
}

interface BenchmarkReport {
  mainThread: SimulationBenchmark & { wallMs: number; maxFrameGapMs: number };
  worker: SimulationBenchmark & {
    wallMs: number;
    workerExecutionMs: number;
    maxFrameGapMs: number;
  };
  conclusion: string;
}

const button = document.querySelector<HTMLButtonElement>("#run");
const result = document.querySelector<HTMLPreElement>("#result");
if (!button || !result)
  throw new Error("Performance experiment page is incomplete.");

let sampleFrames = false;
let previousFrameAt = performance.now();
let frameGaps: number[] = [];
function sampleFrame(now: number): void {
  if (sampleFrames) frameGaps.push(now - previousFrameAt);
  previousFrameAt = now;
  requestAnimationFrame(sampleFrame);
}
requestAnimationFrame(sampleFrame);

function beginFrameSampling(): void {
  frameGaps = [];
  previousFrameAt = performance.now();
  sampleFrames = true;
}

function finishFrameSampling(): number {
  sampleFrames = false;
  return Math.max(0, ...frameGaps);
}

function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function runWorker(): Promise<WorkerResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./perf.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.addEventListener(
      "message",
      (event: MessageEvent<WorkerResult>) => {
        worker.terminate();
        resolve(event.data);
      },
      { once: true },
    );
    worker.addEventListener(
      "error",
      (event) => {
        worker.terminate();
        reject(new Error(event.message));
      },
      { once: true },
    );
    worker.postMessage({ type: "run" });
  });
}

button.addEventListener("click", async () => {
  button.disabled = true;
  result.textContent = "Benchmark running…";
  try {
    beginFrameSampling();
    const mainStartedAt = performance.now();
    const mainThreadSimulation = runSimulationBenchmark();
    const mainThreadWallMs = performance.now() - mainStartedAt;
    await nextAnimationFrame();
    const mainThreadMaxFrameGapMs = finishFrameSampling();

    await new Promise((resolve) => setTimeout(resolve, 250));
    beginFrameSampling();
    const workerStartedAt = performance.now();
    const workerResult = await runWorker();
    const workerWallMs = performance.now() - workerStartedAt;
    await nextAnimationFrame();
    const workerMaxFrameGapMs = finishFrameSampling();

    const report: BenchmarkReport = {
      mainThread: {
        ...mainThreadSimulation,
        wallMs: mainThreadWallMs,
        maxFrameGapMs: mainThreadMaxFrameGapMs,
      },
      worker: {
        ...workerResult.simulation,
        wallMs: workerWallMs,
        workerExecutionMs: workerResult.workerExecutionMs,
        maxFrameGapMs: workerMaxFrameGapMs,
      },
      conclusion:
        workerMaxFrameGapMs < mainThreadMaxFrameGapMs
          ? "The Worker preserved page responsiveness for this 8-bot workload; keep the experiment there. The live game still simulates its local prediction on the main thread and authoritative rooms on the server."
          : "This run did not show a responsiveness improvement from the Worker; keep the workload on the main thread unless repeated profiles show otherwise.",
    };
    result.textContent = JSON.stringify(report, null, 2);
    window.dispatchEvent(
      new CustomEvent("benchmark-complete", { detail: report }),
    );
  } catch (error) {
    result.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    button.disabled = false;
  }
});
