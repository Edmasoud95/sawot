export interface TemperatureReading {
  kind: 'temperature';
  entity_id: string;
  value: number;
  unit: '°C' | '°F';
}

/** Only live, numeric temperature data qualifies for an orb readout. */
export function temperatureReading(entity: any): TemperatureReading | null {
  if (!entity || typeof entity.entity_id !== 'string') return null;
  const attrs = entity.attributes ?? {};
  const unit = attrs.unit_of_measurement;
  if (unit !== '°C' && unit !== '°F') return null;
  if (entity.state === 'unavailable' || entity.state === 'unknown') return null;
  const raw = entity.entity_id.startsWith('climate.') ? attrs.current_temperature :
    entity.entity_id.startsWith('sensor.') ? entity.state : null;
  if ((typeof raw !== 'string' && typeof raw !== 'number') || String(raw).trim() === '') return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < -99.9 || value > 999.9) return null;
  return { kind: 'temperature', entity_id: entity.entity_id, value, unit };
}
