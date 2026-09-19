import { circleCollisions } from "./collision.js";
import { Asteroid, Pickup } from "./entities.js";
import { Vector2 } from "./vector.js";

export class World {
  #entities = new Map();

  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.time = 0;
    this.score = 0;
  }

  spawn(entity) {
    this.#entities.set(entity.id, entity);
    return entity;
  }
  despawn(id) {
    const entity = this.get(id);
    if (entity) entity.alive = false;
  }
  get(id) {
    return this.#entities.get(id);
  }
  *[Symbol.iterator]() {
    yield* this.#entities.values();
  }
  *ofKind(kind) {
    for (const entity of this) if (entity.kind === kind) yield entity;
  }

  step(dt, input) {
    this.time += dt;
    for (const entity of this) entity.update(dt, this, input);
    for (const [a, b] of circleCollisions(this)) this.resolveCollision(a, b);
    for (const [id, entity] of this.#entities)
      if (!entity.alive && entity.kind !== "ship") this.#entities.delete(id);
    if (Math.floor(this.time / 7) !== Math.floor((this.time - dt) / 7))
      this.spawnPickup();
  }

  resolveCollision(a, b) {
    const [bullet, target] =
      a.kind === "bullet"
        ? [a, b]
        : b.kind === "bullet"
          ? [b, a]
          : [null, null];
    if (
      bullet &&
      target &&
      bullet.ownerId !== target.id &&
      ["ship", "asteroid"].includes(target.kind)
    ) {
      bullet.alive = false;
      if (target.damage) target.damage(bullet.damage, this);
      return;
    }
    const [ship, pickup] =
      a.kind === "ship" ? [a, b] : b.kind === "ship" ? [b, a] : [null, null];
    if (ship?.alive && pickup?.components.pickup) {
      const { type } = pickup.components.pickup;
      if (type === "shield") ship.components.shield.until = this.time + 5;
      else ship.components.weapon.rapidFireUntil = this.time + 5;
      pickup.alive = false;
      this.score += 25;
    }
    const asteroid =
      a.kind === "asteroid" ? a : b.kind === "asteroid" ? b : null;
    if (ship?.alive && asteroid) ship.damage(20, this);
  }

  safePosition() {
    for (let i = 0; i < 20; i += 1) {
      const pos = new Vector2(
        80 + Math.random() * (this.width - 160),
        80 + Math.random() * (this.height - 160),
      );
      if (
        [...this].every(
          (entity) =>
            !entity.alive ||
            entity.radius === 0 ||
            entity.pos.sub(pos).length() > entity.radius + 100,
        )
      )
        return pos;
    }
    return new Vector2(this.width / 2, this.height / 2);
  }

  wrap(entity) {
    const margin = entity.radius;
    if (entity.pos.x < -margin) entity.pos.x = this.width + margin;
    if (entity.pos.x > this.width + margin) entity.pos.x = -margin;
    if (entity.pos.y < -margin) entity.pos.y = this.height + margin;
    if (entity.pos.y > this.height + margin) entity.pos.y = -margin;
  }

  bounce(entity) {
    if (
      entity.pos.x < entity.radius ||
      entity.pos.x > this.width - entity.radius
    )
      entity.vel.x *= -1;
    if (
      entity.pos.y < entity.radius ||
      entity.pos.y > this.height - entity.radius
    )
      entity.vel.y *= -1;
    entity.pos.x = Math.max(
      entity.radius,
      Math.min(this.width - entity.radius, entity.pos.x),
    );
    entity.pos.y = Math.max(
      entity.radius,
      Math.min(this.height - entity.radius, entity.pos.y),
    );
  }

  spawnPickup() {
    this.spawn(
      new Pickup(this.safePosition(), Math.random() < 0.5 ? "shield" : "rapid"),
    );
  }
  seedAsteroids() {
    for (let i = 0; i < 6; i += 1)
      this.spawn(
        new Asteroid(
          this.safePosition(),
          Vector2.fromAngle(
            Math.random() * Math.PI * 2,
            24 + Math.random() * 36,
          ),
          20 + Math.random() * 18,
        ),
      );
  }
}
