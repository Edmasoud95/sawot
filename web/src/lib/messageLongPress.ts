export type MessageMenuPoint = { x: number; y: number };

export function createMessageLongPress(open: (point: MessageMenuPoint) => void, timers = {
  schedule: (callback: () => void) => window.setTimeout(callback, 450),
  cancel: (id: number) => window.clearTimeout(id),
}) {
  let start: MessageMenuPoint | undefined;
  let timer: number | undefined;
  const cancel = () => {
    if (timer !== undefined) timers.cancel(timer);
    timer = undefined;
    start = undefined;
  };
  return {
    cancel,
    start(x: number, y: number) {
      cancel();
      start = { x, y };
      timer = timers.schedule(() => {
        const point = start;
        timer = undefined;
        start = undefined;
        if (point) open(point);
      });
    },
    move(x: number, y: number) {
      if (start && Math.hypot(x - start.x, y - start.y) > 10) cancel();
    },
  };
}

export function placeMessageMenu(point: MessageMenuPoint, width: number, height: number,
  viewport: { left: number; top: number; width: number; height: number }) {
  const padding = 12;
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));
  const below = point.y + 18;
  return {
    left: clamp(point.x - width / 2, viewport.left + padding, viewport.left + viewport.width - width - padding),
    top: clamp(below + height <= viewport.top + viewport.height - padding ? below : point.y - height - 18,
      viewport.top + padding, viewport.top + viewport.height - height - padding),
  };
}
