// Vector stroke destinations for readouts and free sketches: never a text
// overlay or visibility mask. Every point is a place ink travels to.

// Glyphs are polylines in a unit cell (x right, y up). Widths are cell units.
type Glyph = { w: number; strokes: number[][] };
const O = [[.25, 0, .75, 0, 1, .25, 1, .75, .75, 1, .25, 1, 0, .75, 0, .25, .25, 0]];
const P = [[0, 0, 0, 1, .7, 1, .9, .85, .9, .65, .7, .5, 0, .5]];
const dot = (cx: number, cy: number, r: number) => {
  const s: number[] = [];
  for (let i = 0; i <= 8; i++) s.push(cx + Math.cos(i * Math.PI / 4) * r, cy + Math.sin(i * Math.PI / 4) * r);
  return s;
};
const FONT: Record<string, Glyph> = {
  A: { w: 1, strokes: [[0, 0, .5, 1, 1, 0], [.2, .4, .8, .4]] },
  B: { w: .9, strokes: [[0, 0, 0, 1, .65, 1, .85, .85, .85, .65, .65, .5, 0, .5], [.65, .5, .9, .35, .9, .15, .65, 0, 0, 0]] },
  C: { w: 1, strokes: [[1, .85, .75, 1, .25, 1, 0, .8, 0, .2, .25, 0, .75, 0, 1, .15]] },
  D: { w: .9, strokes: [[0, 0, 0, 1, .6, 1, .9, .8, .9, .2, .6, 0, 0, 0]] },
  E: { w: .9, strokes: [[.9, 1, 0, 1, 0, 0, .9, 0], [0, .5, .7, .5]] },
  F: { w: .9, strokes: [[.9, 1, 0, 1, 0, 0], [0, .5, .7, .5]] },
  G: { w: 1, strokes: [[1, .85, .75, 1, .25, 1, 0, .8, 0, .2, .25, 0, .75, 0, 1, .2, 1, .45, .6, .45]] },
  H: { w: 1, strokes: [[0, 0, 0, 1], [1, 0, 1, 1], [0, .5, 1, .5]] },
  I: { w: .3, strokes: [[.15, 0, .15, 1]] },
  J: { w: 1, strokes: [[1, 1, 1, .25, .75, 0, .25, 0, 0, .25]] },
  K: { w: 1, strokes: [[0, 0, 0, 1], [1, 1, 0, .45], [.3, .6, 1, 0]] },
  L: { w: .9, strokes: [[0, 1, 0, 0, .9, 0]] },
  M: { w: 1.1, strokes: [[0, 0, 0, 1, .55, .45, 1.1, 1, 1.1, 0]] },
  N: { w: 1, strokes: [[0, 0, 0, 1, 1, 0, 1, 1]] },
  O: { w: 1, strokes: O },
  P: { w: .9, strokes: P },
  Q: { w: 1, strokes: [...O, [.65, .3, 1.05, -.05]] },
  R: { w: .9, strokes: [...P, [.5, .5, .95, 0]] },
  S: { w: 1, strokes: [[1, .85, .75, 1, .25, 1, 0, .8, .25, .55, .75, .45, 1, .2, .75, 0, .25, 0, 0, .15]] },
  T: { w: 1, strokes: [[0, 1, 1, 1], [.5, 1, .5, 0]] },
  U: { w: 1, strokes: [[0, 1, 0, .25, .25, 0, .75, 0, 1, .25, 1, 1]] },
  V: { w: 1, strokes: [[0, 1, .5, 0, 1, 1]] },
  W: { w: 1.2, strokes: [[0, 1, .3, 0, .6, .6, .9, 0, 1.2, 1]] },
  X: { w: 1, strokes: [[0, 0, 1, 1], [0, 1, 1, 0]] },
  Y: { w: 1, strokes: [[0, 1, .5, .5, 1, 1], [.5, .5, .5, 0]] },
  Z: { w: 1, strokes: [[0, 1, 1, 1, 0, 0, 1, 0]] },
  "0": { w: 1, strokes: O },
  "1": { w: .6, strokes: [[.15, .8, .45, 1, .45, 0]] },
  "2": { w: 1, strokes: [[0, .8, .25, 1, .75, 1, 1, .8, 1, .6, 0, 0, 1, 0]] },
  "3": { w: 1, strokes: [[0, .85, .25, 1, .75, 1, 1, .8, 1, .6, .7, .5, 1, .4, 1, .2, .75, 0, .25, 0, 0, .15]] },
  "4": { w: 1, strokes: [[.8, 0, .8, 1, 0, .3, 1, .3]] },
  "5": { w: 1, strokes: [[1, 1, 0, 1, 0, .55, .7, .6, 1, .4, 1, .2, .75, 0, .25, 0, 0, .15]] },
  "6": { w: 1, strokes: [[1, .85, .75, 1, .25, 1, 0, .75, 0, .2, .25, 0, .75, 0, 1, .2, 1, .4, .75, .55, .25, .55, 0, .4]] },
  "7": { w: 1, strokes: [[0, 1, 1, 1, .4, 0]] },
  "8": { w: 1, strokes: [[.5, .5, .25, .6, .25, .85, .5, 1, .75, .85, .75, .6, .5, .5, .2, .4, .2, .15, .5, 0, .8, .15, .8, .4, .5, .5]] },
  "9": { w: 1, strokes: [[0, .15, .25, 0, .75, 0, 1, .25, 1, .8, .75, 1, .25, 1, 0, .8, 0, .6, .25, .45, .75, .45, 1, .6]] },
  ".": { w: .3, strokes: [dot(.15, .06, .06)] },
  ":": { w: .3, strokes: [dot(.15, .25, .06), dot(.15, .75, .06)] },
  "-": { w: .7, strokes: [[.05, .5, .65, .5]] },
  "°": { w: .5, strokes: [dot(.25, .85, .13)] },
  "%": { w: 1, strokes: [[0, 0, 1, 1], dot(.2, .78, .16), dot(.8, .22, .16)] },
  "/": { w: .7, strokes: [[0, 0, .7, 1]] },
  " ": { w: .5, strokes: [] },
};

