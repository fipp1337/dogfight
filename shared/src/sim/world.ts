import {
  asEntityId,
  asTick,
  type ArenaConfig,
  type AsteroidState,
  type BulletState,
  type EntityState,
  type ExplosionState,
  type InputCommand,
  type ParticleState,
  type PickupState,
  type PlayerState,
  type ShipState,
  type SimEvent,
  type WorldState,
} from "./types.js";
import { randomRange } from "./random.js";
import { Vector2 } from "./vector.js";

export const FIXED_DT = 1 / 30;
const TURN_RATE = 3.8;
const THRUST = 420;
const DRAG = 0.72;
const MAX_SPEED = 310;
const bulletPool: BulletState[] = [];
const particlePool: ParticleState[] = [];
const collisionBuffer: EntityState[] = [];

export function createWorld(arena: ArenaConfig): WorldState {
  const world: WorldState = {
    width: arena.width,
    height: arena.height,
    tick: asTick(0),
    score: 0,
    nextEntityId: 1,
    randomState: arena.seed >>> 0,
    entities: [],
    players: [],
  };
  for (let i = 0; i < 6; i += 1) {
    const x = drawRange(world, 40, world.width - 40);
    const y = drawRange(world, 40, world.height - 40);
    const angle = drawRange(world, 0, Math.PI * 2);
    const speed = drawRange(world, 20, 60);
    const radius = drawRange(world, 20, 38);
    world.entities.push({
      id: nextId(world),
      kind: "asteroid",
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      angle: 0,
      radius,
      hp: radius > 30 ? 100 : 68,
      spin: drawRange(world, -0.7, 0.7),
      homingTargetId: null,
    });
  }
  return world;
}

export function addPlayer(
  world: WorldState,
  playerId: string,
  name: string,
): PlayerState {
  const existing = world.players.find((player) => player.playerId === playerId);
  if (existing) return existing;
  const pos = safePosition(world);
  const ship: ShipState = {
    id: nextId(world),
    kind: "ship",
    playerId,
    name,
    x: pos.x,
    y: pos.y,
    vx: 0,
    vy: 0,
    angle: -Math.PI / 2,
    radius: 15,
    hp: 100,
    cooldownTicks: 0,
    respawnTicks: 0,
    invulnerableTicks: 30,
    shieldTicks: 0,
    rapidTicks: 0,
    thrusting: false,
  };
  world.entities.push(ship);
  const homingAsteroid = world.entities.find(
    (entity): entity is AsteroidState =>
      entity.kind === "asteroid" && entity.homingTargetId === null,
  );
  if (homingAsteroid) homingAsteroid.homingTargetId = ship.id;
  const player = { playerId, name, entityId: ship.id };
  world.players.push(player);
  return player;
}

export function removePlayer(world: WorldState, playerId: string): void {
  const playerIndex = world.players.findIndex(
    (player) => player.playerId === playerId,
  );
  if (playerIndex < 0) return;
  const player = world.players[playerIndex];
  if (player) {
    const entity = findEntity(world, player.entityId);
    if (entity)
      world.entities = world.entities.filter(
        (candidate) => candidate.id !== entity.id,
      );
  }
  world.players.splice(playerIndex, 1);
}

export function cloneWorld(world: WorldState): WorldState {
  return structuredClone(world);
}

export function findEntity(
  world: WorldState,
  id: number,
): EntityState | undefined {
  return world.entities.find((entity) => entity.id === id);
}

