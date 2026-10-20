import type { EntityState, ShipState, WorldState } from "@dogfight/shared";
import type { LoadedAssets } from "../assets/loader.js";
import type { LoopStats } from "../loop.js";
import type { NetStats, Pose } from "../net/netcode.js";

export interface LoadingDisplay {
  percent: number;
  label: string;
}

export function drawLoading(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: LoadingDisplay,
): void {
  ctx.clearRect(0, 0, width, height);
  drawGrid(ctx, width, height);
  ctx.textAlign = "center";
  ctx.fillStyle = "#e7f4ff";
  ctx.font = "700 28px system-ui";
  ctx.fillText("Підготовка Dogfight", width / 2, height / 2 - 44);
  ctx.fillStyle = "#99b6d6";
  ctx.font = "14px system-ui";
  ctx.fillText(state.label, width / 2, height / 2 - 10);
  const barWidth = Math.min(420, width - 64);
  const left = (width - barWidth) / 2;
  const top = height / 2 + 16;
  ctx.fillStyle = "rgba(4, 12, 24, .86)";
  roundRect(ctx, left, top, barWidth, 16, 8);
  ctx.fill();
  ctx.fillStyle = "#153250";
  roundRect(ctx, left + 2, top + 2, barWidth - 4, 12, 6);
  ctx.fill();
  const current = Math.max(0, Math.min(1, state.percent));
  if (current > 0) {
    ctx.fillStyle = "#49cfb4";
    roundRect(
      ctx,
      left + 2,
      top + 2,
      Math.max(8, (barWidth - 4) * current),
      12,
      6,
    );
    ctx.fill();
  }
  ctx.fillStyle = "#d8efff";
  ctx.font = "12px ui-monospace, monospace";
  ctx.fillText(`${Math.round(current * 100)}%`, width / 2, top + 42);
  ctx.textAlign = "start";
}

export function drawWorld(
  ctx: CanvasRenderingContext2D,
  world: WorldState,
  alpha: number,
  stats: LoopStats,
  assets: LoadedAssets,
  localEntityId: number,
  remote: ReadonlyMap<number, Pose>,
  net: NetStats,
  version: string,
  gridSize = 40,
): void {
  ctx.clearRect(0, 0, world.width, world.height);
  drawGrid(ctx, world.width, world.height, gridSize);
  for (const entity of world.entities) {
    const pose = renderPose(entity, alpha, localEntityId, remote);
    if (entity.kind === "ship") drawShip(ctx, entity, pose, assets);
    else if (entity.kind === "bullet") drawBullet(ctx, entity, pose, assets);
    else if (entity.kind === "asteroid")
      drawAsteroid(ctx, entity, pose, assets);
    else if (entity.kind === "pickup") drawPickup(ctx, entity, pose);
    else drawExplosion(ctx, entity);
  }
  drawHud(ctx, stats, world, net, version, localEntityId);
}

function renderPose(
  entity: EntityState,
  alpha: number,
  localEntityId: number,
  remote: ReadonlyMap<number, Pose>,
): Pose {
  if (entity.kind === "bullet" && entity.ownerId === localEntityId)
    return { x: entity.x, y: entity.y, angle: entity.angle };
  if (entity.id !== localEntityId) {
    const remotePose = remote.get(entity.id);
    if (remotePose) return remotePose;
  }
  return { x: entity.x, y: entity.y, angle: entity.angle };
}

function drawGrid(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  gridSize = 40,
): void {
  ctx.strokeStyle = "rgba(116, 182, 255, .12)";
  ctx.lineWidth = 1;
  for (let x = 0; x < width; x += gridSize) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = 0; y < height; y += gridSize) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
}

