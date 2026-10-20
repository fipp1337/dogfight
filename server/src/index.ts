import { createReadStream } from "node:fs";
import { mkdir, readdir, stat } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { pipeline } from "node:stream/promises";
import pino from "pino";
import { WebSocket, WebSocketServer } from "ws";
import { z } from "zod";
import {
  decodeInput,
  inputFromMessage,
  parseClientMessage,
  type ServerMessage,
} from "@dogfight/shared";
import { readConfig } from "./config.js";
import { RoomManager, type PlayerSession } from "./rooms.js";
import { startRoomLog, type RoomLogHandle } from "./log/matchlog.js";

const config = readConfig();
const logger = pino({ level: config.logLevel });
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const clientDist = path.join(root, "client", "dist");
const logDirectory = path.resolve(root, config.logDir);
const roomManager = new RoomManager(config, logger);
const httpServer = createServer((request, response) => {
  void handleHttp(request, response);
});
const webSockets = new WebSocketServer({
  noServer: true,
  maxPayload: 64 * 1024,
  perMessageDeflate: false,
});
const activeSockets = new Set<WebSocket>();
const socketsByIp = new Map<string, number>();
const roomLogs = new Map<string, RoomLogHandle>();
const rejectionCounts = new Map<string, number>();
const metricCounters = {
  messagesIn: 0,
  messagesOut: 0,
  bytesIn: 0,
  bytesOut: 0,
  lastMessagesIn: 0,
  lastMessagesOut: 0,
  lastBytesIn: 0,
  lastBytesOut: 0,
  inPerSecond: 0,
  outPerSecond: 0,
  bytesInPerSecond: 0,
  bytesOutPerSecond: 0,
};
const jsonRoomSchema = z
  .object({
    id: z
      .string()
      .trim()
      .min(1)
      .max(40)
      .regex(/^[\w-]+$/),
    name: z.string().trim().min(1).max(40),
    width: z.number().int().min(480).max(2400).default(1000),
    height: z.number().int().min(360).max(1600).default(700),
    seed: z.number().int().nonnegative().max(0xffffffff).default(1),
    maxPlayers: z
      .number()
      .int()
      .min(1)
      .max(config.maxPlayersPerRoom)
      .default(config.maxPlayersPerRoom),
  })
  .strict();

let isShuttingDown = false;
let lastElu = performance.eventLoopUtilization();

function reject(reason: string, fields: Record<string, unknown> = {}): void {
  rejectionCounts.set(reason, (rejectionCounts.get(reason) ?? 0) + 1);
  logger.warn({ reason, ...fields }, "request rejected");
}

function sendJson(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState !== WebSocket.OPEN) return;
  const payload = JSON.stringify(message);
  metricCounters.messagesOut += 1;
  metricCounters.bytesOut += Buffer.byteLength(payload);
  socket.send(payload, (error) => {
    if (error) logger.warn({ err: error }, "websocket send failed");
  });
}

async function ensureRoomLog(roomId: string): Promise<void> {
  if (roomLogs.has(roomId)) return;
  const room = roomManager.getOrCreate(roomId);
  room.on("traffic", (bytes) => {
    metricCounters.messagesOut += 1;
    metricCounters.bytesOut += bytes;
  });
  const handle = await startRoomLog(room, logDirectory, logger);
  roomLogs.set(roomId, handle);
  room.once("empty", () => {
    void handle.close();
    roomLogs.delete(roomId);
  });
}

