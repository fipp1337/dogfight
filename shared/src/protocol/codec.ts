import {
  asEntityId,
  asSeq,
  asTick,
  type EntityState,
  type GameSnapshot,
  type InputCommand,
} from "../sim/types.js";
import { z } from "zod";

export const SNAPSHOT_VERSION = 1;
export const SNAPSHOT_HEADER_BYTES = 28;
export const SNAPSHOT_ENTITY_BYTES = 39;
export const INPUT_FRAME_BYTES = 12;

const kindToCode: Record<EntityState["kind"], number> = {
  ship: 1,
  bullet: 2,
  asteroid: 3,
  pickup: 4,
  explosion: 5,
};
const codeToKind = new Map<number, EntityState["kind"]>([
  [1, "ship"],
  [2, "bullet"],
  [3, "asteroid"],
  [4, "pickup"],
  [5, "explosion"],
]);
const baseEntitySchema = z.object({
  id: z.number().int().nonnegative(),
  x: z.number().finite(),
  y: z.number().finite(),
  vx: z.number().finite(),
  vy: z.number().finite(),
  angle: z.number().finite(),
  radius: z.number().finite().nonnegative(),
});
const entitySchema = z.discriminatedUnion("kind", [
  baseEntitySchema.extend({
    kind: z.literal("ship"),
    playerId: z.string(),
    name: z.string(),
    hp: z.number().int().min(0).max(100),
    cooldownTicks: z.number().int().nonnegative(),
    respawnTicks: z.number().int().nonnegative(),
    invulnerableTicks: z.number().int().nonnegative(),
    shieldTicks: z.number().int().nonnegative(),
    rapidTicks: z.number().int().nonnegative(),
    thrusting: z.boolean(),
  }),
  baseEntitySchema.extend({
    kind: z.literal("bullet"),
    ownerId: z.number().int().nonnegative(),
    ttlTicks: z.number().int().nonnegative(),
    damage: z.number().int().nonnegative(),
    homingTargetId: z.number().int().nonnegative().nullable(),
  }),
  baseEntitySchema.extend({
    kind: z.literal("asteroid"),
    hp: z.number().int().nonnegative(),
    spin: z.number().finite(),
    homingTargetId: z.number().int().nonnegative().nullable(),
  }),
  baseEntitySchema.extend({
    kind: z.literal("pickup"),
    pickupType: z.enum(["shield", "rapid"]),
    ttlTicks: z.number().int().nonnegative(),
  }),
  baseEntitySchema.extend({
    kind: z.literal("explosion"),
    ttlTicks: z.number().int().nonnegative(),
    particles: z.array(
      z.object({
        x: z.number().finite(),
        y: z.number().finite(),
        vx: z.number().finite(),
        vy: z.number().finite(),
      }),
    ),
  }),
]);
export const snapshotSchema = z.object({
  tick: z.number().int().min(0).max(0xffffffff),
  score: z.number().int().min(0).max(0xffffffff),
  localEntityId: z.number().int().min(0).max(0xffffffff),
  lastProcessedSeq: z.number().int().min(0).max(0xffffffff),
  randomState: z.number().int().min(0).max(0xffffffff),
  nextEntityId: z.number().int().min(1).max(0xffffffff),
  entities: z.array(entitySchema).max(512),
});

export interface SnapshotCodec {
  encode(snapshot: GameSnapshot): ArrayBuffer;
  decode(buffer: ArrayBuffer): GameSnapshot;
}

export const binaryCodec: SnapshotCodec = {
  encode: encodeSnapshot,
  decode: decodeSnapshot,
};
export const jsonCodec: SnapshotCodec = {
  encode(snapshot) {
    const bytes = new TextEncoder().encode(JSON.stringify(snapshot));
    return bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    );
  },
  decode(buffer) {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(buffer));
    return validateSnapshot(parsed);
  },
};

export function encodeInput(input: InputCommand): ArrayBuffer {
  if (
    !Number.isInteger(input.seq) ||
    input.seq < 0 ||
    input.seq > 0xffffffff ||
    !Number.isInteger(input.tick) ||
    input.tick < 0 ||
    input.tick > 0xffffffff ||
    ![-1, 0, 1].includes(input.turn)
  )
    throw new RangeError("input fields are out of range");
  const buffer = new ArrayBuffer(INPUT_FRAME_BYTES);
  const view = new DataView(buffer);
  view.setUint8(0, SNAPSHOT_VERSION);
  view.setUint8(1, 2);
  view.setUint32(2, input.seq, true);
  view.setUint32(6, input.tick, true);
  view.setInt8(10, input.turn);
  view.setUint8(11, Number(input.thrust) | (Number(input.fire) << 1));
  return buffer;
}

