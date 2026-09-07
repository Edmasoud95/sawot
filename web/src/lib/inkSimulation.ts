import { readoutDestinations, sketchDestinations } from "./inkReadout";
import { SHAPES } from "./inkShapes";
// Persistent material particles. A shape changes the destination forces, never
// particle count, opacity, or identity. The renderer only sees transported ink.
const TAU = Math.PI * 2;
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

// Analytic curl of a layered sine potential: cheap, smooth, and divergence-free.
// Frequencies stay low so the displacement never creases the flow into a fold
// (a fold appears once amplitude × frequency approaches one).
function curl(x: number, y: number, t: number): [number, number] {
  const p1 = 1.6 * x + t * .21, q1 = 1.3 * y - t * .17;
  const p2 = 2.1 * y + 1.4 * x + t * .29;
  const p3 = 2.6 * x - 1.9 * y - t * .37;
  const dx = 1.6 * Math.cos(p1) * Math.cos(q1) + 1.4 * Math.cos(p2) * .55 - 2.6 * Math.sin(p3) * .28;
  const dy = -1.3 * Math.sin(p1) * Math.sin(q1) + 2.1 * Math.cos(p2) * .55 + 1.9 * Math.sin(p3) * .28;
  // Normalised so the field peaks near one unit of displacement.
  return [dy * .32, -dx * .32];
}

export class InkSimulation {
  readonly positions: Float32Array;
  readonly velocities: Float32Array;
  readonly tones: Float32Array;
  readonly sizes: Float32Array;
  // Per-particle ink weight the renderer multiplies into mass. Ambient ink
  // fades toward a haze while a symbol is shown so the shape stays legible.
  readonly weights: Float32Array;
  // Thinking: 0..1 share of each particle acting as a wandering spark, and
  // the smoothed level of the churn itself.
  readonly sparks: Float32Array;
  private thinkingTarget = 0;
  private thinking = 0;
  readonly targets: Float32Array;
  private readonly seeds: Float32Array;
  private readonly shapes = new Map<string, Float32Array>();
  // Per-shape contour tangents so formed ink can circulate along the symbol.
  private readonly flows = new Map<string, Float32Array>();
  // Which particles gather into a symbol; the rest stay as ambient flow.
  private readonly symbolIndex: Int32Array;
  private readonly isSymbol: Uint8Array;
  private shape = "";
  private readout = "";
  private sketch: number[][] | null = null;
  private previousAudio = 0;

  constructor(readonly count = 6144) {
    this.positions = new Float32Array(count * 3);
    this.velocities = new Float32Array(count * 3);
    this.targets = new Float32Array(count * 3);
    this.tones = new Float32Array(count);
    this.sizes = new Float32Array(count);
    this.weights = new Float32Array(count).fill(1);
    this.sparks = new Float32Array(count);
    this.seeds = new Float32Array(count * 4);
    let seed = 18371;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    for (let i = 0; i < count; i++) {
      this.seeds[i * 4] = (i + .5) / count;
      this.seeds[i * 4 + 1] = (i % 3) * TAU / 3;
      this.seeds[i * 4 + 2] = random() - .5;
      this.seeds[i * 4 + 3] = random() * TAU;
      this.tones[i] = .15 + (i % 3) * .3 + random() * .1;
      // Three tiers tied to flow roles: diffuse ink is a few soft bodies and
      // mid-weight wisps; the currents are made of fine, dense filaments.
      const role = i % 5;
      this.sizes[i] = (role === 0 ? 1 : role === 1 ? .62 : .38) + (random() - .5) * .04;
    }
    // Roughly 45% of the ink forms a symbol; a spread-out selection keeps the
    // gathering even across the vessel.
    this.isSymbol = new Uint8Array(count);
    const symbolList: number[] = [];
    for (let i = 0; i < count; i++) if (i % 20 < 9) { this.isSymbol[i] = 1; symbolList.push(i); }
    this.symbolIndex = Int32Array.from(symbolList);
    this.updateTargets(0, 0, true);
    this.positions.set(this.targets);
  }

  // Catalogue shapes are sampled on first use and cached. Soft edge: density
  // falls off smoothly from the outline, with a light translucent fill and a
  // little ink just outside the contour.
  private buildShape(name: string) {
    const distance = SHAPES[name];
    let seed = 90211 + name.length * 7919;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const order = this.symbolOrder();
    const n = order.length;
    const points: [number, number][] = [];
    let guard = 0;
    while (points.length < n && guard++ < n * 400) {
      const x = (random() - .5) * 1.2, y = (random() - .5) * 1.2;
      const d = distance(x, y);
      const weight = d < 0 ? .22 + .78 * Math.exp(-((d / .045) ** 2)) : .6 * Math.exp(-((d / .018) ** 2));
      if (random() < weight) points.push([x, y]);
    }
    while (points.length < n) points.push(points[points.length % Math.max(1, points.length)] ?? [0, 0]);
    points.sort((a, b) => Math.atan2(a[1], a[0]) - Math.atan2(b[1], b[0]));
    const destination = new Float32Array(this.count * 3);
    const flow = new Float32Array(this.count * 2);
    for (let i = 0; i < n; i++) {
      const j = order[i], [x, y] = points[i];
      destination[j * 3] = x;
      destination[j * 3 + 1] = y;
      // Contour tangent from the distance field gradient, rotated 90°.
      const e = .004;
      const gx = distance(x + e, y) - distance(x - e, y);
      const gy = distance(x, y + e) - distance(x, y - e);
      const g = Math.hypot(gx, gy) || 1;
      flow[j * 2] = -gy / g;
      flow[j * 2 + 1] = gx / g;
    }
    this.shapes.set(name, destination);
    this.flows.set(name, flow);
  }

