import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  addPlayer,
  asEntityId,
  asSeq,
  asTick,
  createWorld,
  FIXED_DT,
  findEntity,
  randomRange,
  removePlayer,
  spawnPickup,
  stepWorld,
  Vector2,
  type ArenaConfig,
  type InputCommand,
} from "../shared/src/index.js";

const arena: ArenaConfig = {
  id: "test",
  name: "Test arena",
  width: 1000,
  height: 700,
  seed: 42,
  maxPlayers: 8,
};
const command = (
  seq: number,
  options: Partial<Omit<InputCommand, "seq" | "tick">> = {},
): InputCommand => ({
  seq: asSeq(seq),
  tick: asTick(seq),
  turn: options.turn ?? 0,
  thrust: options.thrust ?? false,
  fire: options.fire ?? false,
});

describe("Vector2", () => {
  it("returns new vectors and preserves both operands", () => {
    const first = new Vector2(2, 5);
    const second = new Vector2(-1, 4);
    expect(first.add(second)).toEqual(new Vector2(1, 9));
    expect(first.sub(second)).toEqual(new Vector2(3, 1));
    expect(first.scale(2)).toEqual(new Vector2(4, 10));
    expect(first).toEqual(new Vector2(2, 5));
    expect(second).toEqual(new Vector2(-1, 4));
  });
  it("normalizes zero and supports angle, rotation, length and dot", () => {
    expect(new Vector2(0, 0).normalize()).toEqual(new Vector2(0, 0));
    expect(new Vector2(3, 4).length()).toBe(5);
    expect(new Vector2(3, 4).normalize().length()).toBeCloseTo(1);
    expect(new Vector2(1, 0).rotate(Math.PI / 2).x).toBeCloseTo(0);
    expect(new Vector2(1, 0).rotate(Math.PI / 2).y).toBeCloseTo(1);
    expect(new Vector2(2, 3).dot(new Vector2(4, -1))).toBe(5);
    expect(Vector2.fromAngle(Math.PI, 2).x).toBeCloseTo(-2);
  });
  it("satisfies add commutativity for finite coordinates", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1e5, max: 1e5, noNaN: true }),
        fc.double({ min: -1e5, max: 1e5, noNaN: true }),
        fc.double({ min: -1e5, max: 1e5, noNaN: true }),
        fc.double({ min: -1e5, max: 1e5, noNaN: true }),
        (x1, y1, x2, y2) => {
          const left = new Vector2(x1, y1).add(new Vector2(x2, y2));
          const right = new Vector2(x2, y2).add(new Vector2(x1, y1));
          return left.x === right.x && left.y === right.y;
        },
      ),
    );
  });
  it("satisfies dot-product symmetry", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1e4, max: 1e4, noNaN: true }),
        fc.double({ min: -1e4, max: 1e4, noNaN: true }),
        fc.double({ min: -1e4, max: 1e4, noNaN: true }),
        fc.double({ min: -1e4, max: 1e4, noNaN: true }),
        (x1, y1, x2, y2) =>
          Math.abs(
            new Vector2(x1, y1).dot(new Vector2(x2, y2)) -
              new Vector2(x2, y2).dot(new Vector2(x1, y1)),
          ) < 1e-6,
      ),
    );
  });
});

