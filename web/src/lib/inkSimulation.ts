import { readoutDestinations } from "./inkReadout";
// Persistent material particles. A shape changes the destination forces, never
// particle count, opacity, or identity. The renderer only sees transported ink.
const TAU = Math.PI * 2;
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

function capsule(x: number, y: number, ax: number, ay: number, bx: number, by: number, radius: number) {
  const dx = bx - ax, dy = by - ay;
  const t = clamp(((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy), 0, 1);
  return Math.hypot(x - ax - t * dx, y - ay - t * dy) - radius;
}

// Used only to place attraction destinations, never to hide rendered pixels.
function shapeDistance(shape: number, x: number, y: number) {
  if (shape === 4 || shape === 5) {
    // Two soft eyes and a curved mouth, all made of transported ink.
    const eyes = Math.min(Math.hypot(x + .19, y - .17) - .06,
      Math.hypot(x - .19, y - .17) - .06);
    const mouthY = shape === 4 ? -.28 + 1.8 * x * x : -.13 - 1.8 * x * x;
    const mouth = Math.hypot(Math.max(0, Math.abs(x) - .27), y - mouthY) - .035;
    const outline = Math.abs(Math.hypot(x, y) - .49) - .018;
    return Math.min(eyes, mouth, outline);
  }
  if (shape === 1) {
    return Math.min(
      Math.hypot(x, y - .20) - .32,
      capsule(x, y, 0, -.07, 0, -.23, .115),
      capsule(x, y, -.105, -.365, .105, -.365, .032),
      capsule(x, y, -.065, -.455, .065, -.455, .025),
    );
  }
  if (shape === 2) {
    return Math.min(
      capsule(x, y, 0, -.25, 0, .42, .08),
      Math.hypot(x, y + .30) - .19,
      capsule(x, y, .14, .28, .23, .28, .022),
      capsule(x, y, .14, .08, .20, .08, .022),
    );
  }
  return Math.min(
    Math.hypot((x + .20) / 1.2, (y + .30) / .85) - .115,
    Math.hypot((x - .20) / 1.2, (y + .19) / .85) - .115,
    capsule(x, y, -.085, -.27, -.085, .32, .033),
    capsule(x, y, .315, -.16, .315, .43, .033),
    capsule(x, y, -.085, .30, .315, .41, .055),
  );
}

export class InkSimulation {
  readonly positions: Float32Array;
  readonly velocities: Float32Array;
  readonly tones: Float32Array;
  readonly targets: Float32Array;
  private readonly seeds: Float32Array;
  private readonly shapes = new Map<number, Float32Array>();
  private shape = 0;
  private readout = "";

  constructor(readonly count = 6144) {
    this.positions = new Float32Array(count * 3);
    this.velocities = new Float32Array(count * 3);
    this.targets = new Float32Array(count * 3);
    this.tones = new Float32Array(count);
    this.seeds = new Float32Array(count * 4);
    let seed = 18371;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    for (let i = 0; i < count; i++) {
      this.seeds[i * 4] = (i + .5) / count;
      this.seeds[i * 4 + 1] = (i % 3) * TAU / 3;
      this.seeds[i * 4 + 2] = random() - .5;
      this.seeds[i * 4 + 3] = random() * TAU;
      this.tones[i] = .15 + (i % 3) * .3 + random() * .1;
    }
    this.updateTargets(0, 0, true);
    this.positions.set(this.targets);
    // Match nearby angular regions to reduce crossings as the fluid gathers.
    const order = Array.from({ length: count }, (_, i) => i).sort((a, b) =>
      Math.atan2(this.positions[a * 3 + 1], this.positions[a * 3]) - Math.atan2(this.positions[b * 3 + 1], this.positions[b * 3]));
    for (const shape of [1, 2, 3, 4, 5]) {
      const points: [number, number][] = [];
      while (points.length < count) {
        const x = (random() - .5) * 1.2, y = (random() - .5) * 1.2;
        const d = shapeDistance(shape, x, y);
        if (d < 0 && (d > -.035 || random() < .30)) points.push([x, y]);
      }
      points.sort((a, b) => Math.atan2(a[1], a[0]) - Math.atan2(b[1], b[0]));
      const destination = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        destination[order[i] * 3] = points[i][0];
        destination[order[i] * 3 + 1] = points[i][1];
      }
      this.shapes.set(shape, destination);
    }
  }

  setReadout(text: string) {
    if (text === this.readout) return;
    const sorted = readoutDestinations(text, this.count);
    this.readout = text;
    if (!sorted) { this.shapes.delete(6); return; }
    // Match current angular regions while preserving every particle's momentum.
    const order = Array.from({ length: this.count }, (_, i) => i).sort((a,b) =>
      Math.atan2(this.positions[a*3+1],this.positions[a*3]) - Math.atan2(this.positions[b*3+1],this.positions[b*3]));
    const target = new Float32Array(this.count * 3);
    for (let i=0;i<this.count;i++) {
      target[order[i]*3] = sorted[i*3];
      target[order[i]*3+1] = sorted[i*3+1];
    }
    this.shapes.set(6,target);
  }

  setShape(shape: number) { this.shape = this.shapes.has(shape) ? shape : 0; }

  private updateTargets(time: number, audio: number, still: boolean) {
    const destination = this.shapes.get(this.shape);
    const pulse = still ? 1 : 1 + audio * .12;
    for (let i = 0; i < this.count; i++) {
      const j = i * 3, k = i * 4;
      const phase = this.seeds[k + 3];
      if (destination) {
        const drift = still ? 0 : .009;
        this.targets[j] = destination[j] * pulse + Math.sin(time * .6 + phase) * drift;
        this.targets[j + 1] = destination[j + 1] * pulse + Math.cos(time * .5 + phase) * drift;
      } else {
        const t = this.seeds[k];
        // Broad overlapping currents fill the vessel, with a diffuse portion
        // of the same ink reaching between them and through the center.
        const diffuse = i % 5 < 2;
        const angle = (diffuse ? phase : t * 5.2 + this.seeds[k + 1])
          + time * .13 + Math.sin(time * .18 + t * TAU) * .3;
        const radius = clamp(.025 + .62 * Math.sqrt(t)
          + Math.sin(angle * 2 + time * .3) * .04
          + this.seeds[k + 2] * (diffuse ? .10 : .27), .015, .68);
        this.targets[j] = (Math.cos(angle) * radius + Math.sin(angle * 3 - time * .22) * .045) * pulse;
        this.targets[j + 1] = (Math.sin(angle) * radius * .94 + Math.cos(angle * 2 + time * .18) * .04) * pulse;
      }
    }
  }

  step(delta: number, time: number, audio: number, reducedMotion = false) {
    const dt = Math.min(Math.max(delta, 0), .05);
    this.updateTargets(reducedMotion ? 0 : time, reducedMotion ? 0 : audio, reducedMotion);
    if (reducedMotion) {
      this.positions.set(this.targets);
      this.velocities.fill(0);
      return;
    }
    // Damped advection: acceleration changes, but position and momentum survive
    // both gathering and dispersal. Substeps keep the spring stable on slow frames.
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / steps;
    for (let step = 0; step < steps; step++) {
      for (let i = 0; i < this.count; i++) {
        const j = i * 3;
        for (let axis = 0; axis < 2; axis++) {
          const k = j + axis;
          this.velocities[k] += ((this.targets[k] - this.positions[k]) * 16 - this.velocities[k] * 7) * h;
          this.positions[k] += this.velocities[k] * h;
        }
        const radius = Math.hypot(this.positions[j], this.positions[j + 1]);
        if (radius > .84) {
          this.positions[j] *= .84 / radius;
          this.positions[j + 1] *= .84 / radius;
          this.velocities[j] *= .5;
          this.velocities[j + 1] *= .5;
        }
      }
    }
  }
}