const GAP = .22;
const ASPECT = .64; // glyph width relative to height

type Stroke = [number, number, number, number];

function lineStrokes(line: string, y0: number, height: number): Stroke[] | null {
  const glyphs = [...line].map((c) => FONT[c]);
  if (glyphs.some((g) => !g)) return null;
  const total = glyphs.reduce((a, g) => a + g.w, 0) * ASPECT + GAP * (glyphs.length - 1);
  const scale = height;
  let left = -total * scale / 2;
  const strokes: Stroke[] = [];
  for (const g of glyphs) {
    for (const s of g.strokes) {
      for (let i = 0; i + 3 < s.length; i += 2) {
        strokes.push([left + s[i] * scale * ASPECT, y0 + s[i + 1] * scale, left + s[i + 2] * scale * ASPECT, y0 + s[i + 3] * scale]);
      }
    }
    left += (g.w * ASPECT + GAP) * scale;
  }
  return strokes;
}

function lineWidthUnits(line: string) {
  const glyphs = [...line].map((c) => FONT[c]);
  return glyphs.reduce((a, g) => a + (g?.w ?? 1), 0) * ASPECT + GAP * (glyphs.length - 1);
}

// Short values and words. Longer text wraps once at the space nearest the middle.
export function readoutDestinations(text: string, count: number): Float32Array | null {
  const clean = text.trim().toUpperCase();
  if (!clean || clean.length > 12) return null;
  let lines = [clean];
  if (clean.length > 6 && clean.includes(" ")) {
    const spaces = [...clean].map((c, i) => c === " " ? i : -1).filter((i) => i >= 0);
    const split = spaces.reduce((best, i) => Math.abs(i - clean.length / 2) < Math.abs(best - clean.length / 2) ? i : best, spaces[0]);
    lines = [clean.slice(0, split), clean.slice(split + 1)].filter(Boolean);
  }
  const widest = Math.max(...lines.map(lineWidthUnits));
  const height = Math.min(.34, 1.02 / widest, lines.length > 1 ? .3 : .34);
  const lineGap = height * .45;
  const totalHeight = lines.length * height + (lines.length - 1) * lineGap;
  const strokes: Stroke[] = [];
  for (let i = 0; i < lines.length; i++) {
    const y0 = totalHeight / 2 - height - i * (height + lineGap);
    const part = lineStrokes(lines[i], y0, height);
    if (!part) return null;
    strokes.push(...part);
  }
  return strokeDestinations(strokes, count);
}

// Free sketches from the model: polylines in a unit square (y up), mapped to
// the vessel. Validation happened upstream; this only clamps and lays out.
export function sketchDestinations(strokes: number[][], count: number): Float32Array | null {
  const segments: Stroke[] = [];
  for (const s of strokes) {
    for (let i = 0; i + 3 < s.length; i += 2) {
      const map = (v: number) => (Math.max(0, Math.min(1, v)) - .5) * 1.0;
      segments.push([map(s[i]), map(s[i + 1]), map(s[i + 2]), map(s[i + 3])]);
    }
  }
  if (!segments.length) return null;
  return strokeDestinations(segments, count);
}

// Spread `count` points along the strokes proportionally to length, with a
// ragged inked edge. The third slot carries the stroke direction so formed ink
// can flow along the line.
function strokeDestinations(strokes: Stroke[], count: number): Float32Array | null {
  const lengths = strokes.map(([x, y, x2, y2]) => Math.hypot(x2 - x, y2 - y));
  const length = lengths.reduce((a, b) => a + b, 0);
  if (!(length > 0)) return null;
  const points: [number, number, number][] = [];
  let segment = 0, passed = 0;
  for (let i = 0; i < count; i++) {
    const d = (i + .5) / count * length;
    while (segment < strokes.length - 1 && d > passed + lengths[segment]) passed += lengths[segment++];
    const l = lengths[segment] || 1;
    const t = Math.min(1, (d - passed) / l);
    const [x, y, x2, y2] = strokes[segment];
    // Two incommensurate jitters give an inked, slightly ragged stroke edge.
    const jitter = Math.sin(i * 2.399963) * .014 + Math.sin(i * .7548777) * .007;
    points.push([x + (x2 - x) * t - (y2 - y) / l * jitter, y + (y2 - y) * t + (x2 - x) / l * jitter, Math.atan2(y2 - y, x2 - x)]);
  }
  points.sort((a, b) => Math.atan2(a[1], a[0]) - Math.atan2(b[1], b[0]));
  return new Float32Array(points.flatMap(([x, y, a]) => [x, y, a]));
}