  // Symbol particles sorted by current angle, so nearby ink takes nearby
  // destinations and crossings stay rare as the fluid gathers.
  private symbolOrder() {
    return Array.from(this.symbolIndex).sort((a, b) =>
      Math.atan2(this.positions[a * 3 + 1], this.positions[a * 3]) - Math.atan2(this.positions[b * 3 + 1], this.positions[b * 3]));
  }

  setReadout(text: string) {
    if (text === this.readout) return;
    const sorted = readoutDestinations(text, this.symbolIndex.length);
    this.readout = text;
    if (!sorted) { this.shapes.delete("readout"); this.flows.delete("readout"); return; }
    // Match current angular regions while preserving every particle's momentum.
    const order = this.symbolOrder();
    const target = new Float32Array(this.count * 3);
    const flow = new Float32Array(this.count * 2);
    for (let i = 0; i < order.length; i++) {
      const j = order[i];
      target[j * 3] = sorted[i * 3];
      target[j * 3 + 1] = sorted[i * 3 + 1];
      // The builder stores the stroke direction in the third slot.
      flow[j * 2] = Math.cos(sorted[i * 3 + 2]);
      flow[j * 2 + 1] = Math.sin(sorted[i * 3 + 2]);
    }
    this.shapes.set("readout", target);
    this.flows.set("readout", flow);
  }

  setSketch(strokes: number[][] | null) {
    if (strokes === this.sketch) return;
    this.sketch = strokes;
    const sorted = strokes ? sketchDestinations(strokes, this.symbolIndex.length) : null;
    if (!sorted) { this.shapes.delete("sketch"); this.flows.delete("sketch"); return; }
    const order = this.symbolOrder();
    const target = new Float32Array(this.count * 3);
    const flow = new Float32Array(this.count * 2);
    for (let i = 0; i < order.length; i++) {
      const j = order[i];
      target[j * 3] = sorted[i * 3];
      target[j * 3 + 1] = sorted[i * 3 + 1];
      flow[j * 2] = Math.cos(sorted[i * 3 + 2]);
      flow[j * 2 + 1] = Math.sin(sorted[i * 3 + 2]);
    }
    this.shapes.set("sketch", target);
    this.flows.set("sketch", flow);
  }

  /** 0..1: how hard the model is thinking. Ramps in over ~1 s. */
  setThinking(level: number) { this.thinkingTarget = clamp(level, 0, 1); }

  // Catalogue names build lazily; "readout" and "sketch" need their data set
  // first; anything else releases the ink back into free flow.
  setShape(shape: string) {
    if (shape && !this.shapes.has(shape) && Object.prototype.hasOwnProperty.call(SHAPES, shape)) this.buildShape(shape);
    this.shape = this.shapes.has(shape) ? shape : "";
  }

