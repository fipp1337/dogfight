import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  asEntityId,
  asSeq,
  asTick,
  createWorld,
  decodeInput,
  encodeInput,
  encodeSnapshot,
  jsonCodec,
  decodeSnapshot,
  parseClientMessage,
  type EntityState,
  type GameSnapshot,
  type InputCommand,
} from "../shared/src/index.js";

function representativeSnapshot(): GameSnapshot {
  const world = createWorld({
    id: "codec",
    name: "Codec",
    width: 800,
    height: 600,
    seed: 123,
    maxPlayers: 4,
  });
  const player = {
    playerId: "pilot-id",
    name: "Pilot",
    entityId: asEntityId(world.nextEntityId++),
  };
  world.players.push(player);
  const entities: EntityState[] = [
    {
      id: player.entityId,
      kind: "ship",
      x: 1,
      y: 2,
      vx: 3,
      vy: 4,
      angle: 0.1234,
      radius: 15,
      playerId: player.playerId,
      name: player.name,
      hp: 80,
      cooldownTicks: 2,
      respawnTicks: 0,
      invulnerableTicks: 10,
      shieldTicks: 5,
      rapidTicks: 3,
      thrusting: true,
    },
    {
      id: asEntityId(10),
      kind: "bullet",
      x: 10,
      y: 11,
      vx: 12,
      vy: 13,
      angle: -2.2,
      radius: 4,
      ownerId: player.entityId,
      ttlTicks: 30,
      damage: 34,
      homingTargetId: asEntityId(20),
    },
    {
      id: asEntityId(20),
      kind: "asteroid",
      x: 20,
      y: 21,
      vx: 22,
      vy: 23,
      angle: 0.5,
      radius: 28,
      hp: 68,
      spin: 0.2,
      homingTargetId: player.entityId,
    },
    {
      id: asEntityId(30),
      kind: "pickup",
      x: 30,
      y: 31,
      vx: 0,
      vy: 0,
      angle: 0,
      radius: 13,
      pickupType: "shield",
      ttlTicks: 100,
    },
    {
      id: asEntityId(40),
      kind: "explosion",
      x: 40,
      y: 41,
      vx: 0,
      vy: 0,
      angle: 0,
      radius: 0,
      ttlTicks: 12,
      particles: [{ x: 40, y: 41, vx: 1, vy: -1 }],
    },
  ];
  return {
    tick: 99,
    score: 50,
    localEntityId: player.entityId,
    lastProcessedSeq: 25,
    randomState: 13579,
    nextEntityId: 41,
    entities,
  };
}

