import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
export interface MemoryFact {
  id: string;
  revision: number;
  text: string;
  topic: string;
  category: string;
  private?: boolean;
  sourceConversationId: string;
  sourceMessageId: string;
  captureMode: 'automatic' | 'explicit' | 'settings';
  created: string;
  updated: string;
}
export interface MemoryEvent {
  id: string;
  turnId: string;
  sourceMessageId: string;
  kind: 'saved' | 'updated' | 'recalled' | 'deleted';
  created: string;
  memories: Array<Partial<MemoryFact> & {
    id: string;
    revision: number;
  }>;
}
interface State {
  version: 1;
  owner: string;
  enabled: boolean;
  generation: number;
  facts: MemoryFact[];
  events: Array<MemoryEvent & {
    conversationId: string;
  }>;
  operations: Record<string, string>;
  sources: Record<string, number>;
  tombstones: string[];
  privateConversations?: string[];
}
export interface MemoryTurnScope {
  conversationId: string;
  turnId: string;
  sourceMessageId: string;
  text: string;
  generation: number;
  regenerating: boolean;
  signal?: AbortSignal;
  deleteTarget?: string;
  deletionUsed: boolean;
  privateMemoryAccess?: () => boolean;
  onPrivateMemory?: () => void;
  privateMemoryUsed?: boolean;
}
const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const words = (s: string) => norm(s)
  .replace(/\b(graphics card|video card)\b/g, 'gpu')
  .replace(/\b(where i live|where you live|current city|home city|location)\b/g, 'location')
  .replace(/\b(what i do for a living|where i work|occupation|job)\b/g, 'occupation')
  .split(' ').filter(w => w.length > 2 && !['the', 'you', 'own', 'which', 'forget', 'memory', 'remember', 'about', 'please', 'delete', 'remove', 'user', 'that', 'this'].includes(w));
