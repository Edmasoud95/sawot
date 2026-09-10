// Hidden expression markers the model may place at the start of a spoken
// reply. They are parsed, validated and removed here; nothing reaches speech,
// captions or history. The frontend forms the chosen shape out of ink.

export interface CatalogEntry { name: string; meaning: string; }

export const EXPRESSION_CATALOG: CatalogEntry[] = [
  { name: "happy", meaning: "celebration, gratitude, warmth" },
  { name: "sad", meaning: "sympathy, disappointment, bad news" },
  { name: "surprised", meaning: "an unexpected result or fact" },
  { name: "curious", meaning: "a follow-up question or interest" },
  { name: "wink", meaning: "playful teasing or a joke" },
  { name: "laughing", meaning: "something genuinely funny" },
  { name: "sleepy", meaning: "bedtime, night mode, winding down" },
  { name: "love", meaning: "affection, compliments, favourites" },
  { name: "bulb", meaning: "lights and lighting scenes" },
  { name: "thermometer", meaning: "heating, cooling, temperature" },
  { name: "notes", meaning: "music and media playback" },
  { name: "lock", meaning: "a door or lock being secured" },
  { name: "unlock", meaning: "a door or lock being opened" },
  { name: "door", meaning: "doors, garages, entrances" },
  { name: "fan", meaning: "fans and ventilation" },
  { name: "bell", meaning: "alarms, reminders, doorbell, notifications" },
  { name: "plug", meaning: "switches, outlets, power" },
  { name: "camera", meaning: "cameras and security video" },
  { name: "home", meaning: "the whole house, arriving, leaving" },
  { name: "check", meaning: "confirmation that something is done" },
  { name: "cross", meaning: "something failed or is unavailable" },
  { name: "question", meaning: "you need clarification" },
  { name: "exclamation", meaning: "a warning or something important" },
  { name: "clock", meaning: "time, timers, schedules" },
  { name: "star", meaning: "favourites, praise, achievements" },
  { name: "sun", meaning: "sunny weather, daytime, morning" },
  { name: "cloud", meaning: "cloudy or overcast weather" },
  { name: "rain", meaning: "rain, storms, wet weather" },
];

const CATALOG_NAMES = new Set(EXPRESSION_CATALOG.map((e) => e.name));

export type ExpressionPayload =
  | { kind: "shape"; name: string }
  | { kind: "readout"; text: string }
  | { kind: "sketch"; strokes: number[][]; fills?: number[][] }
  | { kind: "none" };

export const READOUT_MAX_CHARS = 12;
export const SKETCH_MAX_STROKES = 16;
export const SKETCH_MAX_POINTS = 200;
// "Detailed drawings" (a setting): primitives and fills, and room for them.
export const DETAILED_SKETCH_MAX_STROKES = 24;
export const DETAILED_SKETCH_MAX_POINTS = 400;

export interface SketchLimits { strokes: number; points: number }
export interface DrawingOptions { detailed?: boolean }
export function sketchLimits(opts: DrawingOptions = {}): SketchLimits {
  return opts.detailed
    ? { strokes: DETAILED_SKETCH_MAX_STROKES, points: DETAILED_SKETCH_MAX_POINTS }
    : { strokes: SKETCH_MAX_STROKES, points: SKETCH_MAX_POINTS };
}

const READOUT_CHARS = /^[A-Z0-9 .:%°/-]{1,12}$/;

function readout(raw: string): ExpressionPayload {
  const text = raw.trim().replace(/\s+/g, " ").toUpperCase();
  if (!READOUT_CHARS.test(text) || text.length > READOUT_MAX_CHARS) return { kind: "none" };
  return { kind: "readout", text };
}