describe("seeded randomness and simulation", () => {
  it("returns deterministic values inside the requested range", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 0xffffffff }),
        fc.double({
          min: -500,
          max: 500,
          noNaN: true,
          noDefaultInfinity: true,
        }),
        fc.double({
          min: -500,
          max: 500,
          noNaN: true,
          noDefaultInfinity: true,
        }),
        (seed, low, high) => {
          const min = Math.min(low, high);
          const max = Math.max(low, high);
          const first = randomRange(seed, min, max);
          const second = randomRange(seed, min, max);
          return (
            first.value === second.value &&
            first.state === second.state &&
            first.value >= min &&
            first.value <= max
          );
        },
      ),
    );
  });
  it("creates repeatable worlds from the same seed", () => {
    expect(createWorld(arena)).toEqual(createWorld(arena));
    expect(createWorld(arena).entities).toHaveLength(6);
  });
  it("adds a player once, assigns a homing asteroid, and removes the player", () => {
    const world = createWorld(arena);
    const player = addPlayer(world, "pilot-a", "Nova");
    expect(addPlayer(world, "pilot-a", "ignored")).toBe(player);
    expect(world.players).toHaveLength(1);
    expect(
      world.entities.some(
        (entity) =>
          entity.kind === "asteroid" &&
          entity.homingTargetId === player.entityId,
      ),
    ).toBe(true);
    removePlayer(world, "pilot-a");
    removePlayer(world, "unknown");
    expect(world.players).toHaveLength(0);
    expect(findEntity(world, player.entityId)).toBeUndefined();
  });
  it("steps deterministically and keeps an unwrapped ship in the arena", () => {
    const left = createWorld(arena);
    const right = createWorld(arena);
    const playerA = addPlayer(left, "a", "A");
    const playerB = addPlayer(right, "a", "A");
    for (let tick = 1; tick <= 30; tick += 1) {
      const next = command(tick, {
        turn: tick % 3 === 0 ? 1 : 0,
        thrust: true,
        fire: tick % 5 === 0,
      });
      stepWorld(left, new Map([[playerA.playerId, next]]), FIXED_DT);
      stepWorld(right, new Map([[playerB.playerId, next]]), FIXED_DT);
    }
    expect(left).toEqual(right);
    const ship = findEntity(left, playerA.entityId);
    expect(ship?.x).toBeGreaterThanOrEqual(-20);
    expect(ship?.x).toBeLessThanOrEqual(arena.width + 20);
  });
  it("fires from the ship nose and reports a fired simulation event", () => {
    const world = createWorld(arena);
    const player = addPlayer(world, "pilot", "Pilot");
    const ship = findEntity(world, player.entityId);
    expect(ship?.kind).toBe("ship");
    const events = stepWorld(
      world,
      new Map([[player.playerId, command(1, { fire: true })]]),
    );
    expect(
      events.some(
        (event) => event.type === "fired" && event.ownerId === player.entityId,
      ),
    ).toBe(true);
    expect(
      world.entities.some(
        (entity) =>
          entity.kind === "bullet" && entity.ownerId === player.entityId,
      ),
    ).toBe(true);
  });
  it("steers homing bullets and asteroids toward a live ship", () => {
    const world = createWorld(arena);
    const player = addPlayer(world, "pilot", "Pilot");
    const ship = findEntity(world, player.entityId);
    if (!ship || ship.kind !== "ship") throw new Error("ship missing");
    const bulletId = asEntityId(world.nextEntityId++);
    world.entities.push({
      id: bulletId,
      kind: "bullet",
      x: ship.x - 100,
      y: ship.y,
      vx: 0,
      vy: 0,
      angle: 0,
      radius: 4,
      ownerId: asEntityId(9999),
      ttlTicks: 10,
      damage: 1,
      homingTargetId: ship.id,
    });
    const asteroid = world.entities.find(
      (entity) => entity.kind === "asteroid",
    );
    if (asteroid?.kind === "asteroid") asteroid.homingTargetId = ship.id;
    stepWorld(world, new Map());
    const bullet = findEntity(world, bulletId);
    expect(bullet?.kind === "bullet" && bullet.vx > 0).toBe(true);
    expect(
      asteroid?.kind === "asteroid" && Math.hypot(asteroid.vx, asteroid.vy) > 0,
    ).toBe(true);
  });
  it("damages asteroids and removes their bullets after collision", () => {
    const world = createWorld(arena);
    const player = addPlayer(world, "pilot", "Pilot");
    const asteroid = world.entities.find(
      (entity) => entity.kind === "asteroid",
    );
    if (!asteroid || asteroid.kind !== "asteroid")
      throw new Error("asteroid missing");
    asteroid.x = 500;
    asteroid.y = 350;
    asteroid.vx = 0;
    asteroid.vy = 0;
    asteroid.hp = 1;
    const id = asEntityId(world.nextEntityId++);
    world.entities.push({
      id,
      kind: "bullet",
      x: 500,
      y: 350,
      vx: 0,
      vy: 0,
      angle: 0,
      radius: 5,
      ownerId: asEntityId(9999),
      ttlTicks: 5,
      damage: 10,
      homingTargetId: null,
    });
    const events = stepWorld(world, new Map());
    expect(findEntity(world, asteroid.id)).toBeUndefined();
    expect(findEntity(world, id)).toBeUndefined();
    expect(events.some((event) => event.type === "hit")).toBe(true);
    expect(events.some((event) => event.type === "exploded")).toBe(true);
    expect(world.score).toBeGreaterThanOrEqual(100);
    expect(player.entityId).toBeGreaterThan(0);
  });
  it("respects ship invulnerability and respawns destroyed ships", () => {
    const world = createWorld(arena);
    const player = addPlayer(world, "pilot", "Pilot");
    const ship = findEntity(world, player.entityId);
    if (!ship || ship.kind !== "ship") throw new Error("ship missing");
    ship.hp = 0;
    ship.respawnTicks = 1;
    ship.x = -1000;
    ship.y = -1000;
    stepWorld(world, new Map());
    expect(ship.hp).toBe(100);
    expect(ship.respawnTicks).toBe(0);
    expect(ship.x).toBeGreaterThanOrEqual(0);
    ship.invulnerableTicks = 3;
    ship.shieldTicks = 0;
    const asteroid = world.entities.find(
      (entity) => entity.kind === "asteroid",
    );
    if (asteroid) {
      asteroid.x = ship.x;
      asteroid.y = ship.y;
      asteroid.vx = 0;
      asteroid.vy = 0;
    }
    stepWorld(world, new Map());
    expect(ship.hp).toBe(100);
  });
  it("collects pickups and grants their effect", () => {
    const world = createWorld(arena);
    const player = addPlayer(world, "pilot", "Pilot");
    const ship = findEntity(world, player.entityId);
    if (!ship || ship.kind !== "ship") throw new Error("ship missing");
    const pickup = spawnPickup(world, "shield");
    pickup.x = ship.x;
    pickup.y = ship.y;
    stepWorld(world, new Map());
    expect(ship.shieldTicks).toBeGreaterThan(0);
    expect(findEntity(world, pickup.id)).toBeUndefined();
    expect(world.score).toBe(25);
  });
  it("expires bullets, pickups, and explosions", () => {
    const world = createWorld(arena);
    const bulletId = asEntityId(world.nextEntityId++);
    world.entities.push({
      id: bulletId,
      kind: "bullet",
      x: 30,
      y: 30,
      vx: 0,
      vy: 0,
      angle: 0,
      radius: 3,
      ownerId: asEntityId(9999),
      ttlTicks: 1,
      damage: 1,
      homingTargetId: null,
    });
    const pickup = spawnPickup(world);
    pickup.ttlTicks = 1;
    const explosionId = asEntityId(world.nextEntityId++);
    world.entities.push({
      id: explosionId,
      kind: "explosion",
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      angle: 0,
      radius: 0,
      ttlTicks: 1,
      particles: [],
    });
    stepWorld(world, new Map());
    expect(findEntity(world, bulletId)).toBeUndefined();
    expect(findEntity(world, pickup.id)).toBeUndefined();
    expect(findEntity(world, explosionId)).toBeUndefined();
  });
  it("spawns the next periodic pickup on tick 210", () => {
    const world = createWorld(arena);
    for (let index = 0; index < 210; index += 1) stepWorld(world, new Map());
    expect(world.entities.some((entity) => entity.kind === "pickup")).toBe(
      true,
    );
  });
});

describe("small vector regression matrix", () => {
  it.each(Array.from({ length: 20 }, (_, index) => index + 1))(
    "scales vector by %i",
    (factor) => {
      const vector = new Vector2(factor, -factor);
      expect(vector.scale(2)).toEqual(new Vector2(factor * 2, -factor * 2));
    },
  );
});