export class MemoryError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
  }
}
export class MemoryStore {
  private state!: State;
  private queue: Promise<unknown> = Promise.resolve();
  private ready?: Promise<void>;
  private path: string;
  private listeners = new Set<() => void>();
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  constructor(dataDir: string, private owner = 'default') {
    this.path = join(dataDir, 'data', 'memory', `${owner}.json`);
  }
  isEnabled() {
    return this.state?.enabled ?? false;
  }
  isActive(t: MemoryTurnScope) {
    return !!this.state?.enabled && t.generation === this.state.generation && !t.signal?.aborted && (!t.privateMemoryUsed || t.privateMemoryAccess?.() === true);
  }
  init(): Promise<void> {
    return this.ready ??= this.load();
  }
  private async load() {
    await mkdir(join(this.path, '..'), {
      recursive: true
    });
    try {
      this.state = JSON.parse(await readFile(this.path, 'utf8'));
      if (this.state.version !== 1 || this.state.owner !== this.owner || !Array.isArray(this.state.facts) || !Array.isArray(this.state.events) || !Array.isArray(this.state.tombstones) || typeof this.state.enabled !== 'boolean' || !Number.isInteger(this.state.generation) || !this.state.operations || !this.state.sources) throw Error('Unsupported memory store');
    } catch (e: any) {
      if (e.code !== 'ENOENT') throw e;
      this.state = {
        version: 1,
        owner: this.owner,
        enabled: true,
        generation: 0,
        facts: [],
        events: [],
        operations: {},
        sources: {},
        tombstones: []
      };
    }
  }
  private async mutate<T>(fn: (s: State) => T): Promise<T> {
    await this.init();
    const work = this.queue.then(async () => {
      const next = structuredClone(this.state);
      const result = fn(next);
      const tmp = this.path + '.' + randomUUID() + '.tmp';
      try {
        await writeFile(tmp, JSON.stringify(next), { mode: 0o600, flag: 'wx' });
        await rename(tmp, this.path);
      } finally {
        await rm(tmp, { force: true }).catch(() => {});
      }
      this.state = next;
      for (const listener of this.listeners) { try { listener(); } catch { /* Storage commit already succeeded. */ } }
      return result;
    });
    this.queue = work.catch(() => {});
    return work;
  }
  private async read() {
    await this.init();
    await this.queue;
    return this.state;
  }
  async list() {
    const s = await this.read();
    return {
      enabled: s.enabled,
      memories: structuredClone(s.facts)
    };
  }
  private visible(f: Partial<MemoryFact>, t: MemoryTurnScope) {
    return !f.private || t.privateMemoryAccess?.() === true;
  }
  private protect(s: State, fact: Partial<MemoryFact>) {
    if (!fact.private) return;
    const ids = new Set(s.privateConversations ?? []);
    if (fact.sourceConversationId) ids.add(fact.sourceConversationId);
    for (const event of s.events) if (event.memories.some(m => m.id === fact.id)) ids.add(event.conversationId);
    s.privateConversations = [...ids].filter(Boolean);
  }
  conversationIsPrivate(id: string): boolean {
    return this.state?.privateConversations?.includes(id) ?? false;
  }
  async isConversationPrivate(id: string): Promise<boolean> {
    await this.read();
    return this.conversationIsPrivate(id);
  }
  private expose(t: MemoryTurnScope, facts: Array<Partial<MemoryFact>>) {
    if (!facts.some(f => f.private)) return;
    if (t.privateMemoryAccess?.() !== true) throw new MemoryError(403, "Choose a private provider to use private memories");
    t.onPrivateMemory?.();
    t.privateMemoryUsed = true;
  }
  async get(id: string, t?: MemoryTurnScope) {
    const s = await this.read();
    const f = s.facts.find(f => f.id === id);
    if (!f || t && !this.visible(f, t)) throw new MemoryError(404, 'Memory no longer exists');
    if (t) { this.gate(s, t); this.expose(t, [f]); }
    return structuredClone(f);
  }
  async beginTurn(input: Omit<MemoryTurnScope, 'generation' | 'deletionUsed' | 'regenerating'> & {
    regenerating?: boolean;
  }): Promise<MemoryTurnScope> {
    const s = await this.read();
    const scope: MemoryTurnScope = {
      ...input,
      generation: s.generation,
      regenerating: !!input.regenerating,
      deletionUsed: false
    };
    if (/\b(forget|delete|remove)\b/i.test(input.text) && !/\b(everything|all|every|entire|not|don't|never)\b/i.test(input.text)) {
      const terms = words(input.text);
      const matches = s.facts.filter(f => this.visible(f, scope) && terms.some(w => words(f.topic + ' ' + f.text + ' ' + f.category).includes(w)));
      if (matches.length === 1) scope.deleteTarget = matches[0].id;
    }
    return scope;
  }
  private gate(s: State, t: MemoryTurnScope, write = false) {
    if (!s.enabled) throw new MemoryError(409, 'Memory is disabled');
    if (t.signal?.aborted || t.generation !== s.generation || t.privateMemoryUsed && t.privateMemoryAccess?.() !== true) throw new MemoryError(409, 'Memory work expired');
    if (write && (t.regenerating || s.sources[t.sourceMessageId] !== undefined && s.sources[t.sourceMessageId] !== t.generation)) throw new MemoryError(409, 'This source cannot write memory again');
  }
  private event(s: State, t: MemoryTurnScope, kind: MemoryEvent['kind'], facts: MemoryEvent['memories']) {
    const e = {
      id: randomUUID(),
      turnId: t.turnId,
      sourceMessageId: t.sourceMessageId,
      kind,
      created: new Date().toISOString(),
      memories: structuredClone(facts),
      conversationId: t.conversationId
    };
    this.expose(t, facts);
    s.events.push(e);
    for (const f of facts) this.protect(s, f);
    return structuredClone(e);
  }
  private validate(text: string) {
    if (typeof text !== 'string' || !text.trim() || text.length > 1000) throw new MemoryError(400, 'Memory text must contain 1–1000 characters');
    if (/\b(api[ _-]?key|password|secret|access[ _-]?token|bearer|private[ _-]?key)\b/i.test(text)) throw new MemoryError(400, 'Credentials cannot be saved');
  }
  async capture(t: MemoryTurnScope, args: {
    text: string;
    topic: string;
    category?: string;
    quote: string;
    id?: string;
    revision?: number;
    captureMode?: 'automatic' | 'explicit';
    private?: boolean;
  }) {
    const event = await this.mutate(s => {
      const op = createHash('sha256').update(`${t.sourceMessageId}:capture:${norm(args.topic ?? '')}`).digest('hex');
      this.gate(s, t, true);
      const existingEvent = s.operations[op];
      if (args.private !== undefined && typeof args.private !== 'boolean') throw new MemoryError(400, 'private must be boolean');
      if (args.private && t.privateMemoryAccess?.() !== true) throw new MemoryError(403, 'Choose a private provider to save private memories');
      if (existingEvent) {
        const event = s.events.find(e => e.id === existingEvent)!;
        if (event.memories.some(f => !this.visible(f, t))) throw new MemoryError(404, 'Memory no longer exists');
        this.expose(t, event.memories);
        return structuredClone(event);
      }
      this.gate(s, t, true);
      this.validate(args.text);
      if (!args.quote?.trim() || !t.text.includes(args.quote)) throw new MemoryError(400, 'Quote must be an exact span of the current user message');
      if (/\b(api[ _-]?key|password|secret|access[ _-]?token|bearer|private[ _-]?key)\b/i.test(t.text)) throw new MemoryError(400, 'Credentials cannot be saved');
      if (/\b(forget|delete|remove)\b/i.test(t.text) || /\b(do not|don't|never) (remember|save)\b/i.test(t.text)) throw new MemoryError(400, 'This message does not authorize saving a memory');
      const quoteStart = t.text.indexOf(args.quote);
      const sentenceStart = Math.max(t.text.lastIndexOf('.', quoteStart), t.text.lastIndexOf('!', quoteStart), t.text.lastIndexOf('?', quoteStart)) + 1;
      const assertion = t.text.slice(sentenceStart, quoteStart + args.quote.length);
      if (args.captureMode !== 'explicit' && /\b(if|hypothetically|imagine|suppose|example)\b/i.test(assertion)) throw new MemoryError(400, 'Hypothetical facts require an explicit remember request');
      if (args.captureMode !== 'explicit' && !/\b(I|my|me)\b/i.test(args.quote)) throw new MemoryError(400, 'Capture requires a personal assertion');
      if (args.captureMode === 'explicit' && !/\b(remember|save|keep in mind)\b/i.test(t.text)) throw new MemoryError(400, 'Explicit capture needs a current remember request');
      if (args.category && !['location', 'occupation', 'preference', 'equipment', 'hardware', 'other'].includes(args.category)) throw new MemoryError(400, 'Invalid memory category');
      if (args.captureMode !== 'explicit' && /\b(my friend|my colleague|my partner|my brother|my sister)\b/i.test(t.text)) throw new MemoryError(400, 'Capture needs an unambiguous personal assertion');
      if (args.captureMode !== 'explicit' && /\b(not|don't|never)\b/i.test(args.quote)) throw new MemoryError(400, 'Please explicitly request saving this negative fact');
      this.validate(args.topic);
      const topic = norm(args.topic ?? '');
      if (!topic || topic.length > 120) throw new MemoryError(400, 'A short canonical topic is required');
      let f = args.id ? s.facts.find(f => f.id === args.id && this.visible(f, t)) : s.facts.find(f => this.visible(f, t) && (f.topic === topic || norm(f.text) === norm(args.text)));
      if (args.id && !f) throw new MemoryError(404, 'Memory no longer exists');
      if (f?.private && args.private === false) throw new MemoryError(403, 'Only the user can remove memory privacy');
      if (f && !args.id && norm(f.text) === norm(args.text) && (!args.private || f.private)) {
        s.sources[t.sourceMessageId] = s.generation;
        const event = this.event(s, t, 'saved', [f]);
        s.operations[op] = event.id;
        return event;
      }
      const existingId = f?.id;
      if (existingId && s.facts.some(other => other.id !== existingId && this.visible(other, t) && other.topic === topic)) throw new MemoryError(409, 'Another memory already uses this topic');
      if (f && args.revision !== f.revision) throw new MemoryError(409, 'Reload the current memory revision before updating');
      const now = new Date().toISOString();
      const kind = f ? 'updated' : 'saved';
      if (f) {
        s.sources[f.sourceMessageId] = -1;
        s.generation++;
        t.generation = s.generation;
        Object.assign(f, {
          text: args.text,
          private: f.private || args.private === true,
          topic,
          category: args.category ?? f.category,
          revision: f.revision + 1,
          updated: now,
          sourceConversationId: t.conversationId,
          sourceMessageId: t.sourceMessageId
        });
      } else {
        if (s.facts.length >= 500) throw new MemoryError(409, 'Memory capacity reached');
        f = {
          id: randomUUID(),
          revision: 1,
          private: args.private === true,
          text: args.text,
          topic,
          category: args.category ?? 'other',
          sourceConversationId: t.conversationId,
          sourceMessageId: t.sourceMessageId,
          captureMode: args.captureMode ?? 'automatic',
          created: now,
          updated: now
        };
        s.facts.push(f);
      }
      s.sources[t.sourceMessageId] = s.generation;
      const e = this.event(s, t, kind, [f]);
      s.operations[op] = e.id;
      return e;
    });
    if (!this.isActive(t)) throw new MemoryError(409, "Memory work expired");
    return event;
  }
  private select(s: State, query: string, t: MemoryTurnScope) {
    const terms = [...new Set(words(query))];
    const ranked = s.facts.filter(f => this.visible(f, t)).map(f => ({
      f,
      score: terms.filter(w => words(f.topic + ' ' + f.text + ' ' + f.category).includes(w)).length,
    })).filter(x => x.score > 0 || !terms.length).sort((a, b) => b.score - a.score);
    // Facts are capped at 1,000 characters each. Three results bound fact text
    // to 3,000 characters without loading unrelated core categories.
    return ranked.slice(0, 3).map(x => structuredClone(x.f));
  }
  async recordRecall(t: MemoryTurnScope, facts: MemoryFact[]) {
    return this.mutate(s => {
      if (!s.enabled || t.signal?.aborted || t.generation !== s.generation) return null;
      const current = facts.filter(f => this.visible(f, t) && s.facts.some(c => c.id === f.id && c.revision === f.revision));
      const unseen = current.filter(f => !s.events.some(e => e.kind === 'recalled' && e.turnId === t.turnId && e.conversationId === t.conversationId && e.memories.some(m => m.id === f.id && m.revision === f.revision)));
      return unseen.length ? this.event(s, t, 'recalled', unseen) : null;
    });
  }
  async search(t: MemoryTurnScope, query: string) {
    const s = await this.read();
    this.gate(s, t);
    const facts = this.select(s, /what.*remember|list.*memor/i.test(query) ? '' : query, t);
    const event = await this.recordRecall(t, facts);
    return {
      memories: this.isActive(t) ? facts.filter(f => this.visible(f, t) && this.state.facts.some(m => m.id === f.id && m.revision === f.revision)) : [],
      event: this.isActive(t) ? event : null
    };
  }
  private redact(s: State, id: string) {
    for (const e of s.events) e.memories = e.memories.map(m => m.id === id ? {
      id: m.id,
      revision: m.revision,
      ...(m.private ? { private: true } : {})
    } : m);
    s.tombstones.push(id);
  }
  async delete(id: string, revision: number, t?: MemoryTurnScope) {
    return this.mutate(s => {
      if (t) {
        this.gate(s, t, true);
        if (t.deletionUsed || t.deleteTarget !== id) throw new MemoryError(403, 'Deletion needs one specific current user target; use Settings to clear memories');
      }
      const f = s.facts.find(f => f.id === id);
      if (!f || t && !this.visible(f, t)) throw new MemoryError(404, 'Memory no longer exists');
      if (t) this.expose(t, [f]);
      this.protect(s, f);
      if (f.revision !== revision) throw new MemoryError(409, 'Reload the current memory revision');
      s.facts = s.facts.filter(f => f.id !== id);
      this.redact(s, id);
      s.sources[f.sourceMessageId] = -1;
      s.generation++;
      if (t) {
        t.deletionUsed = true;
        t.generation = s.generation;
        s.sources[t.sourceMessageId] = -1;
      }
      return this.event(s, t ?? {
        conversationId: '',
        turnId: '',
        sourceMessageId: '',
        text: '',
        generation: s.generation,
        regenerating: false,
        deletionUsed: true
      }, 'deleted', [{
        id,
        revision
      }]);
    });
  }
  async edit(id: string, text: string, revision: number, privateFlag?: boolean) {
    return this.mutate(s => {
      this.validate(text);
      if (privateFlag !== undefined && typeof privateFlag !== 'boolean') throw new MemoryError(400, 'private must be boolean');
      const f = s.facts.find(f => f.id === id);
      if (!f) throw new MemoryError(404, 'Memory no longer exists');
      if (f.revision !== revision) throw new MemoryError(409, 'Reload the current memory revision');
      s.sources[f.sourceMessageId] = -1;
      s.generation++;
      Object.assign(f, {
        text,
        ...(privateFlag !== undefined ? { private: privateFlag } : {}),
        revision: f.revision + 1,
        updated: new Date().toISOString(),
        captureMode: 'settings'
      });
      this.protect(s, f);
      return structuredClone(f);
    });
  }
  async setEnabled(enabled: boolean) {
    if (typeof enabled !== 'boolean') throw new MemoryError(400, 'enabled must be boolean');
    return this.mutate(s => {
      if (s.enabled !== enabled) s.generation++;
      s.enabled = enabled;
      return {
        enabled
      };
    });
  }
  async clear() {
    return this.mutate(s => {
      for (const f of s.facts) this.redact(s, f.id);
      s.facts = [];
      s.generation++;
      for (const source of Object.keys(s.sources)) s.sources[source] = -1;
      return {
        enabled: s.enabled,
        memories: []
      };
    });
  }
  async eventsForConversation(id: string) {
    const s = await this.read();
    return structuredClone(s.events.filter(e => e.conversationId === id));
  }
  async activity(id: string) {
    const s = await this.read();
    const e = s.events.find(e => e.id === id);
    if (!e) throw new MemoryError(404, 'Memory activity not found');
    return {
      ...structuredClone(e),
      memories: e.memories.map(m => ({
        ...structuredClone(m),
        status: s.facts.some(f => f.id === m.id) ? 'active' : 'deleted',
        current: s.facts.find(f => f.id === m.id) ? structuredClone(s.facts.find(f => f.id === m.id)) : undefined
      }))
    };
  }
}