// "<sketch:x,y x,y; x,y x,y>": strokes separated by ";", points by spaces,
// coordinates in a unit square with y pointing up. Clamped and limited so a
// poor drawing degrades to nothing rather than to garbage.
function sketch(raw: string, limits: SketchLimits = sketchLimits()): ExpressionPayload {
  const strokes: number[][] = [];
  let points = 0;
  for (const part of raw.split(";")) {
    // Tolerate parentheses, missing commas, spaces after commas and line
    // breaks: models vary. Every number in order pairs up as x then y.
    const numbers = (part.match(/-?\d*\.?\d+/g) ?? []).map(Number);
    if (!numbers.length) {
      if (part.trim()) return { kind: "none" };
      continue;
    }
    const stroke: number[] = [];
    for (let i = 0; i + 1 < numbers.length; i += 2) {
      const x = numbers[i], y = numbers[i + 1];
      if (!Number.isFinite(x) || !Number.isFinite(y)) return { kind: "none" };
      stroke.push(Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y)));
      if (++points > limits.points) return { kind: "none" };
    }
    if (stroke.length < 4) return { kind: "none" };
    strokes.push(stroke);
    if (strokes.length > limits.strokes) return { kind: "none" };
  }
  return strokes.length ? { kind: "sketch", strokes } : { kind: "none" };
}


// Drawing primitives from the tool: expanded here into polylines (and fill
// polygons) so the renderer only ever sees points. Each primitive counts as
// one stroke; every generated point counts toward the point limit.
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);
const CURVE_POINTS = 32;

function ellipsePoints(cx: number, cy: number, rx: number, ry: number, rotation: number, a0: number, a1: number, closed: boolean): number[] {
  const sweep = a1 - a0;
  const n = closed ? CURVE_POINTS : Math.max(4, Math.ceil(Math.abs(sweep) / (Math.PI * 2) * CURVE_POINTS) + 1);
  const cr = Math.cos(rotation), sr = Math.sin(rotation);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = a0 + sweep * (closed ? i / n : i / (n - 1));
    const x = Math.cos(t) * rx, y = Math.sin(t) * ry;
    out.push(clamp01(cx + x * cr - y * sr), clamp01(cy + x * sr + y * cr));
  }
  if (closed) out.push(out[0], out[1]);
  return out;
}

function flatPoints(raw: unknown): number[] | null {
  const flat: number[] = [];
  const push = (v: unknown) => { const n = num(v); if (n === null) return false; flat.push(clamp01(n)); return true; };
  if (typeof raw === "string") { for (const m of raw.match(/-?\d*\.?\d+/g) ?? []) if (!push(m)) return null; }
  else if (Array.isArray(raw)) {
    for (const v of raw) {
      if (Array.isArray(v)) { for (const w of v) if (!push(w)) return null; }
      else if (v && typeof v === "object" && "x" in v) { if (!push((v as any).x) || !push((v as any).y)) return null; }
      else if (!push(v)) return null;
    }
  } else return null;
  if (flat.length % 2) flat.pop();
  return flat.length >= 4 ? flat : null;
}

/** One primitive as a polyline, plus whether it is a fill region. */
export function expandPrimitive(shape: unknown): { points: number[]; fill: boolean } | null {
  if (!shape || typeof shape !== "object") return null;
  const p = shape as Record<string, unknown>;
  const type = String(p.type ?? p.kind ?? "").toLowerCase();
  const fill = p.fill === true || p.fill === "true" || p.filled === true;
  const deg = (v: unknown, d: number) => { const n = num(v); return (n === null ? d : n) * Math.PI / 180; };
  if (type === "circle" || type === "dot") {
    const cx = num(p.cx ?? p.x), cy = num(p.cy ?? p.y), r = num(p.r ?? p.radius);
    if (cx === null || cy === null || r === null || r <= 0) return null;
    return { points: ellipsePoints(cx, cy, r, r, 0, 0, Math.PI * 2, true), fill: type === "dot" || fill };
  }
  if (type === "ellipse") {
    const cx = num(p.cx ?? p.x), cy = num(p.cy ?? p.y), rx = num(p.rx ?? p.r), ry = num(p.ry ?? p.r);
    if (cx === null || cy === null || rx === null || ry === null || rx <= 0 || ry <= 0) return null;
    return { points: ellipsePoints(cx, cy, rx, ry, deg(p.rotation, 0), 0, Math.PI * 2, true), fill };
  }
  if (type === "arc") {
    const cx = num(p.cx ?? p.x), cy = num(p.cy ?? p.y), r = num(p.r ?? p.radius);
    if (cx === null || cy === null || r === null || r <= 0) return null;
    const a0 = deg(p.start, 0), a1 = deg(p.end, 180);
    if (a0 === a1) return null;
    return { points: ellipsePoints(cx, cy, r, r, 0, a0, a1, false), fill: false };
  }
  if (type === "rect" || type === "rectangle" || type === "square") {
    const x = num(p.x), y = num(p.y), w = num(p.w ?? p.width ?? p.size), h = num(p.h ?? p.height ?? p.size ?? p.w ?? p.width);
    if (x === null || y === null || w === null || h === null || w <= 0 || h <= 0) return null;
    const x0 = clamp01(x), y0 = clamp01(y), x1 = clamp01(x + w), y1 = clamp01(y + h);
    return { points: [x0, y0, x1, y0, x1, y1, x0, y1, x0, y0], fill };
  }
  if (type === "polygon" || type === "line" || type === "polyline" || type === "path") {
    const points = flatPoints(p.points ?? p.pts);
    if (!points) return null;
    const closed = type === "polygon";
    if (closed && (points[0] !== points[points.length - 2] || points[1] !== points[points.length - 1])) points.push(points[0], points[1]);
    if (closed && points.length < 8) return null;
    return { points, fill: closed && fill };
  }
  return null;
}

