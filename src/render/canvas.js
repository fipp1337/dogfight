export function setupCanvas(canvas) {
  const context = canvas.getContext("2d");
  let width = 0;
  let height = 0;
  function resize() {
    const bounds = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    width = Math.round(bounds.width);
    height = Math.round(bounds.height);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
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
