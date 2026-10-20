declare const entityIdBrand: unique symbol;
declare const tickBrand: unique symbol;
declare const seqBrand: unique symbol;

export type EntityId = number & { readonly [entityIdBrand]: true };
export type Tick = number & { readonly [tickBrand]: true };
export type Seq = number & { readonly [seqBrand]: true };

export interface InputCommand {
  seq: Seq;
  tick: Tick;
  turn: -1 | 0 | 1;
  thrust: boolean;
  fire: boolean;
}

interface EntityBase {
  id: EntityId;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  radius: number;
}

export interface ShipState extends EntityBase {
  kind: "ship";
  playerId: string;
  name: string;
  hp: number;
  cooldownTicks: number;
  respawnTicks: number;
  invulnerableTicks: number;
  shieldTicks: number;
  rapidTicks: number;
  thrusting: boolean;
}

export interface BulletState extends EntityBase {
  kind: "bullet";
  ownerId: EntityId;
  ttlTicks: number;
  damage: number;
  homingTargetId: EntityId | null;
}

export interface AsteroidState extends EntityBase {
  kind: "asteroid";
  hp: number;
  spin: number;
  homingTargetId: EntityId | null;
}

export interface PickupState extends EntityBase {
  kind: "pickup";
  pickupType: "shield" | "rapid";
  ttlTicks: number;
}

export interface ParticleState {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface ExplosionState extends EntityBase {
  kind: "explosion";
  ttlTicks: number;
  particles: ParticleState[];
}

export type EntityState =
  ShipState | BulletState | AsteroidState | PickupState | ExplosionState;

export interface PlayerState {
  playerId: string;
  name: string;
  entityId: EntityId;
}

export interface ArenaConfig {
  id: string;
  name: string;
  width: number;
  height: number;
  seed: number;
  maxPlayers: number;
}

export interface WorldState {
  width: number;
  height: number;
  tick: Tick;
  score: number;
  nextEntityId: number;
  randomState: number;
  entities: EntityState[];
  players: PlayerState[];
}

export interface GameSnapshot {
  tick: number;
  score: number;
  localEntityId: number;
  lastProcessedSeq: number;
  randomState: number;
  nextEntityId: number;
  entities: EntityState[];
}

export type SimEvent =
  | { type: "fired"; entityId: EntityId; ownerId: EntityId }
  | { type: "hit"; entityId: EntityId; targetId: EntityId }
  | { type: "exploded"; entityId: EntityId };

function brandNumber<T extends number>(value: number): T {
  return value as T;
}
export const asEntityId = (value: number): EntityId =>
  brandNumber<EntityId>(value);
export const asTick = (value: number): Tick => brandNumber<Tick>(value);
export const asSeq = (value: number): Seq => brandNumber<Seq>(value);
