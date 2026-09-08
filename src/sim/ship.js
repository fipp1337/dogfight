const TURN_SPEED = 3.8;
const THRUST = 420;
const DRAG_PER_SECOND = 0.72;
const MAX_SPEED = 310;

export function createShip(x, y) {
  return { x, y, vx: 0, vy: 0, angle: -Math.PI / 2, thrust: false };
}

export function copyShip(ship) {
  return { ...ship };
}

export function integrate(ship, input, dt) {
  const turn =
    Number(input.isDown("ArrowRight")) - Number(input.isDown("ArrowLeft"));
  ship.angle += turn * TURN_SPEED * dt;
  ship.thrust = input.isDown("ArrowUp");
  if (ship.thrust) {
    ship.vx += Math.cos(ship.angle) * THRUST * dt;
    ship.vy += Math.sin(ship.angle) * THRUST * dt;
  }
  const drag = Math.pow(DRAG_PER_SECOND, dt);
  ship.vx *= drag;
  ship.vy *= drag;
  const speed = Math.hypot(ship.vx, ship.vy);
  if (speed > MAX_SPEED) {
    ship.vx = (ship.vx / speed) * MAX_SPEED;
    ship.vy = (ship.vy / speed) * MAX_SPEED;
  }
  ship.x += ship.vx * dt;
  ship.y += ship.vy * dt;
}
