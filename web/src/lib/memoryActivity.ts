import type { MemoryEvent } from './memoryApi';

/** Group the display only; original activity IDs still own detail requests. */
export function groupMemoryEvents(events: MemoryEvent[]): MemoryEvent[][] {
  const groups: MemoryEvent[][] = [];
  for (const event of events) {
    const previous = groups[groups.length - 1];
    if (event.kind === 'recalled' && previous?.[0].kind === 'recalled') previous.push(event);
    else groups.push([event]);
  }
  return groups;
}

export function combinedMemoryFacts(events: MemoryEvent[]): MemoryEvent['memories'] {
  const facts = new Map<string, MemoryEvent['memories'][number]>();
  for (const event of events) for (const fact of event.memories) {
    // Preserve distinct versions actually supplied to the model.
    facts.set(JSON.stringify([fact.id, fact.revision]), fact);
  }
  return [...facts.values()];
}
