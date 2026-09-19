import "./style.css";
import { createInput } from "./input.js";
import { createLoop } from "./loop.js";
import { Ship } from "./sim/entities.js";
import { World } from "./sim/world.js";
import { setupCanvas } from "./render/canvas.js";
import { drawWorld } from "./render/draw.js";

const canvas = document.querySelector("canvas");
const screen = setupCanvas(canvas);
const input = createInput(window);
let world;
let ship;

function createWorld() {
  world = new World(screen.width, screen.height);
  ship = world.spawn(new Ship(world.safePosition()));
  world.seedAsteroids();
  const homingAsteroid = [...world.ofKind("asteroid")][0];
  homingAsteroid.components.homing = {
    targetId: ship.id,
    speed: 90,
    turn: 1.4,
  };
}

createWorld();

const loop = createLoop({
  simulate(dt) {
    if (input.justPressed("KeyR")) createWorld();
    world.width = screen.width;
    world.height = screen.height;
    world.step(dt, input);
    input.endStep();
  },
  render(alpha, stats) {
    drawWorld(screen.context, world, alpha, stats, ship);
  },
});

loop.start();
