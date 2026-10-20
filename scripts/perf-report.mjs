import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import {
  addPlayer,
  asSeq,
  asTick,
  createWorld,
  FIXED_DT,
  stepWorld,
} from "../shared/dist/index.js";

const arena = {
  id: "perf",
  name: "Performance",
  width: 1200,
  height: 760,
  seed: 1701,
  maxPlayers: 8,
};
const world = createWorld(arena);
const players = Array.from({ length: 8 }, (_, index) =>
  addPlayer(world, `bot-${index}`, `Bot ${index + 1}`),
);
const durations = [];
const memoryAtStart = process.memoryUsage();

for (let tick = 1; tick <= 900; tick += 1) {
  const commands = new Map(
    players.map((player, index) => [
      player.playerId,
      {
        seq: asSeq(tick),
        tick: asTick(world.tick),
        turn: ((Math.floor(tick / (index + 3)) + index) % 3) - 1,
        thrust: (tick + index * 7) % 5 !== 0,
        fire: (tick + index * 11) % 18 === 0,
      },
    ]),
  );
  const started = performance.now();
  stepWorld(world, commands, FIXED_DT);
  durations.push(performance.now() - started);
}

durations.sort((a, b) => a - b);
const percentile = (value) =>
  durations[
    Math.min(durations.length - 1, Math.floor(durations.length * value))
  ] ?? 0;
const report = {
  simulatedSeconds: 30,
  bots: players.length,
  steps: durations.length,
  entitiesAtEnd: world.entities.length,
  tickDurationMs: {
    p50: percentile(0.5),
    p95: percentile(0.95),
    p99: percentile(0.99),
    max: durations.at(-1) ?? 0,
  },
  memory: {
    rssAtStartBytes: memoryAtStart.rss,
    rssAtEndBytes: process.memoryUsage().rss,
    heapAtEndBytes: process.memoryUsage().heapUsed,
  },
  note: "Offline deterministic simulation benchmark; timing is not a browser frame profile.",
};
await mkdir("reports", { recursive: true });
await writeFile(
  path.resolve("reports/performance.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(JSON.stringify(report, null, 2));
