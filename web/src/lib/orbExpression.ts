export const EXPRESSION_SHAPES = { bulb: 1, thermometer: 2, music: 3, happy: 4, sad: 5, readout: 6 } as const;
export type ExpressionShape = keyof typeof EXPRESSION_SHAPES;

export interface OrbExpression {
  shape: ExpressionShape;
  text?: string;
  domain: string;
  tool: string;
  startedAt: number;
  expiresAt: number;
}

const DOMAIN_SHAPES = new Map<string, ExpressionShape>([
  ["light", "bulb"],
  ["climate", "thermometer"],
  ["media_player", "music"],
]);

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

// Device actions retain visual priority over conversational tone.
export function expressionFromSentiment(current: OrbExpression | null, sentiment: unknown, now = Date.now()): OrbExpression | null {
  if (current && current.domain !== "conversation" && current.expiresAt > now) return current;
  if (sentiment !== "happy" && sentiment !== "sad") return null;
  return { shape: sentiment, domain: "conversation", tool: "reply", startedAt: now, expiresAt: now + 8000 };
}

export function expressionFromReading(current: OrbExpression | null, reading: any, now = Date.now()): OrbExpression | null {
  if (reading?.kind !== "temperature" || typeof reading.value !== "number" ||
      !Number.isFinite(reading.value) || reading.value < -99.9 || reading.value > 999.9 ||
      (reading.unit !== "°C" && reading.unit !== "°F")) return current;
  const value = Math.round(reading.value * 10) / 10;
  return { shape: "readout", text: `${value}${reading.unit}`, domain: "temperature", tool: "reading",
    startedAt: now, expiresAt: now + 10000 };
}
