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
  | { kind: "sketch"; strokes: number[][] }
  | { kind: "none" };

export const READOUT_MAX_CHARS = 12;
export const SKETCH_MAX_STROKES = 16;
export const SKETCH_MAX_POINTS = 200;

const READOUT_CHARS = /^[A-Z0-9 .:%°/-]{1,12}$/;

function readout(raw: string): ExpressionPayload {
  const text = raw.trim().replace(/\s+/g, " ").toUpperCase();
  if (!READOUT_CHARS.test(text) || text.length > READOUT_MAX_CHARS) return { kind: "none" };
  return { kind: "readout", text };
}

// "<sketch:x,y x,y; x,y x,y>": strokes separated by ";", points by spaces,
// coordinates in a unit square with y pointing up. Clamped and limited so a
// poor drawing degrades to nothing rather than to garbage.
function sketch(raw: string): ExpressionPayload {
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
      if (++points > SKETCH_MAX_POINTS) return { kind: "none" };
    }
    if (stroke.length < 4) return { kind: "none" };
    strokes.push(stroke);
    if (strokes.length > SKETCH_MAX_STROKES) return { kind: "none" };
  }
  return strokes.length ? { kind: "sketch", strokes } : { kind: "none" };
}

// A real tool for the orb: reasoning models prefer calling a tool over
// remembering a hidden marker, and the structured arguments parse reliably.
export const ORB_TOOL_NAME = "show_on_orb";
export const ORB_TOOL = {
  name: ORB_TOOL_NAME,
  description: "Show something on the listener's ink orb while you speak: a catalogue shape, a short readout, or a free drawing. " +
    "Call it once, then answer normally. Use kind 'sketch' with strokes to draw anything; each stroke is a list of x,y numbers from 0 to 1 with y pointing up.",
  parameters: {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["shape", "readout", "sketch"], description: "What to show." },
      name: { type: "string", description: "For kind 'shape': one of " + EXPRESSION_CATALOG.map((e) => e.name).join(", ") + "." },
      text: { type: "string", description: `For kind 'readout': up to ${READOUT_MAX_CHARS} characters of letters, digits, spaces, . : % ° / -` },
      strokes: {
        description: `For kind 'sketch': up to ${SKETCH_MAX_STROKES} strokes and ${SKETCH_MAX_POINTS} points. Either an array of strokes, each a flat array [x0,y0,x1,y1,...], or a string 'x,y x,y; x,y x,y'.`,
        anyOf: [
          { type: "array", items: { type: "array", items: { type: "number" }, minItems: 4 } },
          { type: "string" },
        ],
      },
    },
    required: ["kind"],
  },
};

export function expressionFromToolArgs(args: unknown): ExpressionPayload {
  if (!args || typeof args !== "object") return { kind: "none" };
  const a = args as Record<string, unknown>;
  const kind = typeof a.kind === "string" ? a.kind.toLowerCase()
    : a.strokes !== undefined ? "sketch" : typeof a.name === "string" ? "shape" : typeof a.text === "string" ? "readout" : "";
  if (kind === "shape") {
    const name = String(a.name ?? "").trim().toLowerCase();
    return CATALOG_NAMES.has(name) ? { kind: "shape", name } : { kind: "none" };
  }
  if (kind === "readout") return typeof a.text === "string" ? readout(a.text) : { kind: "none" };
  if (kind === "sketch") {
    if (typeof a.strokes === "string") return sketch(a.strokes);
    if (Array.isArray(a.strokes)) {
      const text = a.strokes.map((stroke) => Array.isArray(stroke)
        ? stroke.map((v) => Array.isArray(v) ? v.join(",") : String(v)).join(" ") : "").join(";");
      return sketch(text);
    }
  }
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

export function expressionPrompt(): string {
  const names = EXPRESSION_CATALOG.map((e) => `<expression:${e.name}> (${e.meaning})`).join(", ");
  return "\n\nThe listener sees an orb of ink that can form a picture while you speak. " +
    `To show something, call the ${ORB_TOOL_NAME} tool (preferred), or begin your final spoken reply with one hidden marker; markers are removed before speech. ` +
    "Options: " + names + ". " +
    "Use <expression:neutral> or no marker for routine or ambiguous replies. " +
    `Show a short value or word with <readout:TEXT> (up to ${READOUT_MAX_CHARS} characters, letters, digits, spaces, . : % ° / -), for example <readout:42%> or <readout:3 MIN> or <readout:LOCKED>. ` +
    "You can also draw. Draw anything else with <sketch:STROKES>: strokes separated by semicolons, points by spaces, each point x,y from 0 to 1 with y pointing up, " +
    `up to ${SKETCH_MAX_STROKES} strokes and ${SKETCH_MAX_POINTS} points. ` +
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
