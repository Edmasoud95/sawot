import { SHAPES } from "./inkShapes";

export interface OrbExpression {
  shape: string;          // catalogue name, "readout", or "sketch"
  text?: string;          // readout text
  strokes?: number[][];   // sketch polylines in a unit square
  domain: string;
  tool: string;
  startedAt: number;
  expiresAt: number;
}

const DOMAIN_SHAPES = new Map<string, string>([
  ["light", "bulb"],
  ["climate", "thermometer"],
  ["media_player", "notes"],
]);

const SHAPE_HOLD_MS = 8000;
const TEXT_HOLD_MS = 10000;
const READOUT_MAX = 12;

export function expressionFromActivity(current: OrbExpression | null, activity: any, now = Date.now()): OrbExpression | null {
  if (!activity || typeof activity.domain !== "string") return current;
  const shape = DOMAIN_SHAPES.get(activity.domain);
  if (activity.phase === "start") {
    if (!shape) return null;
    return { shape, domain: activity.domain, tool: activity.tool, startedAt: now, expiresAt: now + 30000 };
  }
  // A late result must not revive an expired shape or replace a newer action.
  if (!current || current.domain !== activity.domain || current.tool !== activity.tool) return current;
  if (current.expiresAt <= now) return null;
  if (activity.phase === "error") return null;
  if (activity.phase === "complete") {
    return { ...current, expiresAt: Math.max(current.startedAt + 4500, now + 3000) };
  }
  return current;
}

const hasOwn = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

// The model's chosen expression. An explicit choice replaces device shapes; a
// verified temperature readout outranks it; "none" keeps a device shape alive
// but releases a previous conversational one.
export function expressionFromPayload(current: OrbExpression | null, payload: unknown, now = Date.now()): OrbExpression | null {
  const active = current && current.expiresAt > now ? current : null;
  const p = payload as any;
  let next: OrbExpression | null = null;
  if (p && typeof p === "object") {
    if (p.kind === "shape" && typeof p.name === "string" && hasOwn(SHAPES, p.name)) {
      next = { shape: p.name, domain: "conversation", tool: "reply", startedAt: now, expiresAt: now + SHAPE_HOLD_MS };
    } else if (p.kind === "readout" && typeof p.text === "string" && p.text.trim() && p.text.length <= READOUT_MAX) {
      next = { shape: "readout", text: p.text.trim().toUpperCase(), domain: "conversation", tool: "reply", startedAt: now, expiresAt: now + TEXT_HOLD_MS };
    } else if (p.kind === "sketch" && Array.isArray(p.strokes) && p.strokes.length &&
      p.strokes.every((s: unknown) => Array.isArray(s) && s.length >= 4 && s.length % 2 === 0 && s.every(finite))) {
      // Over-long drawings are trimmed to the cap rather than thrown away.
      next = { shape: "sketch", strokes: p.strokes.slice(0, 16).map((s: number[]) => s.map((v) => Math.max(0, Math.min(1, v)))),
        domain: "conversation", tool: "reply", startedAt: now, expiresAt: now + TEXT_HOLD_MS };
    }
  }
  if (active && active.domain === "temperature") return active;
  if (next) return next;
  return active && active.domain !== "conversation" ? active : null;
}

export function expressionFromReading(current: OrbExpression | null, reading: any, now = Date.now()): OrbExpression | null {
  if (reading?.kind !== "temperature" || typeof reading.value !== "number" ||
      !Number.isFinite(reading.value) || reading.value < -99.9 || reading.value > 999.9 ||
      (reading.unit !== "°C" && reading.unit !== "°F")) return current;
  const value = Math.round(reading.value * 10) / 10;
  return { shape: "readout", text: `${value}${reading.unit}`, domain: "temperature", tool: "reading",
    startedAt: now, expiresAt: now + TEXT_HOLD_MS };
}
