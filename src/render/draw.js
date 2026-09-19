function lerp(a, b, alpha) {
  return a + (b - a) * alpha;
}
function lerpAngle(a, b, alpha) {
  return a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * alpha;
}
function interpolated(entity, alpha) {
  return {
    x: lerp(entity.previousPos.x, entity.pos.x, alpha),
    y: lerp(entity.previousPos.y, entity.pos.y, alpha),
    angle: lerpAngle(entity.previousAngle, entity.angle, alpha),
  };
}

export function drawWorld(ctx, world, alpha, stats, ship) {
  const { width, height } = world;
  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = "rgba(116, 182, 255, .12)";
  ctx.lineWidth = 1;
  for (let x = 0; x < width; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = 0; y < height; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  for (const entity of world) {
    if (!entity.alive && entity.kind !== "explosion") continue;
    if (entity.kind === "ship") drawShip(ctx, entity, alpha, world);
    if (entity.kind === "bullet") drawBullet(ctx, entity, alpha);
    if (entity.kind === "asteroid") drawAsteroid(ctx, entity, alpha);
    if (entity.kind === "pickup") drawPickup(ctx, entity, alpha, world);
    if (entity.kind === "explosion") drawExplosion(ctx, entity);
  }
  drawHud(ctx, stats, world, ship);
}

function drawShip(ctx, ship, alpha, world) {
  if (!ship.alive) return;
  const { x, y, angle } = interpolated(ship, alpha);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  if (ship.thrust) {
    ctx.fillStyle = "#ff9f43";
    ctx.beginPath();
    ctx.moveTo(-18, 0);
    ctx.lineTo(-33, -7);
    ctx.lineTo(-27, 0);
    ctx.lineTo(-33, 7);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle =
    world.time < ship.components.shield.until ? "#b27dff" : "#56d7ff";
  ctx.strokeStyle = world.time < ship.invulnerableUntil ? "#ffd166" : "#e7f7ff";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(22, 0);
  ctx.lineTo(-15, -13);
  ctx.lineTo(-8, 0);
  ctx.lineTo(-15, 13);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}
function drawBullet(ctx, bullet, alpha) {
  const { x, y } = interpolated(bullet, alpha);
  ctx.fillStyle = bullet.components.homing ? "#ff60d5" : "#ffe06b";
  ctx.beginPath();
  ctx.arc(x, y, bullet.radius, 0, Math.PI * 2);
  ctx.fill();
}
function drawAsteroid(ctx, asteroid, alpha) {
  const { x, y, angle } = interpolated(asteroid, alpha);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = asteroid.components.homing ? "#d76778" : "#8496a9";
  ctx.strokeStyle = "#cad6e2";
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < 9; i += 1) {
    const radius = asteroid.radius * (0.8 + (i % 3) * 0.1);
    const angleAtPoint = (i / 9) * Math.PI * 2;
    if (i)
      ctx.lineTo(
        Math.cos(angleAtPoint) * radius,
        Math.sin(angleAtPoint) * radius,
      );
    else
      ctx.moveTo(
        Math.cos(angleAtPoint) * radius,
        Math.sin(angleAtPoint) * radius,
      );
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}
function drawPickup(ctx, pickup, alpha, world) {
  const { x, y } = interpolated(pickup, alpha);
  const shield = pickup.components.pickup.type === "shield";
  ctx.strokeStyle = shield ? "#b27dff" : "#76f7bc";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(x, y, pickup.radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = ctx.strokeStyle;
  ctx.font = "bold 13px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(shield ? "S" : "R", x, y + 5);
  ctx.textAlign = "start";
  if (world.time % 1 < 0.5) {
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.arc(x, y, pickup.radius + 5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}
function drawExplosion(ctx, explosion) {
  ctx.fillStyle = `rgba(255, ${100 + Math.round(explosion.ttl * 200)}, 60, ${Math.max(0, explosion.ttl / 0.55)})`;
  for (const particle of explosion.particles)
    ctx.fillRect(particle.pos.x - 2, particle.pos.y - 2, 4, 4);
}
function drawHud(ctx, stats, world, ship) {
  ctx.fillStyle = "rgba(4, 12, 24, .78)";
  ctx.fillRect(16, 16, 230, 128);
  ctx.fillStyle = "#b9d9fa";
  ctx.font = "13px ui-monospace, monospace";
  ctx.fillText(`score       ${world.score}`, 28, 40);
  ctx.fillText(`hull        ${ship.hp}/100`, 28, 61);
  ctx.fillText(`simulation  ${stats.stepsPerSecond} steps/s`, 28, 84);
  ctx.fillText(`render      ${stats.framesPerSecond} fps`, 28, 105);
  ctx.fillText(`frame       ${stats.frameMs.toFixed(2)} ms`, 28, 126);
}
