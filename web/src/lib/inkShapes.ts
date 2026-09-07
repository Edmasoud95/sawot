// Signed distance fields for the expression catalogue, in orb units (the
// vessel spans roughly -0.5..0.5). They only place attraction destinations for
// the ink; nothing here ever masks rendered pixels.
export type Shape = (x: number, y: number) => number;

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const TAU = Math.PI * 2;

const circle = (x: number, y: number, cx: number, cy: number, r: number) => Math.hypot(x - cx, y - cy) - r;
function capsule(x: number, y: number, ax: number, ay: number, bx: number, by: number, r: number) {
  const dx = bx - ax, dy = by - ay;
  const t = clamp(((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1), 0, 1);
  return Math.hypot(x - ax - t * dx, y - ay - t * dy) - r;
}
function box(x: number, y: number, cx: number, cy: number, hw: number, hh: number, r = 0) {
  const qx = Math.abs(x - cx) - hw + r, qy = Math.abs(y - cy) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}
const ring = (d: number, t: number) => Math.abs(d) - t;
const ellipse = (x: number, y: number, cx: number, cy: number, rx: number, ry: number, angle = 0) => {
  const c = Math.cos(angle), s = Math.sin(angle);
  const u = (x - cx) * c + (y - cy) * s, v = -(x - cx) * s + (y - cy) * c;
  return (Math.hypot(u / rx, v / ry) - 1) * Math.min(rx, ry);
};
// Arc of a circle between two angles (radians, counter-clockwise), with thickness.
function arc(x: number, y: number, cx: number, cy: number, r: number, a0: number, a1: number, t: number) {
  const dx = x - cx, dy = y - cy;
  let a = Math.atan2(dy, dx);
  const span = ((a1 - a0) % TAU + TAU) % TAU;
  let rel = ((a - a0) % TAU + TAU) % TAU;
  if (rel <= span) return Math.abs(Math.hypot(dx, dy) - r) - t;
  const e0 = Math.hypot(dx - Math.cos(a0) * r, dy - Math.sin(a0) * r);
  const e1 = Math.hypot(dx - Math.cos(a1) * r, dy - Math.sin(a1) * r);
  return Math.min(e0, e1) - t;
}
function polygon(x: number, y: number, v: number[][]) {
  let d = (x - v[0][0]) ** 2 + (y - v[0][1]) ** 2, s = 1;
  for (let i = 0, j = v.length - 1; i < v.length; j = i++) {
    const ex = v[j][0] - v[i][0], ey = v[j][1] - v[i][1];
    const wx = x - v[i][0], wy = y - v[i][1];
    const h = clamp((wx * ex + wy * ey) / (ex * ex + ey * ey), 0, 1);
    d = Math.min(d, (wx - ex * h) ** 2 + (wy - ey * h) ** 2);
    const c1 = y >= v[i][1], c2 = y < v[j][1], c3 = ex * wy > ey * wx;
    if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) s = -s;
  }
  return s * Math.sqrt(d);
}
const deg = (d: number) => d * Math.PI / 180;
const min = Math.min;

const outline = (x: number, y: number) => ring(circle(x, y, 0, 0, .49), .018);
const eyes = (x: number, y: number, r = .06) => min(circle(x, y, -.19, .17, r), circle(x, y, .19, .17, r));
const smile = (x: number, y: number) => Math.hypot(Math.max(0, Math.abs(x) - .27), y - (-.28 + 1.8 * x * x)) - .035;
const frown = (x: number, y: number) => Math.hypot(Math.max(0, Math.abs(x) - .27), y - (-.13 - 1.8 * x * x)) - .035;
const cloudBody = (x: number, y: number, dy = 0) => min(
  circle(x, y, -.14, -.02 + dy, .15), circle(x, y, .02, .08 + dy, .19), circle(x, y, .18, -.02 + dy, .14),
  box(x, y, 0, -.1 + dy, .3, .08, .06));
const lockBody = (x: number, y: number) => Math.max(box(x, y, 0, -.12, .2, .16, .04),
  -min(circle(x, y, 0, -.08, .045), box(x, y, 0, -.16, .022, .07)));
const star = (() => {
  const v: number[][] = [];
  for (let i = 0; i < 10; i++) { const r = i % 2 ? .18 : .42, a = Math.PI / 2 + i * Math.PI / 5; v.push([Math.cos(a) * r, Math.sin(a) * r]); }
  return (x: number, y: number) => polygon(x, y, v);
})();