/** Primitives plus optional raw strokes as one sketch payload. */
export function sketchFromShapes(shapes: unknown, rawStrokes: unknown, limits: SketchLimits): ExpressionPayload {
  const strokes: number[][] = [];
  const fills: number[][] = [];
  let points = 0;
  const base = rawStrokes === undefined ? null : sketchFromArgs(rawStrokes, limits);
  if (base) {
    if (base.kind !== "sketch") return { kind: "none" };
    strokes.push(...base.strokes);
    points += base.strokes.reduce((n, s) => n + s.length / 2, 0);
  }
  if (shapes !== undefined) {
    if (!Array.isArray(shapes)) return { kind: "none" };
    for (const shape of shapes) {
      const expanded = expandPrimitive(shape);
      if (!expanded) return { kind: "none" };
      points += expanded.points.length / 2;
      (expanded.fill ? fills : strokes).push(expanded.points);
      if (strokes.length + fills.length > limits.strokes || points > limits.points) return { kind: "none" };
    }
  }
  if (!strokes.length && !fills.length) return { kind: "none" };
  return fills.length ? { kind: "sketch", strokes, fills } : { kind: "sketch", strokes };
}

function sketchFromArgs(raw: unknown, limits: SketchLimits): ExpressionPayload {
  if (typeof raw === "string") return sketch(raw, limits);
  if (Array.isArray(raw)) {
    const text = raw.map((stroke) => Array.isArray(stroke)
      ? stroke.map((v) => Array.isArray(v) ? v.join(",") : String(v)).join(" ") : "").join(";");
    return sketch(text, limits);
  }
  return { kind: "none" };
}

// A real tool for the orb: reasoning models prefer calling a tool over
// remembering a hidden marker, and the structured arguments parse reliably.
export const ORB_TOOL_NAME = "show_on_orb";
const SHAPE_TYPES = "circle {cx,cy,r}, ellipse {cx,cy,rx,ry,rotation°}, arc {cx,cy,r,start°,end°} (counter-clockwise from 3 o'clock), " +
  "rect {x,y,w,h} (x,y is the bottom-left corner), polygon {points:[x,y,...]}, line {points:[x,y,...]}";

