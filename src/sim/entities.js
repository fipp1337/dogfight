import { Entity } from "./entity.js";
import { Vector2 } from "./vector.js";

const SHIP_TURN_SPEED = 3.8;
const SHIP_THRUST = 420;
const SHIP_DRAG = 0.72;
const SHIP_MAX_SPEED = 310;

export class Ship extends Entity {
  #hp = 100;

  constructor(pos) {
    super({ pos, angle: -Math.PI / 2, radius: 15, kind: "ship" });
    this.cooldown = 0;
    this.respawnAt = 0;
    this.invulnerableUntil = 0;
    this.thrust = false;
    this.components.weapon = { cooldown: 0.22, rapidFireUntil: 0 };
    this.components.shield = { until: 0 };
  }

  get hp() {
    return this.#hp;
  }

  damage(amount, world) {
    if (
      !this.alive ||
      world.time < this.invulnerableUntil ||
      world.time < this.components.shield.until
    )
      return false;
    this.#hp = Math.max(0, this.#hp - amount);
    if (this.#hp === 0) this.destroy(world);
    return true;
  }

  destroy(world) {
    this.alive = false;
    this.respawnAt = world.time + 2;
    world.spawn(new Explosion(this.pos));
  }

  respawn(world) {
    this.alive = true;
    this.#hp = 100;
    this.pos = world.safePosition();
    this.previousPos = new Vector2(this.pos.x, this.pos.y);
    this.vel = new Vector2();
    this.invulnerableUntil = world.time + 1;
  }

  fire(world) {
    if (!this.alive || world.time < this.cooldown) return;
    const forward = Vector2.fromAngle(this.angle);
    const nose = this.pos.add(forward.scale(this.radius + 7));
    world.spawn(
      new Bullet(nose, this.vel.add(forward.scale(510)), this.angle, this.id),
    );
    const interval =
      world.time < this.components.weapon.rapidFireUntil
        ? 0.1
        : this.components.weapon.cooldown;
    this.cooldown = world.time + interval;
  }

  update(dt, world, input) {
    super.update(dt);
    if (!this.alive) {
      if (world.time >= this.respawnAt) this.respawn(world);
      return;
    }
    const turn =
      Number(input.isDown("ArrowRight")) - Number(input.isDown("ArrowLeft"));
    this.angle += turn * SHIP_TURN_SPEED * dt;
    this.thrust = input.isDown("ArrowUp");
    if (this.thrust)
      this.vel.addInPlace(Vector2.fromAngle(this.angle, SHIP_THRUST * dt));
    this.vel.scaleInPlace(Math.pow(SHIP_DRAG, dt));
    if (this.vel.length() > SHIP_MAX_SPEED)
      this.vel = this.vel.normalize().scale(SHIP_MAX_SPEED);
    if (input.isDown("Space")) this.fire(world);
    world.wrap(this);
  }
}

export class Bullet extends Entity {
  constructor(pos, vel, angle, ownerId) {
    super({ pos, vel, angle, radius: 4, kind: "bullet" });
    this.ownerId = ownerId;
    this.ttl = 1.35;
    this.damage = 34;
  }

  update(dt, world) {
    super.update(dt);
    this.ttl -= dt;
    if (this.ttl <= 0) this.alive = false;
    updateHoming(this, world, dt);
    world.wrap(this);
  }
}

export class Asteroid extends Entity {
  constructor(pos, vel, radius = 26) {
    super({ pos, vel, radius, kind: "asteroid" });
    this.hp = radius > 30 ? 100 : 68;
    this.spin = (Math.random() - 0.5) * 1.4;
  }

  damage(amount, world) {
    this.hp -= amount;
    if (this.hp <= 0) {
      this.alive = false;
      world.score += 100;
      world.spawn(new Explosion(this.pos));
    }
  }

  update(dt, world) {
    super.update(dt);
    this.angle += this.spin * dt;
    updateHoming(this, world, dt);
    world.bounce(this);
  }
}

export class Pickup extends Entity {
  constructor(pos, type = "rapid") {
    super({ pos, radius: 13, kind: "pickup" });
    this.components.pickup = { type, ttl: 11 };
  }

  update(dt) {
    this.components.pickup.ttl -= dt;
    if (this.components.pickup.ttl <= 0) this.alive = false;
  }
}

export class Explosion extends Entity {
  constructor(pos) {
    super({ pos: new Vector2(pos.x, pos.y), radius: 0, kind: "explosion" });
    this.ttl = 0.55;
    this.particles = Array.from({ length: 18 }, () => ({
      pos: new Vector2(pos.x, pos.y),
      vel: Vector2.fromAngle(
        Math.random() * Math.PI * 2,
        50 + Math.random() * 130,
      ),
    }));
  }

  update(dt) {
    this.ttl -= dt;
    for (const particle of this.particles)
      particle.pos.addInPlace(particle.vel.scale(dt));
    if (this.ttl <= 0) this.alive = false;
  }
}

// Homing is a component: this same function works for bullets and asteroids.
function updateHoming(entity, world, dt) {
  const homing = entity.components.homing;
  if (!homing) return;
  const target = world.get(homing.targetId);
  if (!target?.alive) return;
  const desired = target.pos.sub(entity.pos).normalize().scale(homing.speed);
  entity.vel = entity.vel
    .scale(1 - homing.turn * dt)
    .add(desired.scale(homing.turn * dt));
  entity.angle = Math.atan2(entity.vel.y, entity.vel.x);
}
