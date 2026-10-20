import { runSimulationBenchmark } from "./perf-core.js";

interface WorkerScope {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage(message: unknown): void;
}

// Vite builds this module as a Web Worker; the client package's main lib is DOM-only.
const workerScope = globalThis as unknown as WorkerScope;
workerScope.onmessage = () => {
  const startedAt = performance.now();
  const simulation = runSimulationBenchmark();
  workerScope.postMessage({
    simulation,
    workerExecutionMs: performance.now() - startedAt,
  });
};