function drawShip(
  ctx: CanvasRenderingContext2D,
  ship: ShipState,
  pose: Pose,
  assets: LoadedAssets,
): void {
  if (ship.hp <= 0 && ship.respawnTicks > 0) return;
  const sprite = assets.images.get("ship");
  if (
    ship.invulnerableTicks > 0 &&
    Math.floor(ship.invulnerableTicks / 4) % 2 === 0
  )
    ctx.globalAlpha = 0.42;
  ctx.save();
  ctx.translate(pose.x, pose.y);
  ctx.rotate(pose.angle);
  if (ship.thrusting) {
    ctx.fillStyle = "#ff9f43";
    ctx.beginPath();
    ctx.moveTo(-12, 0);
    ctx.lineTo(-25, -5);
    ctx.lineTo(-19, 0);
    ctx.lineTo(-25, 5);
    ctx.closePath();
    ctx.fill();
  }
  if (sprite) {
    const frame = ship.shieldTicks > 0 ? 2 : ship.thrusting ? 1 : 0;
    ctx.drawImage(
      sprite.image,
      frame * sprite.frameWidth,
      0,
      sprite.frameWidth,
      sprite.frameHeight,
      -16,
      -16,
      32,
      32,
    );
  } else drawShipFallback(ctx);
  if (ship.shieldTicks > 0) {
    ctx.strokeStyle = "#b27dff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, ship.radius + 5, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

function drawShipFallback(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = "#56d7ff";
  ctx.strokeStyle = "#e7f7ff";
  ctx.beginPath();
  ctx.moveTo(22, 0);
  ctx.lineTo(-15, -13);
  ctx.lineTo(-8, 0);
  ctx.lineTo(-15, 13);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function drawBullet(
  ctx: CanvasRenderingContext2D,
  bullet: Extract<EntityState, { kind: "bullet" }>,
  pose: Pose,
  assets: LoadedAssets,
): void {
  const sprite = assets.images.get("bullet");
  if (sprite) {
    const frame = bullet.homingTargetId === null ? 0 : 2;
    ctx.drawImage(
      sprite.image,
      frame * sprite.frameWidth,
      0,
      sprite.frameWidth,
      sprite.frameHeight,
      pose.x - 8,
      pose.y - 8,
      16,
      16,
    );
  } else {
    ctx.fillStyle = bullet.homingTargetId === null ? "#ffe06b" : "#ff60d5";
    ctx.beginPath();
    ctx.arc(pose.x, pose.y, bullet.radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawAsteroid(
  ctx: CanvasRenderingContext2D,
  asteroid: Extract<EntityState, { kind: "asteroid" }>,
  pose: Pose,
  assets: LoadedAssets,
): void {
  const sprite = assets.images.get("asteroid");
  if (sprite) {
    const frame =
      asteroid.id % Math.floor(sprite.image.width / sprite.frameWidth);
    const size = asteroid.radius * 2;
    ctx.save();
    ctx.translate(pose.x, pose.y);
    ctx.rotate(pose.angle);
    if (asteroid.homingTargetId !== null) ctx.globalAlpha = 0.88;
    ctx.drawImage(
      sprite.image,
      frame * sprite.frameWidth,
      0,
      sprite.frameWidth,
      sprite.frameHeight,
      -size / 2,
      -size / 2,
      size,
      size,
    );
    ctx.restore();
    ctx.globalAlpha = 1;
  } else {
    ctx.fillStyle = "#8496a9";
    ctx.beginPath();
    ctx.arc(pose.x, pose.y, asteroid.radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawPickup(
  ctx: CanvasRenderingContext2D,
  pickup: Extract<EntityState, { kind: "pickup" }>,
  pose: Pose,
): void {
  const shield = pickup.pickupType === "shield";
  ctx.strokeStyle = shield ? "#b27dff" : "#76f7bc";
  ctx.fillStyle = ctx.strokeStyle;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(pose.x, pose.y, pickup.radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.font = "bold 13px system-ui";
  ctx.textAlign = "center";
  ctx.fillText(shield ? "S" : "R", pose.x, pose.y + 5);
  ctx.textAlign = "start";
}

function drawExplosion(
  ctx: CanvasRenderingContext2D,
  explosion: Extract<EntityState, { kind: "explosion" }>,
): void {
  const opacity = Math.max(0, Math.min(1, explosion.ttlTicks / 17));
  if (explosion.particles.length) {
    ctx.fillStyle = `rgba(255, 151, 64, ${opacity})`;
    for (const particle of explosion.particles)
      ctx.fillRect(particle.x - 2, particle.y - 2, 4, 4);
  } else {
    ctx.strokeStyle = `rgba(255, 151, 64, ${opacity})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(explosion.x, explosion.y, (1 - opacity) * 34, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawHud(
  ctx: CanvasRenderingContext2D,
  stats: LoopStats,
  world: WorldState,
  net: NetStats,
  version: string,
  localEntityId: number,
): void {
  const local = world.entities.find(
    (entity) => entity.id === localEntityId && entity.kind === "ship",
  );
  ctx.fillStyle = "rgba(4, 12, 24, .83)";
  ctx.fillRect(14, 14, 290, 188);
  ctx.fillStyle = "#d6eaff";
  ctx.font = "12px ui-monospace, monospace";
  ctx.fillText(`score       ${world.score}`, 26, 38);
  ctx.fillText(
    `hull        ${local?.kind === "ship" ? local.hp : 0}/100`,
    26,
    57,
  );
  ctx.fillText(
    `sim/render  ${stats.stepsPerSecond} / ${stats.framesPerSecond} Hz`,
    26,
    78,
  );
  ctx.fillText(`frame       ${stats.frameMs.toFixed(2)} ms`, 26, 97);
  ctx.fillText(`RTT         ${net.rttMs.toFixed(0)} ms`, 26, 120);
  ctx.fillText(`snapshot    ${net.snapshotAgeMs.toFixed(0)} ms old`, 26, 138);
  ctx.fillText(`traffic     ${net.bytesPerSecond.toFixed(0)} B/s`, 26, 156);
  ctx.fillText(
    `inputs/corr ${net.pendingInputs} / ${net.correction.toFixed(1)} px`,
    26,
    174,
  );
  ctx.fillStyle = "#7592ae";
  ctx.font = "10px ui-monospace, monospace";
  ctx.fillText(`interp ${net.interpolationDelayMs} ms · ${version}`, 26, 192);
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
}