export function decodeInput(buffer: ArrayBuffer | Uint8Array): InputCommand {
  const view =
    buffer instanceof ArrayBuffer
      ? new DataView(buffer)
      : new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  if (view.byteLength !== INPUT_FRAME_BYTES)
    throw new RangeError("input frame has an invalid length");
  if (view.getUint8(0) !== SNAPSHOT_VERSION || view.getUint8(1) !== 2)
    throw new Error("unsupported input frame version or type");
  const turn = view.getInt8(10);
  const flags = view.getUint8(11);
  if (![-1, 0, 1].includes(turn) || flags & ~3)
    throw new RangeError("input frame contains invalid fields");
  return {
    seq: asSeq(view.getUint32(2, true)),
    tick: asTick(view.getUint32(6, true)),
    turn: readTurn(turn),
    thrust: Boolean(flags & 1),
    fire: Boolean(flags & 2),
  };
}

export function encodeSnapshot(snapshot: GameSnapshot): ArrayBuffer {
  if (snapshot.entities.length > 512)
    throw new RangeError("snapshot has too many entities");
  snapshotSchema.parse(snapshot);
  const buffer = new ArrayBuffer(
    SNAPSHOT_HEADER_BYTES + snapshot.entities.length * SNAPSHOT_ENTITY_BYTES,
  );
  const view = new DataView(buffer);
  view.setUint8(0, SNAPSHOT_VERSION);
  view.setUint8(1, 1);
  view.setUint32(2, snapshot.tick, true);
  view.setUint32(6, snapshot.score, true);
  view.setUint32(10, snapshot.localEntityId, true);
  view.setUint32(14, snapshot.lastProcessedSeq, true);
  view.setUint16(18, snapshot.entities.length, true);
  view.setUint32(20, snapshot.randomState, true);
  view.setUint32(24, snapshot.nextEntityId, true);
  let offset = SNAPSHOT_HEADER_BYTES;
  for (const entity of snapshot.entities) {
    view.setUint32(offset, entity.id, true);
    offset += 4;
    view.setUint8(offset, kindToCode[entity.kind]);
    offset += 1;
    view.setFloat32(offset, entity.x, true);
    offset += 4;
    view.setFloat32(offset, entity.y, true);
    offset += 4;
    view.setFloat32(offset, entity.vx, true);
    offset += 4;
    view.setFloat32(offset, entity.vy, true);
    offset += 4;
    view.setInt16(offset, quantizeAngle(entity.angle), true);
    offset += 2;
    view.setUint16(offset, clampInt(entity.radius, 0, 65535), true);
    offset += 2;
    view.setUint8(
      offset,
      entity.kind === "ship" || entity.kind === "asteroid"
        ? clampInt(entity.hp, 0, 255)
        : 0,
    );
    offset += 1;
    view.setUint32(offset, entity.kind === "bullet" ? entity.ownerId : 0, true);
    offset += 4;
    view.setUint16(
      offset,
      entity.kind === "bullet" ||
        entity.kind === "pickup" ||
        entity.kind === "explosion"
        ? clampInt(entity.ttlTicks, 0, 65535)
        : entity.kind === "ship"
          ? clampInt(entity.cooldownTicks, 0, 65535)
          : 0,
      true,
    );
    offset += 2;
    view.setUint16(
      offset,
      entity.kind === "ship" ? clampInt(entity.respawnTicks, 0, 65535) : 0,
      true,
    );
    offset += 2;
    view.setUint8(offset, flags(entity));
    offset += 1;
    view.setUint32(
      offset,
      entity.kind === "bullet" || entity.kind === "asteroid"
        ? (entity.homingTargetId ?? 0)
        : 0,
      true,
    );
    offset += 4;
  }
  return buffer;
}

