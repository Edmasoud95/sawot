// Pure geometry for the drag-anywhere touch slider, kept out of the component
// so the mapping can be tested without a DOM.
export interface BarRect { left: number; width: number; }

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

export function fractionOf(value: number, min: number, max: number) {
  if (max <= min) return 0;
  return clamp((value - min) / (max - min), 0, 1);
}

export function valueFromPointer(clientX: number, bar: BarRect, min: number, max: number, step: number) {
  if (bar.width <= 0) return min;
  const fraction = clamp((clientX - bar.left) / bar.width, 0, 1);
  const raw = min + fraction * (max - min);
  const snapped = min + Math.round((raw - min) / step) * step;
  return clamp(Number(snapped.toFixed(6)), min, max);
}
