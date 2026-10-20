import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";

const base = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const manifestResponse = await fetch(new URL("/assets/manifest.json", base));
if (!manifestResponse.ok)
  throw new Error(`Manifest request failed: HTTP ${manifestResponse.status}`);
const manifest = await manifestResponse.json();
const assets = [...manifest.sprites, ...manifest.sounds, ...manifest.data];
const run = async (asset) => {
  const response = await fetch(new URL(asset.url, base));
  if (!response.ok) throw new Error(`${asset.id}: HTTP ${response.status}`);
  const bytes = await response.arrayBuffer();
  return { id: asset.id, bytes: bytes.byteLength };
};
const measure = async (mode) => {
  const start = performance.now();
  const loaded =
    mode === "sequential"
      ? await sequential()
      : await Promise.all(assets.map(run));
  return {
    mode,
    elapsedMs: Number((performance.now() - start).toFixed(2)),
    totalBytes: loaded.reduce((sum, item) => sum + item.bytes, 0),
    files: loaded.length,
  };
};
async function sequential() {
  const result = [];
  for (const asset of assets) result.push(await run(asset));
  return result;
}
const report = {
  base,
  measuredAt: new Date().toISOString(),
  sequential: await measure("sequential"),
  concurrent: await measure("concurrent"),
};
report.speedup = Number(
  (report.sequential.elapsedMs / report.concurrent.elapsedMs).toFixed(2),
);
await mkdir("reports", { recursive: true });
await writeFile(
  path.resolve("reports/assets-timing.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(JSON.stringify(report, null, 2));
