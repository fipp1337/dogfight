export class Vector2 {
  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
  }

  add(other) {
    return new Vector2(this.x + other.x, this.y + other.y);
  }
  sub(other) {
    return new Vector2(this.x - other.x, this.y - other.y);
  }
  scale(value) {
    return new Vector2(this.x * value, this.y * value);
  }
  length() {
    return Math.hypot(this.x, this.y);
  }
  normalize() {
    const length = this.length();
    return length ? this.scale(1 / length) : new Vector2();
  }
  rotate(angle) {
    const c = Math.cos(angle),
      s = Math.sin(angle);
    return new Vector2(this.x * c - this.y * s, this.x * s + this.y * c);
  }
  dot(other) {
    return this.x * other.x + this.y * other.y;
  }
  addInPlace(other) {
    this.x += other.x;
    this.y += other.y;
    return this;
  }
  scaleInPlace(value) {
    this.x *= value;
    this.y *= value;
    return this;
  }
  static fromAngle(angle, length = 1) {
    return new Vector2(Math.cos(angle) * length, Math.sin(angle) * length);
  }
}
