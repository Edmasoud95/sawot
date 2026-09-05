export interface Entity {
  entity_id: string;
  name: string;
  state: string;
  area?: string;
  attributes?: Record<string, unknown>;
}

export interface Card {
  entity_id: string;
  domain: string;
  name: string;
  area?: string;
  state: string;
  attrs: Record<string, unknown>;
}

const SUMMARY_DOMAINS = new Set([
  "light", "switch", "climate", "cover", "fan", "media_player",
  "lock", "scene", "script", "vacuum", "humidifier", "alarm_control_panel",
]);

const CARD_ATTRS = [
  "brightness", "temperature", "current_temperature", "unit_of_measurement",
  "rgb_color", "color_temp_kelvin", "min_color_temp_kelvin",
  "max_color_temp_kelvin", "supported_color_modes",
];

export class HomeAssistant {
  private areas = new Map<string, string>();

  constructor(private baseUrl: string, private token: string) {}

  private headers(extra: Record<string, string> = {}) {
    return { Authorization: "Bearer " + this.token, ...extra };
  }

  async loadAreas(): Promise<void> {
    const template =
      "{% for s in states %}{{ s.entity_id }}|{{ area_name(s.entity_id) or '' }}\n{% endfor %}";
    const resp = await fetch(this.baseUrl + "/api/template", {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ template }),
    });
    if (!resp.ok) throw new Error("HA template failed: " + resp.status);
    const text = await resp.text();
    this.areas = new Map();
    for (const line of text.trim().split("\n")) {
      const [id, area] = line.split("|");
      if (id && area) this.areas.set(id.trim(), area);
    }
  }

  async getEntities(domain?: string, area?: string): Promise<Entity[]> {
    const resp = await fetch(this.baseUrl + "/api/states", { headers: this.headers() });
    if (!resp.ok) throw new Error("HA states failed: " + resp.status);
    const states: any[] = await resp.json();
    const out: Entity[] = [];
    for (const s of states) {
      if (domain && !s.entity_id.startsWith(domain + ".")) continue;
      const entityArea = this.areas.get(s.entity_id);
      if (area && (entityArea ?? "").toLowerCase() !== area.toLowerCase()) continue;
      out.push({
        entity_id: s.entity_id,
        name: s.attributes?.friendly_name ?? s.entity_id,
        state: s.state,
        area: entityArea,
        attributes: Object.fromEntries(
          ["unit_of_measurement", "device_class", "current_temperature"]
            .filter(key => key in (s.attributes ?? {}))
            .map(key => [key, s.attributes[key]]),
        ),
      });
    }
    return out;
  }

  async callService(
    domain: string,
    service: string,
    entityId: string,
    data?: Record<string, unknown>,
  ): Promise<{ ok: true }> {
    const resp = await fetch(this.baseUrl + "/api/services/" + domain + "/" + service, {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ entity_id: entityId, ...(data ?? {}) }),
    });
    if (!resp.ok) throw new Error("HA service failed: " + resp.status);
    return { ok: true };
  }

  async entitySummary(): Promise<string> {
    const entities = await this.getEntities();
    return entities
      .filter((e) => SUMMARY_DOMAINS.has(e.entity_id.split(".")[0]))
      .map((e) => e.entity_id + " | " + e.name + " | " + (e.area || "?") + " | " + e.state)
      .join("\n");
  }

  async getCards(entityIds: string[]): Promise<Card[]> {
    const wanted = new Set(entityIds);
    const resp = await fetch(this.baseUrl + "/api/states", { headers: this.headers() });
    if (!resp.ok) throw new Error("HA states failed: " + resp.status);
    const states: any[] = await resp.json();
    const byId = new Map<string, Card>();
    for (const s of states) {
      if (!wanted.has(s.entity_id)) continue;
      const attrs: Record<string, unknown> = {};
      for (const k of CARD_ATTRS) {
        if (k in (s.attributes ?? {})) attrs[k] = s.attributes[k];
      }
      byId.set(s.entity_id, {
        entity_id: s.entity_id,
        domain: s.entity_id.split(".")[0],
        name: s.attributes?.friendly_name ?? s.entity_id,
        area: this.areas.get(s.entity_id),
        state: s.state,
        attrs,
      });
    }
    return entityIds.filter((id) => byId.has(id)).map((id) => byId.get(id)!);
  }
}
