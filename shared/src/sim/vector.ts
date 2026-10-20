export class Vector2 {
  constructor(
    readonly x: number,
    readonly y: number,
  ) {}

  add(other: Vector2): Vector2 {
    return new Vector2(this.x + other.x, this.y + other.y);
  }
  sub(other: Vector2): Vector2 {
    return new Vector2(this.x - other.x, this.y - other.y);
  }
  scale(value: number): Vector2 {
    return new Vector2(this.x * value, this.y * value);
  }
  length(): number {
    return Math.hypot(this.x, this.y);
  }
  normalize(): Vector2 {
    const size = this.length();
    return size === 0 ? new Vector2(0, 0) : this.scale(1 / size);
  }
  rotate(angle: number): Vector2 {
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    return new Vector2(
      this.x * cosine - this.y * sine,
      this.x * sine + this.y * cosine,
    );
  }
  dot(other: Vector2): number {
    return this.x * other.x + this.y * other.y;
  }
  static fromAngle(angle: number, magnitude = 1): Vector2 {
    return new Vector2(
      Math.cos(angle) * magnitude,
      Math.sin(angle) * magnitude,
    );
  }
}
