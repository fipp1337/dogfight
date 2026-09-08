export function createInput(target) {
  const down = new Set();
  const pressed = new Set();
  const controls = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "KeyR"]);

  function onDown(event) {
    if (!down.has(event.code)) pressed.add(event.code);
    down.add(event.code);
    if (controls.has(event.code)) event.preventDefault();
  }
  function onUp(event) {
    down.delete(event.code);
  }
  target.addEventListener("keydown", onDown);
  target.addEventListener("keyup", onUp);
  window.addEventListener("blur", () => down.clear());

  return {
    isDown: (code) => down.has(code),
    justPressed: (code) => pressed.has(code),
    endStep: () => pressed.clear(),
  };
}
