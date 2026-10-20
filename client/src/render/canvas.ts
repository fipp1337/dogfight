export interface CanvasScreen {
  context: CanvasRenderingContext2D;
  readonly width: number;
  readonly height: number;
}

export function setupCanvas(canvas: HTMLCanvasElement): CanvasScreen {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D is unavailable in this browser.");
  let width = 0;
  let height = 0;
  const resize = (): void => {
    const bounds = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    width = Math.round(bounds.width);
    height = Math.round(bounds.height);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
  };
  window.addEventListener("resize", resize);
  resize();
  return {
    context,
    get width() {
      return width;
    },
    get height() {
      return height;
    },
  };
}
