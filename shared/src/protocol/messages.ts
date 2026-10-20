import { z } from "zod";
import {
  asSeq,
  asTick,
  type ArenaConfig,
  type InputCommand,
} from "../sim/types.js";
import { snapshotSchema } from "./codec.js";

export const PROTOCOL_VERSION = 1;
const nameSchema = z.string().trim().min(1).max(20);
const roomIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[\w-]+$/);
const arenaSchema = z.object({
  id: roomIdSchema,
  name: z.string().min(1).max(40),
  width: z.number().int().min(480).max(2400),
  height: z.number().int().min(360).max(1600),
  seed: z.number().int().nonnegative().max(0xffffffff),
  maxPlayers: z.number().int().min(1).max(64),
});

export const clientMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("join"),
    version: z.literal(PROTOCOL_VERSION),
    roomId: roomIdSchema,
    name: nameSchema,
  }),
  z.object({
    type: z.literal("chat"),
    text: z.string().trim().min(1).max(240),
  }),
  z.object({
    type: z.literal("input"),
    seq: z.number().int().nonnegative().max(0xffffffff),
    tick: z.number().int().nonnegative().max(0xffffffff),
    turn: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
    thrust: z.boolean(),
    fire: z.boolean(),
  }),
  z.object({ type: z.literal("ping"), at: z.number().finite() }),
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;
export type ServerMessage =
  | {
      type: "joined";
      version: number;
      room: ArenaConfig;
      playerId: string;
      entityId: number;
      tick: number;
      seed: number;
    }
  | {
      type: "roster";
      players: Array<{ id: string; name: string; entityId: number }>;
    }
  | { type: "chat"; id: string; name: string; text: string; at: number }
  | { type: "pong"; at: number }
  | { type: "snapshot"; snapshot: import("../sim/types.js").GameSnapshot }
  | { type: "error"; message: string }
  | { type: "shutdown"; message: string };

export const serverMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("joined"),
    version: z.literal(PROTOCOL_VERSION),
    room: arenaSchema,
    playerId: z.string().uuid(),
    entityId: z.number().int().nonnegative(),
    tick: z.number().int().nonnegative(),
    seed: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal("roster"),
    players: z.array(
      z.object({
        id: z.string().uuid(),
        name: nameSchema,
        entityId: z.number().int().nonnegative(),
      }),
    ),
  }),
  z.object({
    type: z.literal("chat"),
    id: z.string().uuid(),
    name: nameSchema,
    text: z.string().max(240),
    at: z.number().finite(),
  }),
  z.object({ type: z.literal("pong"), at: z.number().finite() }),
  z.object({ type: z.literal("snapshot"), snapshot: snapshotSchema }),
  z.object({ type: z.literal("error"), message: z.string().max(240) }),
  z.object({ type: z.literal("shutdown"), message: z.string().max(240) }),
]);

export type ParsedServerMessage = z.infer<typeof serverMessageSchema>;

export type ParseResult<T> =
  { success: true; data: T } | { success: false; error: z.ZodError };

export function parseClientMessage(input: unknown): ParseResult<ClientMessage> {
  const result = clientMessageSchema.safeParse(input);
  return result.success
    ? { success: true, data: result.data }
    : { success: false, error: result.error };
}

export function parseServerMessage(
  input: unknown,
): ParseResult<ParsedServerMessage> {
  const result = serverMessageSchema.safeParse(input);
  return result.success
    ? { success: true, data: result.data }
    : { success: false, error: result.error };
}

export function inputFromMessage(
  message: Extract<ClientMessage, { type: "input" }>,
): InputCommand {
  return {
    seq: asSeq(message.seq),
    tick: asTick(message.tick),
    turn: message.turn,
    thrust: message.thrust,
    fire: message.fire,
  };
}
