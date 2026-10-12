type Options = { stiffness?: number; damping?: number; request?: (callback: FrameRequestCallback) => number; cancel?: (id: number) => void };
/** A finite spring: retargets with current momentum, no React renders or idle frames. */
export function createSpring(initial: number, draw: (value: number) => void, options: Options = {}) {
  const { stiffness = 510, damping = 29, request = requestAnimationFrame, cancel = cancelAnimationFrame } = options;
  let position = initial, velocity = 0, target = initial, last = 0;
  let frame: number | undefined;
  let disposed = false;
  const tick = (now: number) => {
    frame = undefined;
    let remaining = last ? Math.min((now - last) / 1000, .032) : 1 / 60;
    last = now;
    while (remaining > 0) {
      const dt = Math.min(remaining, 1 / 240);
      velocity += (stiffness * (target - position) - damping * velocity) * dt;
      position += velocity * dt;
      remaining -= dt;
    }
    const settled = Math.abs(position - target) < .0005 && Math.abs(velocity) < .001;
    if (settled) { position = target; velocity = 0; last = 0; }
    draw(position);
    if (!settled) frame = request(tick);
  };
  const stop = () => { if (frame !== undefined) cancel(frame); frame = undefined; last = 0; };
  return {
    to(value: number, instant = false) {
      if (disposed) return;
      target = value;
      if (instant) { stop(); position = value; velocity = 0; draw(position); }
      else if (frame === undefined) frame = request(tick);
    },
    dispose() { disposed = true; stop(); },
  };
}
