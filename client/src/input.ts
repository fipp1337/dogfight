export interface InputState {
  isDown(code: string): boolean;
  justPressed(code: string): boolean;
  endStep(): void;
}

export function createInput(target: Window): InputState {
  const down = new Set<string>();
  const pressed = new Set<string>();
  const controls = new Set([
    "ArrowLeft",
    "ArrowRight",
    "ArrowUp",
    "Space",
    "KeyR",
  ]);
  const onDown = (event: KeyboardEvent): void => {
    if (!down.has(event.code)) pressed.add(event.code);
    down.add(event.code);
    if (controls.has(event.code)) event.preventDefault();
  };
  const onUp = (event: KeyboardEvent): void => {
    down.delete(event.code);
  };
  const onBlur = (): void => down.clear();
  target.addEventListener("keydown", onDown);
  target.addEventListener("keyup", onUp);
  target.addEventListener("blur", onBlur);
  return {
    isDown: (code) => down.has(code),
    justPressed: (code) => pressed.has(code),
    endStep: () => pressed.clear(),
  };
}
