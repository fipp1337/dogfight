import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  addPlayer,
  createWorld,
  encodeSnapshot,
} from "../shared/dist/index.js";

const arena = {
  id: "bytes",
  name: "Binary vs JSON",
  width: 1000,
  height: 700,
  seed: 5,
  maxPlayers: 8,
};
const world = createWorld(arena);
const player = addPlayer(world, "bench-player", "Bench");
const snapshot = {
  tick: world.tick,
  score: world.score,
  localEntityId: player.entityId,
  lastProcessedSeq: 0,
  randomState: world.randomState,
  nextEntityId: world.nextEntityId,
  entities: world.entities,
};
const jsonBytes = Buffer.byteLength(JSON.stringify(snapshot));
const binaryBytes = encodeSnapshot(snapshot).byteLength;
const report = {
  entities: snapshot.entities.length,
  jsonBytes,
  binaryBytes,
  savingsPercent: Number(((1 - binaryBytes / jsonBytes) * 100).toFixed(1)),
  format: "version 1, little-endian, 28-byte header, 39 bytes per entity",
};
await mkdir("reports", { recursive: true });
await writeFile(
  path.resolve("reports/protocol-size.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(JSON.stringify(report, null, 2));