export function orbTool(opts: DrawingOptions = {}) {
  const limits = sketchLimits(opts);
  const properties: Record<string, unknown> = {
    kind: { type: "string", enum: ["shape", "readout", "sketch"], description: "What to show." },
    name: { type: "string", description: "For kind 'shape': one of " + EXPRESSION_CATALOG.map((e) => e.name).join(", ") + "." },
    text: { type: "string", description: `For kind 'readout': up to ${READOUT_MAX_CHARS} characters of letters, digits, spaces, . : % ° / -` },
    strokes: {
      description: `For kind 'sketch': up to ${limits.strokes} strokes and ${limits.points} points. Either an array of strokes, each a flat array [x0,y0,x1,y1,...], or a string 'x,y x,y; x,y x,y'.`,
      anyOf: [
        { type: "array", items: { type: "array", items: { type: "number" }, minItems: 4 } },
        { type: "string" },
      ],
    },
  };
  if (opts.detailed) {
    properties.shapes = {
      type: "array",
      description: `For kind 'sketch': drawing primitives, used with or instead of strokes. Each is an object with a type: ${SHAPE_TYPES}. ` +
        "circle, ellipse, rect and polygon take fill:true to ink the whole area, which reads far better than an outline. " +
        `All coordinates are 0 to 1 with y pointing up. Primitives and strokes share the limit of ${limits.strokes} items and ${limits.points} points.`,
      items: { type: "object", properties: { type: { type: "string", enum: ["circle", "ellipse", "arc", "rect", "polygon", "line"] }, fill: { type: "boolean" } }, required: ["type"], additionalProperties: true },
    };
  }
  return {
    name: ORB_TOOL_NAME,
    description: "Show something on the listener's ink orb while you speak: a catalogue shape, a short readout, or a free drawing. " +
      "Call it once, then answer normally. Use kind 'sketch' with strokes to draw anything; each stroke is a list of x,y numbers from 0 to 1 with y pointing up." +
      (opts.detailed ? " For a better drawing combine filled primitives in 'shapes' (circles, ellipses, arcs, rectangles, polygons) with a few strokes for detail." : ""),
    parameters: { type: "object", properties, required: ["kind"] },
  };
}

export const ORB_TOOL = orbTool();

export function expressionFromToolArgs(args: unknown, opts: DrawingOptions = {}): ExpressionPayload {
  if (!args || typeof args !== "object") return { kind: "none" };
  const a = args as Record<string, unknown>;
  const kind = typeof a.kind === "string" ? a.kind.toLowerCase()
    : a.strokes !== undefined || a.shapes !== undefined ? "sketch" : typeof a.name === "string" ? "shape" : typeof a.text === "string" ? "readout" : "";
  if (kind === "shape") {
    const name = String(a.name ?? "").trim().toLowerCase();
    return CATALOG_NAMES.has(name) ? { kind: "shape", name } : { kind: "none" };
  }
  if (kind === "readout") return typeof a.text === "string" ? readout(a.text) : { kind: "none" };
  if (kind === "sketch") return sketchFromShapes(a.shapes, a.strokes, sketchLimits(opts));
  return { kind: "none" };
}

export interface ParsedReply {
  reply: string;
  expression: ExpressionPayload;
  temperatureEntity?: string;
}

// Consumes markers wherever the model put them (models often append the
// sketch after the sentence) and tidies the spoken text. When several
// expression markers appear, the last one wins.
export function parseExpressionMarkers(text: string): ParsedReply {
  let expression: ExpressionPayload = { kind: "none" };
  let temperatureEntity: string | undefined;
  const reply = text.replace(/<(expression|readout|sketch|temperature):([^>]{1,4000})>/gi, (_match, kindRaw: string, value: string) => {
    const kind = kindRaw.toLowerCase();
    if (kind === "expression") {
      const name = value.trim().toLowerCase();
      expression = CATALOG_NAMES.has(name) ? { kind: "shape", name } : { kind: "none" };
    } else if (kind === "readout") expression = readout(value);
    else if (kind === "sketch") expression = sketch(value);
    else temperatureEntity = value.trim();
    return " ";
  }).replace(/\s+([.,!?;:])/g, "$1").replace(/\s{2,}/g, " ").trim();
  return { reply, expression, temperatureEntity };
}

const DETAILED_GUIDE =
  "Detailed drawing is on: through the tool you can also send 'shapes', a list of primitives (" + SHAPE_TYPES + "). " +
  "Set fill:true on circles, ellipses, rectangles and polygons to ink the whole area. Build the subject from two to five filled primitives for its mass " +
  "(a filled ellipse for a body, a filled circle for a head), then add a few strokes or arcs for the defining details. Filled shapes always read better than outlines. " +
  "Primitives are only available through the tool, not in a marker. ";