async function handleHttp(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const url = new URL(
    request.url ?? "/",
    `http://${request.headers.host ?? "localhost"}`,
  );
  if (request.method === "GET" && url.pathname === "/health")
    return json(response, 200, {
      status: "ok",
      version: config.version,
      uptime: process.uptime(),
    });
  if (request.method === "GET" && url.pathname === "/ready")
    return json(response, isShuttingDown ? 503 : 200, {
      ready: !isShuttingDown,
      version: config.version,
    });
  if (request.method === "GET" && url.pathname === "/metrics")
    return json(response, 200, buildMetrics());
  if (request.method === "GET" && url.pathname === "/api/rooms")
    return json(response, 200, { rooms: roomManager.list() });
  if (request.method === "POST" && url.pathname === "/api/rooms") {
    try {
      const input = await readJson(request, 4096);
      const parsed = jsonRoomSchema.safeParse(input);
      if (!parsed.success)
        return json(response, 400, { error: "invalid room configuration" });
      const room = roomManager.create(parsed.data);
      return json(response, 201, {
        room: { ...room, players: 0, running: false },
      });
    } catch (error) {
      return json(response, error instanceof PayloadTooLarge ? 413 : 400, {
        error: error instanceof Error ? error.message : "invalid request",
      });
    }
  }
  if (request.method === "GET" && url.pathname === "/api/replays") {
    const files = await readdir(logDirectory).catch(() => []);
    return json(response, 200, {
      replays: files.filter((file) => file.endsWith(".ndjson")),
    });
  }
  if (request.method === "GET" && url.pathname.startsWith("/api/replays/")) {
    const fileName = decodeURIComponent(
      url.pathname.slice("/api/replays/".length),
    );
    if (!/^[\w-]+\.ndjson$/.test(fileName))
      return json(response, 400, { error: "invalid replay id" });
    const filePath = path.join(logDirectory, fileName);
    try {
      await stat(filePath);
    } catch {
      return json(response, 404, { error: "replay not found" });
    }
    response.writeHead(200, {
      "Content-Type": "application/x-ndjson",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    });
    try {
      await pipeline(createReadStream(filePath), response);
    } catch (error) {
      logger.warn(
        { err: error, replay: fileName },
        "replay stream ended early",
      );
      response.destroy(error instanceof Error ? error : undefined);
    }
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/slow") {
    const started = performance.now();
    while (performance.now() - started < 300) {
      /* deliberate event-loop blocking demo */
    }
    return json(response, 200, {
      blockedMs: Math.round(performance.now() - started),
    });
  }
  if (request.method === "GET" || request.method === "HEAD")
    return serveStatic(url.pathname, response, request.method === "HEAD");
  json(response, 405, { error: "method not allowed" });
}

async function serveStatic(
  urlPath: string,
  response: ServerResponse,
  headOnly: boolean,
): Promise<void> {
  let pathname: string;
  try {
    pathname = decodeURIComponent(urlPath);
  } catch {
    return json(response, 400, { error: "invalid URL encoding" });
  }
  const relative =
    pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = path.resolve(clientDist, relative);
  if (
    !filePath.startsWith(`${clientDist}${path.sep}`) &&
    filePath !== path.join(clientDist, "index.html")
  )
    return json(response, 403, { error: "path traversal blocked" });
  let candidate = filePath;
  try {
    if ((await stat(candidate)).isDirectory())
      candidate = path.join(candidate, "index.html");
  } catch {
    if (!path.extname(relative))
      candidate = path.join(clientDist, "index.html");
    else return json(response, 404, { error: "not found" });
  }
  try {
    const info = await stat(candidate);
    if (!info.isFile()) return json(response, 404, { error: "not found" });
    const type = mimeType(candidate);
    response.writeHead(200, {
      "Content-Type": type,
      "Content-Length": info.size,
      "Cache-Control": candidate.endsWith("index.html")
        ? "no-cache"
        : "public, max-age=31536000, immutable",
    });
    if (headOnly) response.end();
    else await pipeline(createReadStream(candidate), response);
  } catch (error) {
    if (!response.headersSent) json(response, 404, { error: "not found" });
    else response.destroy(error instanceof Error ? error : undefined);
  }
}

function mimeType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  const types: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".webp": "image/webp",
    ".wav": "audio/wav",
    ".ico": "image/x-icon",
    ".webmanifest": "application/manifest+json",
    ".wasm": "application/wasm",
  };
  return types[extension] ?? "application/octet-stream";
}

function json(response: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  response.end(body);
}

class PayloadTooLarge extends Error {}
async function readJson(
  request: IncomingMessage,
  maxBytes: number,
): Promise<unknown> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += data.byteLength;
    if (length > maxBytes) throw new PayloadTooLarge("request body too large");
    chunks.push(data);
  }
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  return parsed;
}

function buildMetrics(): Record<string, unknown> {
  const utilization = performance.eventLoopUtilization(lastElu);
  lastElu = performance.eventLoopUtilization();
  const rooms = [...roomManager.allRooms()];
  const durations = rooms
    .flatMap((room) => (room.p99TickMs ? [room.p99TickMs] : []))
    .sort((a, b) => a - b);
  return {
    version: config.version,
    players: roomManager.playerCount,
    rooms: roomManager.roomCount,
    messagesPerSecond: {
      in: metricCounters.inPerSecond,
      out: metricCounters.outPerSecond,
    },
    bytesPerSecond: {
      in: metricCounters.bytesInPerSecond,
      out: metricCounters.bytesOutPerSecond,
    },
    tickDurationP99Ms: durations.length
      ? (durations[Math.floor(durations.length * 0.99)] ?? 0)
      : 0,
    eventLoopUtilization: utilization.utilization,
    rssBytes: process.memoryUsage().rss,
    rejectedConnectionsByReason: Object.fromEntries(rejectionCounts),
    activeConnections: activeSockets.size,
  };
}