export function decodeSnapshot(buffer: ArrayBuffer): GameSnapshot {
  if (buffer.byteLength < SNAPSHOT_HEADER_BYTES)
    throw new RangeError("snapshot header is truncated");
  const view = new DataView(buffer);
  if (view.getUint8(0) !== SNAPSHOT_VERSION || view.getUint8(1) !== 1)
    throw new Error("unsupported snapshot version or type");
  const count = view.getUint16(18, true);
  if (
    count > 512 ||
    buffer.byteLength !== SNAPSHOT_HEADER_BYTES + count * SNAPSHOT_ENTITY_BYTES
  )
    throw new RangeError("snapshot length does not match entity count");
  const entities: EntityState[] = [];
  let offset = SNAPSHOT_HEADER_BYTES;
  for (let i = 0; i < count; i += 1) {
    const id = asEntityId(view.getUint32(offset, true));
    offset += 4;
    const kindCode = view.getUint8(offset);
    offset += 1;
    const kind = codeToKind.get(kindCode);
    if (!kind) throw new Error(`unknown entity kind ${kindCode}`);
    const x = view.getFloat32(offset, true);
    offset += 4;
    const y = view.getFloat32(offset, true);
    offset += 4;
    const vx = view.getFloat32(offset, true);
    offset += 4;
    const vy = view.getFloat32(offset, true);
    offset += 4;
    const angle = view.getInt16(offset, true) / 10000;
    offset += 2;
    const radius = view.getUint16(offset, true);
    offset += 2;
    const hp = view.getUint8(offset);
    offset += 1;
    const ownerId = asEntityId(view.getUint32(offset, true));
    offset += 4;
    const lifetime = view.getUint16(offset, true);
    offset += 2;
    const respawnTicks = view.getUint16(offset, true);
    offset += 2;
    const flagsValue = view.getUint8(offset);
    offset += 1;
    const targetId = view.getUint32(offset, true);
    offset += 4;
    if (![x, y, vx, vy, angle, radius].every(Number.isFinite))
      throw new RangeError("snapshot contains non-finite fields");
    const base = { id, x, y, vx, vy, angle, radius };
    if (kind === "ship")
      entities.push({
        ...base,
        kind,
        playerId: `entity-${id}`,
        name: "Pilot",
        hp,
        cooldownTicks: lifetime,
        respawnTicks,
        invulnerableTicks: flagsValue & 8 ? 1 : 0,
        shieldTicks: flagsValue & 2 ? 1 : 0,
        rapidTicks: flagsValue & 4 ? 1 : 0,
        thrusting: Boolean(flagsValue & 1),
      });
    else if (kind === "bullet")
      entities.push({
        ...base,
        kind,
        ownerId,
        ttlTicks: lifetime,
        damage: 34,
        homingTargetId: targetId ? asEntityId(targetId) : null,
      });
    else if (kind === "asteroid")
      entities.push({
        ...base,
        kind,
        hp,
        spin: 0,
        homingTargetId: targetId ? asEntityId(targetId) : null,
      });
    else if (kind === "pickup")
      entities.push({
        ...base,
        kind,
        pickupType: flagsValue & 16 ? "shield" : "rapid",
        ttlTicks: lifetime,
      });
    else
      entities.push({
        ...base,
        kind: "explosion",
        ttlTicks: lifetime,
        particles: [],
      });
  }
  return {
    tick: view.getUint32(2, true),
    score: view.getUint32(6, true),
    localEntityId: view.getUint32(10, true),
    lastProcessedSeq: view.getUint32(14, true),
    randomState: view.getUint32(20, true),
    nextEntityId: view.getUint32(24, true),
    entities,
  };
}

function flags(entity: EntityState): number {
  if (entity.kind === "ship")
    return (
      Number(entity.thrusting) |
      (entity.shieldTicks > 0 ? 2 : 0) |
      (entity.rapidTicks > 0 ? 4 : 0) |
      (entity.invulnerableTicks > 0 ? 8 : 0)
    );
  if (entity.kind === "pickup") return entity.pickupType === "shield" ? 16 : 0;
  return entity.kind === "bullet" || entity.kind === "asteroid"
    ? Number(entity.homingTargetId !== null)
    : 0;
}
function quantizeAngle(angle: number): number {
  return clampInt(
    Math.round(
      (((((angle + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) -
        Math.PI) *
        10000,
    ),
    -32768,
    32767,
  );
}
function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}
function readTurn(value: number): -1 | 0 | 1 {
  if (value === -1) return -1;
  if (value === 0) return 0;
  if (value === 1) return 1;
  throw new RangeError("input turn must be -1, 0, or 1");
}
function validateSnapshot(input: unknown): GameSnapshot {
  const parsed = snapshotSchema.safeParse(input);
  if (!parsed.success)
    throw new TypeError(
      `invalid snapshot fields: ${parsed.error.issues.map((issue) => issue.path.join(".")).join(", ")}`,
    );
  return parsed.data as GameSnapshot;
}

export function parseSnapshot(input: unknown): GameSnapshot {
  return validateSnapshot(input);
}