export const SHAPES: Record<string, Shape> = {
  happy: (x, y) => min(eyes(x, y), smile(x, y), outline(x, y)),
  sad: (x, y) => min(eyes(x, y), frown(x, y), outline(x, y)),
  surprised: (x, y) => min(eyes(x, y, .065), ring(circle(x, y, 0, -.2, .09), .03), outline(x, y)),
  curious: (x, y) => min(circle(x, y, -.19, .15, .05), circle(x, y, .19, .17, .075),
    arc(x, y, .19, .17, .14, deg(25), deg(155), .022), capsule(x, y, -.09, -.22, .07, -.2, .03), outline(x, y)),
  wink: (x, y) => min(circle(x, y, -.19, .17, .06), capsule(x, y, .11, .17, .27, .17, .026), smile(x, y), outline(x, y)),
  laughing: (x, y) => min(arc(x, y, -.19, .14, .07, 0, Math.PI, .022), arc(x, y, .19, .14, .07, 0, Math.PI, .022),
    Math.max(circle(x, y, 0, -.14, .2), y + .14), outline(x, y)),
  sleepy: (x, y) => min(arc(x, y, -.19, .2, .07, Math.PI, TAU, .022), arc(x, y, .19, .2, .07, Math.PI, TAU, .022),
    capsule(x, y, -.06, -.22, .06, -.22, .03), outline(x, y)),
  love: (x, y) => min(circle(x, y, -.15, .1, .17), circle(x, y, .15, .1, .17),
    polygon(x, y, [[-.3, .04], [0, -.36], [.3, .04], [0, .12]])),
  bulb: (x, y) => min(circle(x, y, 0, .2, .32), capsule(x, y, 0, -.07, 0, -.23, .115),
    capsule(x, y, -.105, -.365, .105, -.365, .032), capsule(x, y, -.065, -.455, .065, -.455, .025)),
  thermometer: (x, y) => min(capsule(x, y, 0, -.25, 0, .42, .08), circle(x, y, 0, -.3, .19),
    capsule(x, y, .14, .28, .23, .28, .022), capsule(x, y, .14, .08, .2, .08, .022)),
  notes: (x, y) => min(ellipse(x, y, -.2, -.3, .138, .098), ellipse(x, y, .2, -.19, .138, .098),
    capsule(x, y, -.085, -.27, -.085, .32, .033), capsule(x, y, .315, -.16, .315, .43, .033),
    capsule(x, y, -.085, .3, .315, .41, .055)),
  lock: (x, y) => min(lockBody(x, y), Math.max(ring(circle(x, y, 0, .08, .13), .03), .08 - y),
    capsule(x, y, -.13, .08, -.13, .02, .03), capsule(x, y, .13, .08, .13, .02, .03)),
  unlock: (x, y) => min(lockBody(x, y), Math.max(ring(circle(x, y, .1, .12, .13), .03), .12 - y),
    capsule(x, y, .23, .12, .23, .02, .03), capsule(x, y, -.03, .12, -.03, .07, .03)),
  door: (x, y) => min(ring(box(x, y, 0, 0, .2, .32, .03), .022), circle(x, y, .11, -.02, .032)),
  fan: (x, y) => min(circle(x, y, 0, 0, .06), ...[0, 1, 2].map((k) => {
    const a = k * TAU / 3 + .3;
    return ellipse(x, y, Math.cos(a) * .19, Math.sin(a) * .19, .19, .085, a);
  })),
  bell: (x, y) => min(Math.max(circle(x, y, 0, .02, .24), -.14 - y), capsule(x, y, -.28, -.14, .28, -.14, .035),
    circle(x, y, 0, -.25, .05), circle(x, y, 0, .27, .045)),
  plug: (x, y) => min(box(x, y, 0, -.08, .16, .14, .05), capsule(x, y, -.07, .06, -.07, .22, .03),
    capsule(x, y, .07, .06, .07, .22, .03), capsule(x, y, 0, -.22, 0, -.4, .025)),
  camera: (x, y) => min(Math.max(box(x, y, 0, -.02, .3, .18, .05), -circle(x, y, 0, -.02, .1)),
    ring(circle(x, y, 0, -.02, .1), .03), box(x, y, -.12, .19, .08, .04, .02)),
  home: (x, y) => min(capsule(x, y, -.34, .05, 0, .33, .028), capsule(x, y, 0, .33, .34, .05, .028),
    ring(box(x, y, 0, -.12, .24, .17, .02), .025), box(x, y, 0, -.2, .06, .1, .02)),
  check: (x, y) => min(capsule(x, y, -.26, -.02, -.08, -.2, .05), capsule(x, y, -.08, -.2, .3, .2, .05)),
  cross: (x, y) => min(capsule(x, y, -.22, -.22, .22, .22, .05), capsule(x, y, -.22, .22, .22, -.22, .05)),
  question: (x, y) => min(arc(x, y, 0, .14, .16, deg(-80), deg(200), .04),
    capsule(x, y, .03, -.02, 0, -.13, .04), circle(x, y, 0, -.3, .055)),
  exclamation: (x, y) => min(capsule(x, y, 0, .3, 0, -.08, .055), circle(x, y, 0, -.28, .06)),
  clock: (x, y) => min(ring(circle(x, y, 0, 0, .38), .025), capsule(x, y, 0, 0, 0, .22, .025),
    capsule(x, y, 0, 0, .15, 0, .025), circle(x, y, 0, 0, .04)),
  star,
  sun: (x, y) => min(circle(x, y, 0, 0, .16), ...[0, 1, 2, 3, 4, 5, 6, 7].map((k) => {
    const a = k * Math.PI / 4;
    return capsule(x, y, Math.cos(a) * .25, Math.sin(a) * .25, Math.cos(a) * .4, Math.sin(a) * .4, .03);
  })),
  cloud: (x, y) => cloudBody(x, y),
  rain: (x, y) => min(cloudBody(x, y, .1), capsule(x, y, -.15, -.2, -.2, -.36, .03),
    capsule(x, y, 0, -.2, -.05, -.36, .03), capsule(x, y, .15, -.2, .1, -.36, .03)),
};
