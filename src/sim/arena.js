export function wrap(ship, width, height, margin = 18) {
  if (ship.x < -margin) ship.x = width + margin;
  if (ship.x > width + margin) ship.x = -margin;
  if (ship.y < -margin) ship.y = height + margin;
  if (ship.y > height + margin) ship.y = -margin;
}