export function stepWorld(
  world: WorldState,
  inputByPlayer: ReadonlyMap<string, InputCommand>,
  dt = FIXED_DT,
): SimEvent[] {
  const events: SimEvent[] = [];
  world.tick = asTick(world.tick + 1);
  world.entities.sort((a, b) => a.id - b.id);
  const initialEntityCount = world.entities.length;

  for (let index = 0; index < initialEntityCount; index += 1) {
    const entity = world.entities[index];
    if (!entity) continue;
    if (entity.kind === "ship")
      updateShip(world, entity, inputByPlayer.get(entity.playerId), dt, events);
    else if (entity.kind === "bullet") updateBullet(world, entity, dt);
    else if (entity.kind === "asteroid") updateAsteroid(world, entity, dt);
    else if (entity.kind === "pickup") {
      entity.ttlTicks -= 1;
      if (entity.ttlTicks <= 0) entity.radius = 0;
    } else if (entity.kind === "explosion") updateExplosion(entity);
  }

  resolveCollisions(world, events);
  if (world.tick > 0 && world.tick % 210 === 0)
    spawnPickup(world, world.randomState % 2 === 0 ? "shield" : "rapid");
  sweepDeadEntities(world);
  return events;
}

function updateShip(
  world: WorldState,
  ship: ShipState,
  input: InputCommand | undefined,
  dt: number,
  events: SimEvent[],
): void {
  if (ship.respawnTicks > 0) {
    ship.respawnTicks -= 1;
    if (ship.respawnTicks === 0) {
      const pos = safePosition(world);
      ship.x = pos.x;
      ship.y = pos.y;
      ship.vx = 0;
      ship.vy = 0;
      ship.hp = 100;
      ship.invulnerableTicks = 30;
    }
    return;
  }
  ship.invulnerableTicks = Math.max(0, ship.invulnerableTicks - 1);
  ship.cooldownTicks = Math.max(0, ship.cooldownTicks - 1);
  ship.shieldTicks = Math.max(0, ship.shieldTicks - 1);
  ship.rapidTicks = Math.max(0, ship.rapidTicks - 1);
  const turn = input?.turn ?? 0;
  ship.angle += turn * TURN_RATE * dt;
  ship.angle = normalizeAngle(ship.angle);
  ship.thrusting = input?.thrust ?? false;
  if (ship.thrusting) {
    ship.vx += Math.cos(ship.angle) * THRUST * dt;
    ship.vy += Math.sin(ship.angle) * THRUST * dt;
  }
  ship.vx *= Math.pow(DRAG, dt);
  ship.vy *= Math.pow(DRAG, dt);
  const speed = Math.hypot(ship.vx, ship.vy);
  if (speed > MAX_SPEED) {
    const factor = MAX_SPEED / speed;
    ship.vx *= factor;
    ship.vy *= factor;
  }
  ship.x += ship.vx * dt;
  ship.y += ship.vy * dt;
  wrap(world, ship);
  if (input?.fire && ship.cooldownTicks === 0) {
    const forward = Vector2.fromAngle(ship.angle);
    const target = world.entities.find(
      (entity): entity is ShipState =>
        entity.kind === "ship" && entity.id !== ship.id && entity.hp > 0,
    );
    const bullet = takeBullet({
      id: nextId(world),
      kind: "bullet",
      x: ship.x + forward.x * (ship.radius + 7),
      y: ship.y + forward.y * (ship.radius + 7),
      vx: ship.vx + forward.x * 510,
      vy: ship.vy + forward.y * 510,
      angle: ship.angle,
      radius: 4,
      ownerId: ship.id,
      ttlTicks: 42,
      damage: 34,
      homingTargetId: target?.id ?? null,
    });
    world.entities.push(bullet);
    ship.cooldownTicks = ship.rapidTicks > 0 ? 3 : 7;
    events.push({ type: "fired", entityId: bullet.id, ownerId: ship.id });
  }
}

function updateBullet(
  world: WorldState,
  bullet: BulletState,
  dt: number,
): void {
  bullet.ttlTicks -= 1;
  if (bullet.homingTargetId !== null)
    steerToward(world, bullet, bullet.homingTargetId, 190, 3.5, dt);
  bullet.x += bullet.vx * dt;
  bullet.y += bullet.vy * dt;
  wrap(world, bullet);
}

function updateAsteroid(
  world: WorldState,
  asteroid: AsteroidState,
  dt: number,
): void {
  if (asteroid.homingTargetId !== null)
    steerToward(world, asteroid, asteroid.homingTargetId, 90, 1.4, dt);
  asteroid.x += asteroid.vx * dt;
  asteroid.y += asteroid.vy * dt;
  asteroid.angle += asteroid.spin * dt;
  bounce(world, asteroid);
}

