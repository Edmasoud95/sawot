import type { HomeAssistant } from "./ha.js";

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  handler: (args: Record<string, any>) => Promise<any>;
  touchedIds?: (args: Record<string, any>, result: any) => string[];
}

export function toOpenAiTools(tools: Tool[]): any[] {
  return tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

export async function executeTool(
  tools: Tool[],
  name: string,
  args: Record<string, any>,
): Promise<any> {
  for (const t of tools) {
    if (t.name === name) {
      try {
        return await t.handler(args);
      } catch (e: any) {
        return { error: String(e?.message ?? e) };
      }
    }
  }
  return { error: "unknown tool: " + name };
}

export function touchedIdsFor(
  tools: Tool[],
  name: string,
  args: Record<string, any>,
  result: any,
): string[] {
  if (result && typeof result === "object" && "error" in result) return [];
  for (const t of tools) {
    if (t.name === name && t.touchedIds) return t.touchedIds(args, result);
  }
  return [];
}

const MAX_TOOL_ENTITIES = 60;

export function buildHaTools(ha: HomeAssistant): Tool[] {
  return [
    {
      name: "get_entities",
      description:
        "List Home Assistant entities with their current state. " +
        "Filter by domain (e.g. 'light', 'switch', 'climate') " +
        "and/or area name (e.g. 'Kitchen').",
      parameters: {
        type: "object",
        properties: {
          domain: { type: "string", description: "Entity domain filter" },
          area: { type: "string", description: "Area name filter" },
        },
      },
      async handler(args) {
        const entities = await ha.getEntities(args.domain, args.area);
        if (entities.length > MAX_TOOL_ENTITIES) {
          return {
            entities: entities.slice(0, MAX_TOOL_ENTITIES),
            note:
              (entities.length - MAX_TOOL_ENTITIES) +
              " more omitted — narrow the query with domain and/or area",
          };
        }
        return entities;
      },
      touchedIds(_args, result) {
        const items =
          result && typeof result === "object" && "entities" in result
            ? result.entities
            : result;
        if (Array.isArray(items)) {
          return items
            .filter((e) => e && typeof e === "object" && "entity_id" in e)
            .map((e) => e.entity_id as string);
        }
        return [];
      },
    },
    {
      name: "call_service",
      description:
        "Call a Home Assistant service to control a device, e.g. " +
        "domain='light', service='turn_on', entity_id='light.kitchen', " +
        "data={'brightness_pct': 50}.",
      parameters: {
        type: "object",
        properties: {
          domain: { type: "string" },
          service: { type: "string" },
          entity_id: { type: "string" },
          data: { type: "object", description: "Optional extra service data" },
        },
        required: ["domain", "service", "entity_id"],
      },
      async handler(args) {
        return ha.callService(args.domain, args.service, args.entity_id, args.data);
      },
      touchedIds(args) {
        return args.entity_id ? [args.entity_id] : [];
      },
    },
  ];
}
