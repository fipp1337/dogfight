import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { WebSocket } from "ws";

const port = 3010;
const base = `http://127.0.0.1:${port}`;
const origin = base;
const logDir = path.join(os.tmpdir(), `dogfight-loadtest-${process.pid}`);
const server = spawn(process.execPath, ["server/dist/index.js"], {
  cwd: process.cwd(),
  stdio: "ignore",
  env: {
    ...process.env,
    PORT: String(port),
    HOST: "127.0.0.1",
    LOG_DIR: logDir,
    ALLOWED_ORIGINS: origin,
    MAX_CONNECTIONS_PER_IP: "256",
    MAX_ROOMS: "50",
    MAX_PLAYERS_PER_ROOM: "8",
  },
});
const sockets = new Set();

try {
  await waitForServer();
  const stages = [];
  for (const clientCount of [8, 32, 64, 128]) {
    const roomIds = await createRooms(clientCount, stages.length);
    const connected = [];
    for (let index = 0; index < clientCount; index += 1) {
      const socket = await joinRoom(roomIds[Math.floor(index / 8)], index);
      connected.push(socket);
    }
    sockets.clear();
    for (const socket of connected) sockets.add(socket);
    let sequence = 0;
    const sendInputs = setInterval(() => {
      sequence += 1;
      for (const socket of connected) {
        if (socket.readyState !== WebSocket.OPEN) continue;
        socket.send(
          JSON.stringify({
            type: "input",
            seq: sequence,
            tick: sequence,
            turn: (sequence % 3) - 1,
            thrust: sequence % 5 !== 0,
            fire: sequence % 18 === 0,
          }),
        );
      }
    }, 33);
    const samples = [];
    const until = Date.now() + 3000;
    while (Date.now() < until) {
      await wait(500);
      const response = await fetch(`${base}/metrics`);
      samples.push(await response.json());
    }
    clearInterval(sendInputs);
    const tickSamples = samples
      .map((sample) => sample.tickDurationP99Ms)
      .sort((a, b) => a - b);
    const rssSamples = samples
      .map((sample) => sample.rssBytes)
      .sort((a, b) => a - b);
    stages.push({
      clients: clientCount,
      rooms: roomIds.length,
      durationSeconds: 3,
      tickP99Ms: tickSamples.at(-1) ?? 0,
      tickP99MedianMs: tickSamples[Math.floor(tickSamples.length / 2)] ?? 0,
      rssBytes: rssSamples.at(-1) ?? 0,
      eventLoopUtilizationMax: Math.max(
        ...samples.map((sample) => sample.eventLoopUtilization),
      ),
      exceeded33ms: tickSamples.some((duration) => duration > 33),
      samples: samples.length,
    });
    await closeSockets(connected);
    sockets.clear();
    await wait(250);
  }
  const report = { host: base, testedAt: new Date().toISOString(), stages };
  await mkdir("reports", { recursive: true });
  await writeFile(
    path.resolve("reports/load-test.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  for (const socket of sockets) socket.terminate();
  server.kill("SIGTERM");
  if (server.exitCode === null)
    await new Promise((resolve) => server.once("exit", resolve));
}

async function waitForServer() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null)
      throw new Error(`Test server exited with ${server.exitCode}`);
    try {
      const response = await fetch(`${base}/health`);
      if (response.ok) return;
    } catch {
      /* server is still starting */
    }
    await wait(150);
  }
  throw new Error("Load-test server did not become healthy within 15 seconds.");
}

async function createRooms(clientCount, stageIndex) {
  const ids = [];
  for (let roomIndex = 0; roomIndex < clientCount / 8; roomIndex += 1) {
    const id = `load-${stageIndex}-${roomIndex}`;
    const response = await fetch(`${base}/api/rooms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id,
        name: `Load ${id}`,
        width: 1000,
        height: 700,
        seed: 100 + roomIndex,
        maxPlayers: 8,
      }),
    });
    if (!response.ok)
      throw new Error(
        `Could not create load room ${id}: HTTP ${response.status}`,
      );
    ids.push(id);
  }
  return ids;
}

async function joinRoom(roomId, index) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
    headers: { origin },
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () =>
        reject(new Error(`Load client ${index} timed out while connecting.`)),
      5000,
    );
    socket.once("open", () => {
      socket.send(
        JSON.stringify({
          type: "join",
          version: 1,
          roomId,
          name: `Bot ${index}`,
        }),
      );
    });
    socket.on("message", (bytes, isBinary) => {
      if (
        isBinary &&
        Buffer.isBuffer(bytes) &&
        bytes[0] === 1 &&
        bytes[1] === 1
      ) {
        clearTimeout(timeout);
        resolve();
        return;
      }
      if (!isBinary) {
        try {
          const message = JSON.parse(bytes.toString());
          if (message.type === "joined") {
            clearTimeout(timeout);
            resolve();
          } else if (message.type === "error")
            reject(new Error(message.message));
        } catch {
          reject(new Error("The server sent malformed JSON."));
        }
      }
    });
    socket.once("error", reject);
    socket.once("close", (code, reason) =>
      reject(
        new Error(
          `Load client ${index} closed before joining (${code}: ${reason}).`,
        ),
      ),
    );
  });
  return socket;
}

async function closeSockets(connected) {
  await Promise.all(
    connected.map(
      (socket) =>
        new Promise((resolve) => {
          if (socket.readyState === WebSocket.CLOSED) {
            resolve();
            return;
          }
          socket.once("close", resolve);
          socket.close(1000, "load stage complete");
        }),
    ),
  );
}