function updateExplosion(explosion: ExplosionState): void {
  explosion.ttlTicks -= 1;
  for (const particle of explosion.particles) {
    particle.x += particle.vx * FIXED_DT;
    particle.y += particle.vy * FIXED_DT;
  }
}

function steerToward(
  world: WorldState,
  entity: BulletState | AsteroidState,
  targetId: number,
  speed: number,
  turn: number,
  dt: number,
): void {
  const target = findEntity(world, targetId);
  if (!target || target.kind !== "ship" || target.hp <= 0) return;
  const dx = target.x - entity.x;
  const dy = target.y - entity.y;
  const distance = Math.hypot(dx, dy);
  if (distance === 0) return;
  const desiredX = (dx / distance) * speed;
  const desiredY = (dy / distance) * speed;
  const mix = Math.min(1, turn * dt);
  entity.vx = entity.vx * (1 - mix) + desiredX * mix;
  entity.vy = entity.vy * (1 - mix) + desiredY * mix;
  entity.angle = normalizeAngle(Math.atan2(entity.vy, entity.vx));
}

function resolveCollisions(world: WorldState, events: SimEvent[]): void {
  collisionBuffer.length = 0;
  for (const entity of world.entities)
    if (entity.radius > 0) collisionBuffer.push(entity);
  collisionBuffer.sort((a, b) => a.id - b.id);
  const entities = collisionBuffer;
  for (let i = 0; i < entities.length; i += 1) {
    const a = entities[i];
    if (!a) continue;
    for (let j = i + 1; j < entities.length; j += 1) {
      const b = entities[j];
      if (!b) continue;
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const radii = a.radius + b.radius;
      if (dx * dx + dy * dy > radii * radii) continue;
      const bullet =
        a.kind === "bullet" ? a : b.kind === "bullet" ? b : undefined;
      const target = bullet === a ? b : a;
      if (
        bullet &&
        target.kind !== "bullet" &&
        target.kind !== "explosion" &&
        bullet.ownerId !== target.id
      ) {
        if (target.kind === "ship")
          damageShip(world, target, bullet.damage, events);
        else if (target.kind === "asteroid")
          damageAsteroid(world, target, bullet.damage, events);
        bullet.radius = 0;
        events.push({ type: "hit", entityId: bullet.id, targetId: target.id });
        continue;
      }
      const ship = a.kind === "ship" ? a : b.kind === "ship" ? b : undefined;
      const pickup =
        a.kind === "pickup" ? a : b.kind === "pickup" ? b : undefined;
      if (ship && pickup && ship.hp > 0) {
        if (pickup.pickupType === "shield") ship.shieldTicks = 150;
        else ship.rapidTicks = 150;
        pickup.radius = 0;
        world.score += 25;
      }
      const asteroid =
        a.kind === "asteroid" ? a : b.kind === "asteroid" ? b : undefined;
      if (
        ship &&
        asteroid &&
        ship.invulnerableTicks === 0 &&
        ship.shieldTicks === 0 &&
        ship.respawnTicks === 0
      )
        damageShip(world, ship, 20, events);
    }
  }
}

function damageShip(
  world: WorldState,
  ship: ShipState,
  amount: number,
  events: SimEvent[],
): void {
  if (
    ship.invulnerableTicks > 0 ||
    ship.shieldTicks > 0 ||
    ship.respawnTicks > 0
  )
    return;
  ship.hp = Math.max(0, ship.hp - amount);
  if (ship.hp === 0) {
    ship.respawnTicks = 60;
    spawnExplosion(world, ship.x, ship.y, events);
  }
}

function damageAsteroid(
  world: WorldState,
  asteroid: AsteroidState,
  amount: number,
  events: SimEvent[],
): void {
  asteroid.hp -= amount;
  if (asteroid.hp <= 0) {
    asteroid.radius = 0;
    world.score += 100;
    spawnExplosion(world, asteroid.x, asteroid.y, events);
  }
}

