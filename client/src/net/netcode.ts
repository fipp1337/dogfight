import {
  asEntityId,
  asTick,
  FIXED_DT,
  stepWorld,
  type ArenaConfig,
  type GameSnapshot,
  type InputCommand,
  type PlayerState,
  type WorldState,
} from "@dogfight/shared";

export interface TimedSnapshot {
  receivedAt: number;
  snapshot: GameSnapshot;
}
export interface NetStats {
  rttMs: number;
  correction: number;
  interpolationDelayMs: number;
  pendingInputs: number;
  snapshotAgeMs: number;
  bytesPerSecond: number;
}
export interface Pose {
  x: number;
  y: number;
  angle: number;
}

export function applySnapshot(
  snapshot: GameSnapshot,
  arena: ArenaConfig,
  playerId: string,
  playerName: string,
  roster: readonly { id: string; name: string; entityId: number }[],
  pending: InputCommand[],
  priorWorld?: WorldState,
): { world: WorldState; pending: InputCommand[]; correction: number } {
  const priorLocal = priorWorld?.entities.find(
    (entity) => entity.id === snapshot.localEntityId && entity.kind === "ship",
  );
  const nextPending = pending
    .filter((input) => input.seq > snapshot.lastProcessedSeq)
    .sort((a, b) => a.seq - b.seq);
  const players: PlayerState[] = roster.map((player) => ({
    playerId: player.id,
    name: player.name,
    entityId: asEntityId(player.entityId),
  }));
  const localPlayer: PlayerState = {
    playerId,
    name: playerName,
    entityId: asEntityId(snapshot.localEntityId),
  };
  if (!players.some((player) => player.playerId === playerId))
    players.push(localPlayer);
  else {
    const localIndex = players.findIndex(
      (player) => player.playerId === playerId,
    );
    const listed = players[localIndex];
    if (listed) players[localIndex] = localPlayer;
  }
  const world: WorldState = {
    width: arena.width,
    height: arena.height,
    tick: asTick(snapshot.tick),
    score: snapshot.score,
    nextEntityId: snapshot.nextEntityId,
    randomState: snapshot.randomState,
    entities: structuredClone(snapshot.entities),
    players,
  };
  for (const entity of world.entities) {
    if (entity.kind !== "ship") continue;
    const owner = players.find((player) => player.entityId === entity.id);
    if (owner) {
      entity.playerId = owner.playerId;
      entity.name = owner.name;
    }
  }
  const authoritativeLocal = world.entities.find(
    (entity) => entity.id === snapshot.localEntityId && entity.kind === "ship",
  );
  const correction =
    priorLocal?.kind === "ship" && authoritativeLocal?.kind === "ship"
      ? Math.hypot(
          priorLocal.x - authoritativeLocal.x,
          priorLocal.y - authoritativeLocal.y,
        )
      : 0;
  for (const input of nextPending)
    stepWorld(world, new Map([[playerId, input]]), FIXED_DT);
  return { world, pending: nextPending, correction };
}

export function sampleRemote(
  buffer: readonly TimedSnapshot[],
  now: number,
  delayMs: number,
): Map<number, Pose> {
  const poses = new Map<number, Pose>();
  if (!buffer.length) return poses;
  const target = now - delayMs;
  let before = buffer[0];
  let after = buffer[buffer.length - 1];
  for (let i = 0; i < buffer.length - 1; i += 1) {
    const left = buffer[i];
    const right = buffer[i + 1];
    if (
      left &&
      right &&
      left.receivedAt <= target &&
      right.receivedAt >= target
    ) {
      before = left;
      after = right;
      break;
    }
    if (left && left.receivedAt > target) {
      before = left;
      after = left;
      break;
    }
  }
  if (!before || !after) return poses;
  const span = after.receivedAt - before.receivedAt;
  const alpha =
    before === after || span <= 0
      ? 0
      : Math.max(0, Math.min(1, (target - before.receivedAt) / span));
  const rightById = new Map(
    after.snapshot.entities.map((entity) => [entity.id, entity]),
  );
  for (const left of before.snapshot.entities) {
    const right = rightById.get(left.id);
    if (!right || left.kind !== right.kind) continue;
    poses.set(left.id, {
      x: left.x + (right.x - left.x) * alpha,
      y: left.y + (right.y - left.y) * alpha,
      angle: lerpAngle(left.angle, right.angle, alpha),
    });
  }
  return poses;
}

function lerpAngle(start: number, end: number, alpha: number): number {
  const delta = Math.atan2(Math.sin(end - start), Math.cos(end - start));
  return start + delta * alpha;
}