  private updateTargets(time: number, audio: number, still: boolean) {
    const destination = this.shapes.get(this.shape);
    const flow = this.flows.get(this.shape);
    const pulse = still ? 1 : 1 + audio * .12;
    for (let i = 0; i < this.count; i++) {
      const j = i * 3, k = i * 4;
      const phase = this.seeds[k + 3];
      if (destination && flow && this.isSymbol[i]) {
        // Formed ink keeps living: it slides back and forth along the contour
        // and breathes a little across it, so the symbol never sets rigid.
        const along = still ? 0 : Math.sin(time * .55 + phase) * .022;
        const across = still ? 0 : Math.sin(time * .9 + phase * 1.7) * .006;
        const tx = flow[i * 2], ty = flow[i * 2 + 1];
        this.targets[j] = destination[j] * pulse + tx * along - ty * across;
        this.targets[j + 1] = destination[j + 1] * pulse + ty * along + tx * across;
      } else {
        const t = this.seeds[k];
        // Broad overlapping currents fill the vessel, with a diffuse portion
        // of the same ink reaching between them and through the centre. A
        // large-scale curl field then folds the whole body into organic
        // masses and dark voids rather than regular rings.
        const diffuse = i % 5 < 2;
        // The innermost particles would otherwise share one structured angle
        // and line up into a spoke at the centre, so their angle is random.
        // Strands ride three spiral arms; the gaps between them are the dark
        // voids. Angular scatter grows toward the centre so the arms blur where
        // they would otherwise converge into one dense ridge.
        const inner = Math.min(1, t / .08);
        const scatter = (phase / TAU - .5) * (1.6 - 1.2 * t);
        const angle = (diffuse ? phase : (t * 5.2 + this.seeds[k + 1] + scatter) * inner + phase * (1 - inner))
          + time * .13 + Math.sin(time * .18 + t * TAU) * .3;
        let radius = clamp(.05 + .60 * Math.sqrt(t)
          + Math.sin(angle * 2 + time * .3) * .04
          + this.seeds[k + 2] * (diffuse ? .10 : .27), .015, .68);
        // While a symbol is shown, ambient ink withdraws into a thin current
        // near the rim so the vessel stays alive without crowding the shape.
        const withdraw = destination ? 1 : 0;
        radius = radius + (.52 + radius * .46 - radius) * withdraw;
        const bx = Math.cos(angle) * radius + Math.sin(angle * 3 - time * .22) * .045;
        const by = Math.sin(angle) * radius * .94 + Math.cos(angle * 2 + time * .18) * .04;
        // A divergence-free curl field bends the currents into drifting
        // vortices, so strands fold and eddy rather than circle in rings.
        const [cx, cy] = curl(bx, by, time);
        const swirl = .22 - .14 * withdraw;
        let tx = (bx + cx * swirl) * pulse;
        let ty = (by + cy * swirl) * pulse;
        const think = this.thinking * (1 - withdraw);
        if (think > 0) {
          // A slow stir: the whole body turns about the centre, faster near
          // the middle, so the ink reads as being worked rather than idling.
          const r = Math.hypot(tx, ty) || 1;
          const turn = time * .55 * think * (1.15 - r * .6);
          const c = Math.cos(turn), sn = Math.sin(turn);
          const rx = tx * c - ty * sn, ry = tx * sn + ty * c;
          tx = rx; ty = ry;
          // Wandering sparks: a few filaments leave the strands and drift in
          // slow loops through the voids, then settle back when thinking ends.
          const spark = this.sparks[i];
          if (spark > 0) {
            const loop = time * .9 + phase * 3;
            const sx = Math.cos(loop) * .28 + Math.sin(loop * .37 + phase) * .18;
            const sy = Math.sin(loop * 1.3 + phase) * .28 + Math.cos(loop * .41) * .18;
            tx += (sx - tx) * spark;
            ty += (sy - ty) * spark;
          }
        }
        this.targets[j] = tx;
        this.targets[j + 1] = ty;
      }
    }
  }

  step(delta: number, time: number, audio: number, reducedMotion = false) {
    const dt = Math.min(Math.max(delta, 0), .05);
    this.updateTargets(reducedMotion ? 0 : time, reducedMotion ? 0 : audio, reducedMotion);
    const showing = this.shape !== "" && this.shapes.has(this.shape);
    const fade = reducedMotion ? 1 : 1 - Math.exp(-dt * 3.5);
    // Reduced motion keeps the palette but never stirs or scatters the ink.
    const thinkGoal = reducedMotion ? 0 : this.thinkingTarget;
    this.thinking += (thinkGoal - this.thinking) * (1 - Math.exp(-dt * 2.5));
    for (let i = 0; i < this.count; i++) {
      // Fine filaments only (roles 2-4), about 8% of the ink overall.
      const eligible = i % 5 >= 2 && i % 12 === 0 ? 1 : 0;
      const goal = eligible * (this.thinking > .5 ? 1 : 0);
      this.sparks[i] += (goal - this.sparks[i]) * (1 - Math.exp(-dt * 1.8));
    }
    for (let i = 0; i < this.count; i++) {
      // Thinking thins the body a little and lights the sparks, so the
      // wandering filaments read against the churn.
      const spark = this.sparks[i];
      const goal = showing && !this.isSymbol[i] ? .28 : 1 - this.thinking * .3 + spark * 1.6;
      this.weights[i] += (goal - this.weights[i]) * fade;
    }
    if (reducedMotion) {
      this.positions.set(this.targets);
      this.velocities.fill(0);
      this.previousAudio = 0;
      return;
    }
    // A sharp rise in level is a syllable onset: kick the ink outward with a
    // slight tangential swirl so speech ripples through the material rather
    // than merely scaling it. Quadratic response keeps small tremors quiet.
    const onset = Math.max(0, audio - this.previousAudio);
    this.previousAudio = audio;
    if (onset > .08) {
      const impulse = onset * onset * .7;
      for (let i = 0; i < this.count; i++) {
        const j = i * 3, x = this.positions[j], y = this.positions[j + 1];
        const r = Math.hypot(x, y) || 1;
        const weight = impulse * (.6 + this.seeds[i * 4 + 2] * .8) * Math.min(1, r * 2.2);
        this.velocities[j] += (x / r * .85 - y / r * .35) * weight;
        this.velocities[j + 1] += (y / r * .85 + x / r * .35) * weight;
      }
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