function spawnExplosion(
  world: WorldState,
  x: number,
  y: number,
  events: SimEvent[],
): void {
  const particles: ParticleState[] = [];
  for (let index = 0; index < 18; index += 1) {
    const angle = drawRange(world, 0, Math.PI * 2);
    const speed = drawRange(world, 50, 180);
    const particle = particlePool.pop() ?? { x: 0, y: 0, vx: 0, vy: 0 };
    particle.x = x;
    particle.y = y;
    particle.vx = Math.cos(angle) * speed;
    particle.vy = Math.sin(angle) * speed;
    particles.push(particle);
  }
  const explosion: ExplosionState = {
    id: nextId(world),
    kind: "explosion",
    x,
    y,
    vx: 0,
    vy: 0,
    angle: 0,
    radius: 0,
    ttlTicks: 17,
    particles,
  };
  world.entities.push(explosion);
  events.push({ type: "exploded", entityId: explosion.id });
}

export function spawnPickup(
  world: WorldState,
  type: PickupState["pickupType"] = "rapid",
): PickupState {
  const pos = safePosition(world);
  const pickup: PickupState = {
    id: nextId(world),
    kind: "pickup",
    x: pos.x,
    y: pos.y,
    vx: 0,
    vy: 0,
    angle: 0,
    radius: 13,
    pickupType: type,
    ttlTicks: 330,
  };
  world.entities.push(pickup);
  return pickup;
}

function takeBullet(values: BulletState): BulletState {
  const bullet = bulletPool.pop();
  if (!bullet) return values;
  Object.assign(bullet, values);
  return bullet;
}

function sweepDeadEntities(world: WorldState): void {
  let writeIndex = 0;
  for (const entity of world.entities) {
    const alive =
      entity.kind === "ship"
        ? entity.hp > 0 || entity.respawnTicks >= 0
        : entity.kind === "pickup"
          ? entity.ttlTicks > 0 && entity.radius > 0
          : entity.kind === "bullet"
            ? entity.ttlTicks > 0 && entity.radius > 0
            : entity.kind === "explosion"
              ? entity.ttlTicks > 0
              : entity.hp > 0;
    if (alive) {
      world.entities[writeIndex] = entity;
      writeIndex += 1;
      continue;
    }
    if (entity.kind === "bullet") bulletPool.push(entity);
    if (entity.kind === "explosion") particlePool.push(...entity.particles);
  }
  world.entities.length = writeIndex;
}

function safePosition(world: WorldState): Vector2 {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const pos = new Vector2(
      drawRange(world, 80, world.width - 80),
      drawRange(world, 80, world.height - 80),
    );
    if (
      world.entities.every(
        (entity) =>
          entity.radius === 0 ||
          Math.hypot(entity.x - pos.x, entity.y - pos.y) > entity.radius + 100,
      )
    )
      return pos;
  }
  return new Vector2(world.width / 2, world.height / 2);
}
function drawRange(world: WorldState, min: number, max: number): number {
  const result = randomRange(world.randomState, min, max);
  world.randomState = result.state;
  return result.value;
}
function normalizeAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}
function nextId(world: WorldState) {
  const result = asEntityId(world.nextEntityId);
  world.nextEntityId += 1;
  return result;
}
function wrap(world: WorldState, entity: EntityState): void {
  const margin = entity.radius;
  if (entity.x < -margin) entity.x = world.width + margin;
  if (entity.x > world.width + margin) entity.x = -margin;
  if (entity.y < -margin) entity.y = world.height + margin;
  if (entity.y > world.height + margin) entity.y = -margin;
}
function bounce(world: WorldState, entity: AsteroidState): void {
  if (entity.x < entity.radius || entity.x > world.width - entity.radius)
    entity.vx *= -1;
  if (entity.y < entity.radius || entity.y > world.height - entity.radius)
    entity.vy *= -1;
  entity.x = Math.max(
    entity.radius,
    Math.min(world.width - entity.radius, entity.x),
  );
  entity.y = Math.max(
    entity.radius,
    Math.min(world.height - entity.radius, entity.y),
  );
}
