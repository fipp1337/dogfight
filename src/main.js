import "./style.css";
import { createInput } from "./input.js";
import { createLoop } from "./loop.js";
import { wrap } from "./sim/arena.js";
import { copyShip, createShip, integrate } from "./sim/ship.js";
import { setupCanvas } from "./render/canvas.js";
import { drawBackground, drawHud, drawShip } from "./render/draw.js";

const canvas = document.querySelector("canvas");
const screen = setupCanvas(canvas);
const input = createInput(window);
let current = createShip(screen.width / 2, screen.height / 2);
let previous = copyShip(current);

function reset() {
  current = createShip(screen.width / 2, screen.height / 2);
  previous = copyShip(current);
}

const loop = createLoop({
  simulate(dt) {
    if (input.justPressed("KeyR")) reset();
    previous = copyShip(current);
    integrate(current, input, dt);
    wrap(current, screen.width, screen.height);
    input.endStep();
  },
  render(alpha, stats) {
    drawBackground(screen.context, screen.width, screen.height);
    drawShip(screen.context, previous, current, alpha);
    drawHud(screen.context, stats);
  },
});

loop.start();
