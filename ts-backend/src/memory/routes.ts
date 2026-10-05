import type { FastifyInstance } from 'fastify';
import { MemoryStore } from './store.js';
export function registerMemoryRoutes(app: FastifyInstance, store: MemoryStore) {
  app.get('/api/memory', async () => store.list());
  app.patch<{
    Body: {
      enabled: boolean;
    };
  }>('/api/memory/settings', async req => store.setEnabled(req.body?.enabled));
  app.post<{
    Body: {
      confirm: boolean;
    };
  }>('/api/memory/clear', async (req, reply) => {
    if (req.body?.confirm !== true) return reply.code(400).send({
      error: 'Explicit confirmation is required'
    });
    return store.clear();
  });
  app.get<{
    Params: {
      id: string;
    };
  }>('/api/memory/activity/:id', async req => store.activity(req.params.id));
  app.get<{
    Params: {
      id: string;
    };
  }>('/api/memory/:id', async req => store.get(req.params.id));
  app.patch<{
    Params: {
      id: string;
    };
    Body: {
      text: string;
      revision: number;
    };
  }>('/api/memory/:id', async req => store.edit(req.params.id, req.body?.text, req.body?.revision));
  app.delete<{
    Params: {
      id: string;
    };
    Body: {
      revision: number;
    };
  }>('/api/memory/:id', async req => store.delete(req.params.id, req.body?.revision));
}
