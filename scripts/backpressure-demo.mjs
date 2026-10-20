import { createWriteStream } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { performance } from "node:perf_hooks";
import { createReadStream } from "node:fs";

const megabytes = Math.max(8, Math.min(256, Number(process.env.LOG_MB ?? 200)));
const temporaryDirectory = await mkdtemp(
  path.join(tmpdir(), "dogfight-stream-"),
);
const logPath = path.join(temporaryDirectory, "large-match.ndjson");
const chunk = Buffer.from(
  `${JSON.stringify({ kind: "simulation", tick: 1, position: [250, 350], event: "step" })}\n`.repeat(
    700,
  ),
);
const targetBytes = megabytes * 1024 * 1024;
async function* records() {
  for (let written = 0; written < targetBytes; written += chunk.byteLength)
    yield chunk;
}
await pipeline(Readable.from(records()), createWriteStream(logPath));

const server = createServer(async (_request, response) => {
  response.writeHead(200, { "Content-Type": "application/x-ndjson" });
  try {
    await pipeline(createReadStream(logPath), response);
  } catch {
    response.destroy();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string")
  throw new Error("Could not open local stream test server.");
const rssSamples = [process.memoryUsage().rss];
let bytes = 0;
const sampleTimer = setInterval(
  () => rssSamples.push(process.memoryUsage().rss),
  100,
);
const started = performance.now();
try {
  const response = await fetch(`http://127.0.0.1:${address.port}/match`);
  if (!response.body) throw new Error("Missing streamed response body.");
  const slowSink = new Writable({
    highWaterMark: 16 * 1024,
    write(body, _encoding, callback) {
      bytes += body.byteLength;
      setTimeout(callback, 1);
    },
  });
  await pipeline(Readable.fromWeb(response.body), slowSink);
} finally {
  clearInterval(sampleTimer);
  await new Promise((resolve) => server.close(resolve));
}

const report = {
  fileBytes: bytes,
  requestedMegabytes: megabytes,
  elapsedSeconds: Number(((performance.now() - started) / 1000).toFixed(2)),
  rssStartBytes: rssSamples[0],
  rssPeakBytes: Math.max(...rssSamples),
  rssDeltaBytes: Math.max(...rssSamples) - rssSamples[0],
  samples: rssSamples.length,
  note: "Server streams with createReadStream + pipeline; the slow sink consumes chunks without buffering the whole replay.",
};
await writeFile(
  path.join(temporaryDirectory, "rss.csv"),
  `sample,rss_bytes\n${rssSamples.map((value, index) => `${index},${value}`).join("\n")}\n`,
);
await import("node:fs/promises").then(({ mkdir, copyFile }) =>
  mkdir("reports", { recursive: true }).then(() =>
    copyFile(
      path.join(temporaryDirectory, "rss.csv"),
      "reports/backpressure-rss.csv",
    ),
  ),
);
await writeFile(
  "reports/backpressure-summary.json",
  `${JSON.stringify(report, null, 2)}\n`,
);
const plotWidth = 800;
const plotHeight = 280;
const padding = 50;
const minimum = Math.min(...rssSamples);
const maximum = Math.max(...rssSamples);
const range = maximum - minimum || 1;
const points = rssSamples
  .map(
    (sample, index) =>
      `${padding + (index * (plotWidth - padding * 2)) / Math.max(1, rssSamples.length - 1)},${plotHeight - padding - ((sample - minimum) * (plotHeight - padding * 2)) / range}`,
  )
  .join(" ");
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${plotWidth}" height="${plotHeight}" viewBox="0 0 ${plotWidth} ${plotHeight}"><rect width="100%" height="100%" fill="#07111f"/><text x="${padding}" y="24" fill="#d9eaff" font-family="sans-serif" font-size="15">RSS while streaming ${megabytes} MiB NDJSON through a slow sink</text><path d="M${padding} ${padding} V${plotHeight - padding} H${plotWidth - padding}" fill="none" stroke="#607a98"/><polyline points="${points}" fill="none" stroke="#48d0b6" stroke-width="2"/><text x="${padding}" y="${plotHeight - 12}" fill="#9fb7d3" font-family="sans-serif" font-size="12">100 ms samples · start ${(minimum / 1024 / 1024).toFixed(1)} MiB · peak ${(maximum / 1024 / 1024).toFixed(1)} MiB</text></svg>`;
await writeFile("reports/backpressure-rss.svg", svg);
console.log(JSON.stringify(report, null, 2));
await rm(temporaryDirectory, { recursive: true, force: true });
