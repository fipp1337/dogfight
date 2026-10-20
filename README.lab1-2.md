# Dogfight — Labs 1–2

Canvas game demonstrating a fixed-timestep game loop and an entity model based on JavaScript objects, prototypes, classes, and composition.

## Run

Node 24 is expected (`.nvmrc`). In PowerShell where execution policy blocks `npm.ps1`, use:

```powershell
npm.cmd install
npm.cmd run dev
```

Controls: **← / →** rotate, **↑** thrust, **Space** fires, **R** restarts. Destroy asteroids for points; collect **R** (rapid fire) and **S** (shield) pickups. A red asteroid has the reusable homing behaviour.

## Lab 2 implementation

`Vector2` has pure operations (`add`, `sub`, `scale`, `rotate`, etc.): they return a new vector rather than changing their argument. `addInPlace` and `scaleInPlace` are deliberately named mutable hot-path alternatives.

`Entity` owns shared data (`id`, `pos`, `vel`, `angle`, `radius`, `kind`, `alive`) and its static private `#id` sequence. `Ship extends Entity` is the only inheritance relationship needed for gameplay. `Ship` keeps `#hp` private; other code can only read it with `ship.hp` and ask it to receive damage.

`World` owns `Map<id, Entity>`, is iterable, and provides lazy `ofKind(kind)`. `despawn` marks an entity dead; `World.step` updates, resolves collisions, then sweeps dead non-ship entities. This avoids altering the collection while the simulation iteration is in progress. The circle collision pass lives in `sim/collision.js` and is intentionally simple O(n²), so a spatial hash can replace it later.

## `this` bug: demonstration and fix

This is wrong:

```js
window.addEventListener("keydown", ship.fire);
```

It passes a function reference. The browser calls it with `this` set to the event target (or `undefined` in a plain strict-mode call), not the `Ship`, so `this.cooldown` and `this.alive` break.

The game fixes this by keeping the keyboard listener inside `createInput`, then calling `this.fire(world)` from `Ship.update`. This preserves implicit binding: the object to the left of the dot is the ship.

Alternatives are `() => ship.fire(world)` (clear but creates a wrapper), `ship.fire.bind(ship)` (permanently binds, but creates another function that is awkward to remove as a listener), and an arrow class field `fire = () => …` (lexically captures the instance but allocates one function per ship instead of sharing a prototype method).

## Composition instead of a class tree

The tempting inheritance design is `Entity → MovingEntity → Bullet → HomingBullet` and separately `Entity → MovingEntity → Asteroid → HomingAsteroid`; a pickup would need another incompatible branch. It duplicates behaviour and becomes brittle as soon as a new combination appears.

Instead, each entity has a `components` object. Homing is plain data:

```js
entity.components.homing = { targetId, speed, turn };
```

`updateHoming` reads that component, so it works unchanged on either a bullet or asteroid. `Pickup` is stationary but carries `components.pickup = { type, ttl }`; the collision system checks for that component rather than requiring a pickup to be a kind of ship. Ship weapons and shields use the same approach. This lets features combine without deeper `extends` chains.

## Prototype-chain diagram

```txt
ship instance → Ship.prototype → Entity.prototype → Object.prototype → null

Ship (constructor) → Entity (constructor) → Function.prototype → Object.prototype → null
```

For `ship.update`, JavaScript checks the ship's own properties, then finds `update` on `Ship.prototype`. That method calls `super.update`, which resolves to `Entity.prototype.update`. No methods are copied into each ship.

## Lab 1 notes

The loop uses `requestAnimationFrame`, a clamped 1/60 s accumulator, and interpolation between `previous` and current state. Simulation is fixed at 60 steps/s, while rendering adapts to display refresh rate and the DPR-aware canvas stays sharp on high-density displays.

### Experiments

1. A 100 ms synchronous busy wait every 60th render produces a visible jump and a roughly 100 ms frame: running JavaScript blocks input and paint on the same main thread.
2. `setInterval(frame, 16)` produces timer jitter and is throttled in a background tab; rAF is display-aligned and pauses efficiently.
3. A variable timestep changes movement under CPU throttling. Fixed 1/60 s steps replay the same inputs to the same result.
