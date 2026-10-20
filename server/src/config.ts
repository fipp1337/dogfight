import { z } from "zod";

const integer = (fallback: number, min: number, max: number) =>
  z.coerce.number().int().min(min).max(max).default(fallback);
const configSchema = z.object({
  PORT: integer(3000, 1, 65535),
  HOST: z.string().default("0.0.0.0"),
  LOG_DIR: z.string().default("logs"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  ALLOWED_ORIGINS: z
    .string()
    .default(
      "http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000,http://127.0.0.1:3000",
    ),
  MAX_CONNECTIONS_PER_IP: integer(8, 1, 1000),
  MAX_ROOMS: integer(50, 1, 10000),
  MAX_PLAYERS_PER_ROOM: integer(8, 1, 64),
  MAX_MESSAGES_PER_SECOND: integer(45, 5, 1000),
  VERSION: z.string().default("local"),
  NETWORK_LATENCY_MS: integer(0, 0, 2000),
  NETWORK_JITTER_MS: integer(0, 0, 2000),
  NETWORK_DROP_RATE: z.coerce.number().min(0).max(0.95).default(0),
  SNAPSHOT_FORMAT: z.enum(["binary", "json"]).default("binary"),
});

export interface ServerConfig {
  port: number;
  host: string;
  logDir: string;
  logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";
  allowedOrigins: Set<string>;
  maxConnectionsPerIp: number;
  maxRooms: number;
  maxPlayersPerRoom: number;
  maxMessagesPerSecond: number;
  version: string;
  networkLatencyMs: number;
  networkJitterMs: number;
  networkDropRate: number;
  snapshotFormat: "binary" | "json";
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const parsed = configSchema.parse(env);
  return {
    port: parsed.PORT,
    host: parsed.HOST,
    logDir: parsed.LOG_DIR,
    logLevel: parsed.LOG_LEVEL,
    allowedOrigins: new Set(
      parsed.ALLOWED_ORIGINS.split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
    maxConnectionsPerIp: parsed.MAX_CONNECTIONS_PER_IP,
    maxRooms: parsed.MAX_ROOMS,
    maxPlayersPerRoom: parsed.MAX_PLAYERS_PER_ROOM,
    maxMessagesPerSecond: parsed.MAX_MESSAGES_PER_SECOND,
    version: parsed.VERSION,
    networkLatencyMs: parsed.NETWORK_LATENCY_MS,
    networkJitterMs: parsed.NETWORK_JITTER_MS,
    networkDropRate: parsed.NETWORK_DROP_RATE,
    snapshotFormat: parsed.SNAPSHOT_FORMAT,
  };
}
