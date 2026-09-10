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
// the vessel, plus optional fill polygons whose interiors are inked.
// Validation happened upstream; this only clamps and lays out.
export function sketchDestinations(strokes: number[][], count: number, fills: number[][] = []): Float32Array | null {
  const map = (v: number) => (Math.max(0, Math.min(1, v)) - .5) * 1.0;
  const segments: Stroke[] = [];
  for (const s of strokes) {
    for (let i = 0; i + 3 < s.length; i += 2) {
      segments.push([map(s[i]), map(s[i + 1]), map(s[i + 2]), map(s[i + 3])]);
    }
  }
  const polygons = fills
    .map((f) => f.map(map))
    .filter((f) => f.length >= 6 && Math.abs(polygonArea(f)) > 1e-5);
  if (!segments.length && !polygons.length) return null;
  // Ink is shared by "how much drawing" each part is: a stroke by its length,
  // a fill by its area over a nominal stroke width, so a filled shape is
  // solid rather than a sprinkle.
  const strokeLength = segments.reduce((n, [x, y, x2, y2]) => n + Math.hypot(x2 - x, y2 - y), 0);
  const fillLength = polygons.reduce((n, f) => n + Math.abs(polygonArea(f)) / FILL_STROKE_WIDTH, 0);
  const total = strokeLength + fillLength;
  const fillCount = total > 0 ? Math.round(count * fillLength / total) : 0;
  const points = [
    ...(segments.length ? strokePoints(segments, count - fillCount) : []),
    ...(polygons.length ? fillPoints(polygons, fillCount) : []),
  ];
  return finish(points);
}

const FILL_STROKE_WIDTH = .04;

function polygonArea(f: number[]): number {
  let a = 0;
  for (let i = 0, n = f.length / 2; i < n; i++) {
    const j = (i + 1) % n;
    a += f[i * 2] * f[j * 2 + 1] - f[j * 2] * f[i * 2 + 1];
  }
  return a / 2;
}

function insidePolygon(x: number, y: number, f: number[]): boolean {
  let inside = false;
  for (let i = 0, n = f.length / 2, j = n - 1; i < n; j = i++) {
    const xi = f[i * 2], yi = f[i * 2 + 1], xj = f[j * 2], yj = f[j * 2 + 1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Deterministic low-discrepancy samples (Halton 2,3) rejected against each
// polygon, shared by area, with a random-looking flow direction per point.
function fillPoints(polygons: number[][], count: number): [number, number, number][] {
  const areas = polygons.map((f) => Math.abs(polygonArea(f)));
  const totalArea = areas.reduce((a, b) => a + b, 0);
  const out: [number, number, number][] = [];
  polygons.forEach((f, p) => {
    const want = p === polygons.length - 1 ? count - out.length : Math.round(count * areas[p] / totalArea);
    let minX = 1, maxX = -1, minY = 1, maxY = -1;
    for (let i = 0; i < f.length; i += 2) {
      minX = Math.min(minX, f[i]); maxX = Math.max(maxX, f[i]);
      minY = Math.min(minY, f[i + 1]); maxY = Math.max(maxY, f[i + 1]);
    }
    let placed = 0;
    for (let k = 1; placed < want && k < want * 40 + 200; k++) {
      const x = minX + halton(k, 2) * (maxX - minX);
      const y = minY + halton(k, 3) * (maxY - minY);
      if (!insidePolygon(x, y, f)) continue;
      out.push([x, y, halton(k, 5) * Math.PI * 2]);
      placed++;
    }
  });
  return out;
}

function halton(index: number, base: number): number {
  let result = 0, f = 1 / base, i = index;
  while (i > 0) { result += f * (i % base); i = Math.floor(i / base); f /= base; }
  return result;
}

// Spread `count` points along the strokes proportionally to length, with a
// ragged inked edge. The third slot carries the stroke direction so formed ink
// can flow along the line.
function strokePoints(strokes: Stroke[], count: number): [number, number, number][] {
  const lengths = strokes.map(([x, y, x2, y2]) => Math.hypot(x2 - x, y2 - y));
  const length = lengths.reduce((a, b) => a + b, 0);
  if (!(length > 0)) return [];
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
  return points;
}

function strokeDestinations(strokes: Stroke[], count: number): Float32Array | null {
  const points = strokePoints(strokes, count);
  return points.length ? finish(points) : null;
}

// Sorted by angle around the centre so neighbouring particles (which the
// simulation picks in order) land near each other.
function finish(points: [number, number, number][]): Float32Array | null {
  if (!points.length) return null;
  points.sort((a, b) => Math.atan2(a[1], a[0]) - Math.atan2(b[1], b[0]));
  return new Float32Array(points.flatMap(([x, y, a]) => [x, y, a]));
}