function rejectUpgrade(
  socket: import("node:stream").Duplex,
  status: number,
  message: string,
): void {
  socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

httpServer.on("upgrade", (request, socket, head) => {
  const url = new URL(
    request.url ?? "/",
    `http://${request.headers.host ?? "localhost"}`,
  );
  if (url.pathname !== "/ws") return rejectUpgrade(socket, 404, "Not Found");
  const origin = request.headers.origin;
  if (
    config.allowedOrigins.size &&
    (!origin || !config.allowedOrigins.has(origin))
  ) {
    reject("origin", { origin });
    return rejectUpgrade(socket, 403, "Forbidden");
  }
  const ip = request.socket.remoteAddress ?? "unknown";
  if ((socketsByIp.get(ip) ?? 0) >= config.maxConnectionsPerIp) {
    reject("per_ip_connection_cap", { ip });
    return rejectUpgrade(socket, 429, "Too Many Connections");
  }
  webSockets.handleUpgrade(request, socket, head, (client) =>
    webSockets.emit("connection", client, request),
  );
});

webSockets.on("connection", (socket, request) => {
  const ip = request.socket.remoteAddress ?? "unknown";
  socketsByIp.set(ip, (socketsByIp.get(ip) ?? 0) + 1);
  activeSockets.add(socket);
  const playerId = randomUUID();
  let player: PlayerSession | undefined;
  let roomId: string | undefined;
  let joined = false;
  let tokenBalance = config.maxMessagesPerSecond;
  let tokenUpdatedAt = performance.now();
  const joinTimeout = setTimeout(() => {
    if (!joined) {
      reject("join_timeout", { ip });
      socket.close(1008, "join required within 5 seconds");
    }
  }, 5000);
  socket.on("error", (error) =>
    logger.warn({ err: error, playerId, roomId }, "websocket error"),
  );
  socket.on("pong", () => {
    missedPongBySocket.set(socket, 0);
  });
  socket.on("message", (data, isBinary) => {
    metricCounters.messagesIn += 1;
    metricCounters.bytesIn += Buffer.isBuffer(data)
      ? data.byteLength
      : Buffer.byteLength(data.toString());
    const now = performance.now();
    tokenBalance = Math.min(
      config.maxMessagesPerSecond,
      tokenBalance +
        ((now - tokenUpdatedAt) * config.maxMessagesPerSecond) / 1000,
    );
    tokenUpdatedAt = now;
    if (tokenBalance < 1) {
      reject("message_rate", { playerId, roomId });
      socket.close(1008, "message rate exceeded");
      return;
    }
    tokenBalance -= 1;
    let raw: unknown;
    try {
      if (isBinary) {
        const bytes = Buffer.isBuffer(data)
          ? data
          : Array.isArray(data)
            ? Buffer.concat(data)
            : Buffer.from(data);
        const input = decodeInput(bytes);
        raw = {
          type: "input",
          seq: input.seq,
          tick: input.tick,
          turn: input.turn,
          thrust: input.thrust,
          fire: input.fire,
        };
      } else raw = JSON.parse(data.toString());
    } catch (error) {
      reject(isBinary ? "invalid_binary_input" : "invalid_json", {
        playerId,
        roomId,
      });
      socket.close(
        isBinary ? 1003 : 1007,
        error instanceof Error ? error.message : "invalid message encoding",
      );
      return;
    }
    const parsed = parseClientMessage(raw);
    if (!parsed.success) {
      reject("invalid_message", {
        playerId,
        roomId,
        issues: parsed.error.issues.length,
      });
      socket.close(1008, "invalid message");
      return;
    }
    const message = parsed.data;
    if (!joined) {
      if (message.type !== "join") {
        socket.close(1008, "join must be the first message");
        return;
      }
      void (async () => {
        try {
          await ensureRoomLog(message.roomId);
          const room = roomManager.getOrCreate(message.roomId);
          player = room.join(playerId, message.name, socket);
          roomId = room.id;
          joined = true;
          clearTimeout(joinTimeout);
          sendJson(socket, {
            type: "joined",
            version: 1,
            room: room.config,
            playerId,
            entityId: player.shipId,
            tick: room.world.tick,
            seed: room.config.seed,
          });
          logger.info(
            { roomId, playerId, name: player.name },
            "player joined room",
          );
        } catch (error) {
          reject("join_failed", { playerId, roomId: message.roomId });
          sendJson(socket, {
            type: "error",
            message:
              error instanceof Error ? error.message : "could not join room",
          });
          socket.close(1008, "join failed");
        }
      })();
      return;
    }
    const room = roomId ? roomManager.get(roomId) : undefined;
    if (!room || !player) return socket.close(1008, "room no longer exists");
    switch (message.type) {
      case "join":
        socket.close(1008, "already joined");
        break;
      case "chat":
        room.chat(playerId, message.text);
        break;
      case "input":
        if (Math.random() < config.networkDropRate) break;
        {
          const input = inputFromMessage(message);
          const delay = Math.max(
            0,
            config.networkLatencyMs +
              (Math.random() * 2 - 1) * config.networkJitterMs,
          );
          const apply = (): void => {
            if (!room.acceptInput(playerId, input)) {
              reject("invalid_input_sequence", { playerId, roomId });
              socket.close(1008, "invalid input sequence");
            }
          };
          if (delay > 0) setTimeout(apply, delay);
          else apply();
        }
        break;
      case "ping":
        sendJson(socket, { type: "pong", at: message.at });
        break;
      default:
        assertNever(message);
    }
  });
  socket.on("close", () => {
    clearTimeout(joinTimeout);
    activeSockets.delete(socket);
    const remaining = Math.max(0, (socketsByIp.get(ip) ?? 1) - 1);
    if (remaining === 0) socketsByIp.delete(ip);
    else socketsByIp.set(ip, remaining);
    if (roomId) roomManager.get(roomId)?.leave(playerId);
  });
});

function assertNever(value: never): never {
  throw new Error(`unhandled client message: ${String(value)}`);
}

const missedPongBySocket = new WeakMap<WebSocket, number>();
const heartbeat = setInterval(() => {
  for (const socket of activeSockets) {
    if (socket.readyState !== WebSocket.OPEN) continue;
    missedPongBySocket.set(socket, (missedPongBySocket.get(socket) ?? 0) + 1);
    const missed = missedPongBySocket.get(socket) ?? 0;
    if (missed >= 2) {
      reject("heartbeat_timeout");
      socket.terminate();
      continue;
    }
    socket.ping();
  }
}, 15_000);
webSockets.on("error", (error) =>
  logger.error({ err: error }, "websocket server error"),
);

setInterval(() => {
  metricCounters.inPerSecond =
    metricCounters.messagesIn - metricCounters.lastMessagesIn;
  metricCounters.outPerSecond =
    metricCounters.messagesOut - metricCounters.lastMessagesOut;
  metricCounters.bytesInPerSecond =
    metricCounters.bytesIn - metricCounters.lastBytesIn;
  metricCounters.bytesOutPerSecond =
    metricCounters.bytesOut - metricCounters.lastBytesOut;
  metricCounters.lastMessagesIn = metricCounters.messagesIn;
  metricCounters.lastMessagesOut = metricCounters.messagesOut;
  metricCounters.lastBytesIn = metricCounters.bytesIn;
  metricCounters.lastBytesOut = metricCounters.bytesOut;
}, 1000).unref();

function shutdown(signal: NodeJS.Signals): void {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.info({ signal }, "graceful shutdown started");
  clearInterval(heartbeat);
  roomManager.closeAll();
  for (const socket of activeSockets) {
    sendJson(socket, {
      type: "shutdown",
      message: "Server is restarting; please reconnect.",
    });
    socket.close(1001, "server shutdown");
  }
  const hardStop = setTimeout(() => {
    logger.fatal("shutdown deadline reached");
    process.exit(1);
  }, 9000);
  hardStop.unref();
  const httpClosed = new Promise<void>((resolve) =>
    httpServer.close(() => {
      logger.info("HTTP server closed");
      resolve();
    }),
  );
  const websocketClosed = new Promise<void>((resolve, rejectPromise) =>
    webSockets.close((error) => (error ? rejectPromise(error) : resolve())),
  );
  const logsClosed = Promise.all(
    [...roomLogs.values()].map((handle) => handle.close()),
  );
  void Promise.all([httpClosed, websocketClosed, logsClosed])
    .then(() => new Promise<void>((resolve) => logger.flush(() => resolve())))
    .then(() => {
      clearTimeout(hardStop);
      process.exitCode = 0;
    })
    .catch((error: unknown) => {
      logger.error({ err: error }, "graceful shutdown cleanup failed");
      process.exitCode = 1;
    });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("uncaughtException", (error) => {
  logger.fatal({ err: error }, "uncaught exception");
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  logger.fatal({ err: reason }, "unhandled rejection");
  process.exit(1);
});

await mkdir(logDirectory, { recursive: true });
httpServer.listen(config.port, config.host, () =>
  logger.info(
    { host: config.host, port: config.port, version: config.version },
    "dogfight server listening",
  ),
);
