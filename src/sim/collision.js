export function circleCollisions(world) {
  const entities = [...world].filter(
    (entity) => entity.alive && entity.radius > 0,
  );
  const pairs = [];
  for (let i = 0; i < entities.length; i += 1) {
    for (let j = i + 1; j < entities.length; j += 1) {
      const a = entities[i],
        b = entities[j];
      const dx = a.pos.x - b.pos.x,
        dy = a.pos.y - b.pos.y;
      const radius = a.radius + b.radius;
      if (dx * dx + dy * dy <= radius * radius) pairs.push([a, b]);
    }
  }
  return pairs;
}