export function expressionPrompt(opts: DrawingOptions = {}): string {
  const limits = sketchLimits(opts);
  const names = EXPRESSION_CATALOG.map((e) => `<expression:${e.name}> (${e.meaning})`).join(", ");
  return "\n\nThe listener sees an orb of ink that can form a picture while you speak. " +
    `To show something, call the ${ORB_TOOL_NAME} tool (preferred), or begin your final spoken reply with one hidden marker; markers are removed before speech. ` +
    "Options: " + names + ". " +
    "Use <expression:neutral> or no marker for routine or ambiguous replies. " +
    `Show a short value or word with <readout:TEXT> (up to ${READOUT_MAX_CHARS} characters, letters, digits, spaces, . : % ° / -), for example <readout:42%> or <readout:3 MIN> or <readout:LOCKED>. ` +
    "You can also draw. Draw anything else with <sketch:STROKES>: strokes separated by semicolons, points by spaces, each point x,y from 0 to 1 with y pointing up, " +
    `up to ${limits.strokes} strokes and ${limits.points} points. ` +
    (opts.detailed ? DETAILED_GUIDE : "") +
    "Drawing guide: think of a simple icon or silhouette of the subject, draw its main outline first as one closed stroke that fills most of the square (repeat the first point to close it), " +
    "then add 3 to 8 more strokes for the defining details: ears, eyes, wheels, windows, legs. Use 6 to 20 points per curved stroke so curves are smooth. " +
    "Example cat: <sketch:0.5,0.9 0.35,0.85 0.25,0.7 0.2,0.55 0.22,0.4 0.3,0.28 0.45,0.22 0.55,0.22 0.7,0.28 0.78,0.4 0.8,0.55 0.75,0.7 0.65,0.85 0.5,0.9; 0.25,0.7 0.2,0.9 0.36,0.82; 0.75,0.7 0.8,0.9 0.64,0.82; 0.38,0.58 0.42,0.62 0.46,0.58; 0.54,0.58 0.58,0.62 0.62,0.58; 0.47,0.45 0.5,0.42 0.53,0.45; 0.5,0.42 0.5,0.36; 0.3,0.4 0.15,0.42; 0.3,0.36 0.15,0.34; 0.7,0.4 0.85,0.42; 0.7,0.36 0.85,0.34>. " +
    "Example house: <sketch:0.2,0.2 0.2,0.6 0.5,0.9 0.8,0.6 0.8,0.2 0.2,0.2; 0.45,0.2 0.45,0.45 0.55,0.45 0.55,0.2; 0.28,0.5 0.28,0.62 0.4,0.62 0.4,0.5 0.28,0.5; 0.6,0.5 0.6,0.62 0.72,0.62 0.72,0.5 0.6,0.5; 0.62,0.72 0.62,0.85 0.7,0.85 0.7,0.78>. " +
    "When someone asks you to draw, never refuse: you can always draw a symbolic version, even of people, pets, feelings or abstract ideas. Draw a person as a simple figure, a face as a circle with features. Say briefly what you drew. " +
    "Draw proactively: whenever the reply is about a subject that can be pictured, an event, a place, a creature, an object, a piece of history, science or culture, sketch something emblematic of it even if nobody asked. " +
    "Roman Empire: a laurel wreath, a column or a helmet. Space: a rocket or planet with rings. Cooking: a pot or a whisk. Choose one strong, recognisable icon rather than a busy scene. " +
    "Prefer a catalogue expression for feelings and a readout for numbers, and use the device or status shapes when controlling the home; otherwise reach for a sketch first. " +
    "Reflect the conversational tone; do not diagnose or claim to know the user's feelings. Take negation, quotations and sarcasm into account. " +
    "Put markers only at the start of the final reply, never in tool arguments, and follow them with your normal reply. " +
    "When answering a current temperature question, check get_entities live and add <temperature:entity_id> " +
    "after the expression marker, selecting the exact temperature sensor you are discussing from this turn's results. " +
    "Use its actual value and unit in your spoken answer. For climate devices use current_temperature, never the setpoint. " +
    "Omit the temperature marker for unavailable readings, unrelated questions, or comparisons with no single primary reading.";
}
