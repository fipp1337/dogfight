import { Vector2 } from "./vector.js";

export class Entity {
  static #id = 0;

  constructor({
    pos = new Vector2(),
    vel = new Vector2(),
    angle = 0,
    radius = 10,
    kind = "entity",
  } = {}) {
    this.id = ++Entity.#id;
    this.pos = pos;
    this.previousPos = new Vector2(pos.x, pos.y);
    this.vel = vel;
    this.angle = angle;
    this.previousAngle = angle;
    this.radius = radius;
    this.kind = kind;
    this.alive = true;
    this.components = {};
  }

  update(dt) {
    this.previousPos = new Vector2(this.pos.x, this.pos.y);
    this.previousAngle = this.angle;
    this.pos.addInPlace(this.vel.scale(dt));
  }
}
