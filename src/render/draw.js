function lerp(a, b, alpha) {
  return a + (b - a) * alpha;
}
function lerpAngle(a, b, alpha) {
  const delta = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + delta * alpha;
}

export function drawBackground(ctx, width, height) {
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
}

export function drawShip(ctx, previous, current, alpha) {
  const x = lerp(previous.x, current.x, alpha);
  const y = lerp(previous.y, current.y, alpha);
  const angle = lerpAngle(previous.angle, current.angle, alpha);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  if (current.thrust) {
    ctx.fillStyle = "#ff9f43";
    ctx.beginPath();
    ctx.moveTo(-18, 0);
    ctx.lineTo(-32, -7);
    ctx.lineTo(-28, 0);
    ctx.lineTo(-32, 7);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = "#56d7ff";
  ctx.strokeStyle = "#e7f7ff";
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

export function drawHud(ctx, stats) {
  ctx.fillStyle = "rgba(4, 12, 24, .76)";
  ctx.fillRect(16, 16, 175, 86);
  ctx.fillStyle = "#b9d9fa";
  ctx.font = "13px ui-monospace, monospace";
  ctx.fillText(`simulation  ${stats.stepsPerSecond} steps/s`, 28, 42);
  ctx.fillText(`render      ${stats.framesPerSecond} fps`, 28, 64);
  ctx.fillText(`frame       ${stats.frameMs.toFixed(2)} ms`, 28, 86);
}