describe("binary and JSON snapshot protocol", () => {
  it("roundtrips compact little-endian input frames", () => {
    const input: InputCommand = {
      seq: asSeq(0x12345678),
      tick: asTick(0x01020304),
      turn: -1,
      thrust: true,
      fire: true,
    };
    const frame = encodeInput(input);
    expect(frame.byteLength).toBe(12);
    expect(new DataView(frame).getUint32(2, true)).toBe(input.seq);
    expect(decodeInput(frame)).toEqual(input);
  });
  it("rejects malformed input frames", () => {
    const good = encodeInput({
      seq: asSeq(1),
      tick: asTick(1),
      turn: 0,
      thrust: false,
      fire: false,
    });
    const wrongVersion = good.slice(0);
    new DataView(wrongVersion).setUint8(0, 2);
    const wrongTurn = good.slice(0);
    new DataView(wrongTurn).setInt8(10, 2);
    const wrongFlags = good.slice(0);
    new DataView(wrongFlags).setUint8(11, 4);
    expect(() => decodeInput(new ArrayBuffer(4))).toThrow(/length/);
    expect(() => decodeInput(wrongVersion)).toThrow(/version/);
    expect(() => decodeInput(wrongTurn)).toThrow(/invalid fields/);
    expect(() => decodeInput(wrongFlags)).toThrow(/invalid fields/);
    expect(() =>
      encodeInput({
        seq: asSeq(-1),
        tick: asTick(0),
        turn: 0,
        thrust: false,
        fire: false,
      }),
    ).toThrow(/range/);
  });
  it("roundtrips generated valid input values", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 0xffffffff }),
        fc.integer({ min: 0, max: 0xffffffff }),
        fc.constantFrom(-1, 0, 1),
        fc.boolean(),
        fc.boolean(),
        (seq, tick, turn, thrust, fire) => {
          const source = {
            seq: asSeq(seq),
            tick: asTick(tick),
            turn,
            thrust,
            fire,
          };
          return (
            JSON.stringify(decodeInput(encodeInput(source))) ===
            JSON.stringify(source)
          );
        },
      ),
    );
  });
  it("roundtrips all entity kinds and retains quantized angles", () => {
    const source = representativeSnapshot();
    const decoded = decodeSnapshot(encodeSnapshot(source));
    expect(decoded.tick).toBe(source.tick);
    expect(decoded.score).toBe(source.score);
    expect(decoded.entities.map((entity) => entity.kind)).toEqual(
      source.entities.map((entity) => entity.kind),
    );
    decoded.entities.forEach((entity, index) =>
      expect(entity.angle).toBeCloseTo(source.entities[index]?.angle ?? 0, 3),
    );
  });
  it("roundtrips validated JSON without accepting malformed data", () => {
    const source = representativeSnapshot();
    const buffer = jsonCodec.encode(source);
    expect(jsonCodec.decode(buffer)).toEqual(source);
    const malformed = new TextEncoder().encode(
      '{"tick":0,"entities":[{"kind":"ship"}]}',
    );
    expect(() => jsonCodec.decode(malformed.buffer)).toThrow(
      /invalid snapshot fields/,
    );
  });
  it("stores a 28-byte header and 39 bytes per entity", () => {
    const source = representativeSnapshot();
    expect(encodeSnapshot(source).byteLength).toBe(
      28 + source.entities.length * 39,
    );
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 64 }), (count) => {
        const snapshot = {
          ...source,
          entities: source.entities.slice(
            0,
            count % (source.entities.length + 1),
          ),
        };
        return (
          encodeSnapshot(snapshot).byteLength ===
          28 + snapshot.entities.length * 39
        );
      }),
    );
  });
  it("rejects invalid versions, frame sizes, unknown kinds, and non-finite coordinates", () => {
    const good = encodeSnapshot(representativeSnapshot());
    const badVersion = good.slice(0);
    new DataView(badVersion).setUint8(0, 9);
    const badKind = good.slice(0);
    new DataView(badKind).setUint8(32, 99);
    const badNumber = good.slice(0);
    new DataView(badNumber).setFloat32(33, Number.POSITIVE_INFINITY, true);
    expect(() => decodeSnapshot(new ArrayBuffer(1))).toThrow(/truncated/);
    expect(() => decodeSnapshot(good.slice(0, good.byteLength - 1))).toThrow(
      /length/,
    );
    expect(() => decodeSnapshot(badVersion)).toThrow(/version/);
    expect(() => decodeSnapshot(badKind)).toThrow(/kind/);
    expect(() => decodeSnapshot(badNumber)).toThrow(/non-finite/);
  });
  it("rejects snapshots with more than 512 entities", () => {
    const source = representativeSnapshot();
    expect(() =>
      encodeSnapshot({
        ...source,
        entities: Array.from({ length: 513 }, (_, index) => ({
          ...source.entities[0]!,
          id: asEntityId(index),
        })),
      }),
    ).toThrow(/too many/);
  });
  it("rejects malformed client messages with a discriminated schema", () => {
    expect(
      parseClientMessage({
        type: "input",
        seq: 1,
        tick: 2,
        turn: -1,
        thrust: true,
        fire: false,
      }).success,
    ).toBe(true);
    expect(
      parseClientMessage({
        type: "input",
        seq: -1,
        tick: 2,
        turn: 3,
        thrust: "yes",
        fire: false,
      }).success,
    ).toBe(false);
    expect(parseClientMessage({ type: "unknown" }).success).toBe(false);
  });
  it("accepts a generated sequence of valid input envelopes", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 0xffffffff }),
        fc.integer({ min: 0, max: 0xffffffff }),
        fc.boolean(),
        fc.boolean(),
        fc.constantFrom(-1, 0, 1),
        (seq, tick, thrust, fire, turn) =>
          parseClientMessage({ type: "input", seq, tick, thrust, fire, turn })
            .success,
      ),
    );
  });
  it("rejects generated out-of-range turn values", () => {
    fc.assert(
      fc.property(
        fc
          .integer({ min: -100, max: 100 })
          .filter((turn) => turn !== -1 && turn !== 0 && turn !== 1),
        (turn) =>
          !parseClientMessage({
            type: "input",
            seq: 1,
            tick: 1,
            turn,
            thrust: false,
            fire: false,
          }).success,
      ),
    );
  });
  it.each(Array.from({ length: 40 }, (_, index) => index))(
    "parses input message sequence %i",
    (index) => {
      const message = {
        type: "input",
        seq: index,
        tick: index + 1,
        turn: (index % 3) - 1,
        thrust: index % 2 === 0,
        fire: index % 5 === 0,
      };
      expect(parseClientMessage(message).success).toBe(true);
    },
  );
});
