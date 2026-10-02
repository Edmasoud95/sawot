import type { FastifyInstance } from 'fastify';
import { PushNotifications, validateSubscription } from './pushNotifications.js';

export function registerPushRoutes(app: FastifyInstance, notifications: PushNotifications | null, allowedOrigins: readonly string[]): void {
  app.get('/api/notifications/key', async (_req, reply) => {
    reply.header('Cache-Control', 'no-store');
    return { available: Boolean(notifications), publicKey: notifications?.publicKey() ?? null };
  });
  const options = { bodyLimit: 16 * 1024, preHandler: async (req: any, reply: any) => {
    const origin = req.headers.origin;
    let sameOrigin = false;
    try { sameOrigin = origin === new URL(`${req.protocol}://${req.host}`).origin; } catch { /* invalid host */ }
    if (typeof origin !== 'string' || (!sameOrigin && !allowedOrigins.includes(origin))) {
      return reply.code(403).send({ detail: 'Untrusted notification request origin' });
    }
    if (!notifications) return reply.code(503).send({ detail: 'Response notifications are unavailable on this server' });
    reply.header('Cache-Control', 'no-store');
  } };
  app.post('/api/notifications/subscription', options, async (req: any, reply) => {
    const body = req.body;
    if (!body || (body.capability !== undefined && (typeof body.capability !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(body.capability)))) {
      return reply.code(400).send({ detail: 'Invalid notification registration' });
    }
    try { validateSubscription(body.subscription); }
    catch { return reply.code(400).send({ detail: 'Unsupported or invalid push subscription' }); }
    try { return { capability: notifications!.register(body.subscription, body.capability) }; }
    catch (error: any) {
      if (error.message.includes('already registered')) return reply.code(409).send({ detail: 'Reset the notification subscription on this device and try again' });
      if (error.message.includes('limit')) return reply.code(429).send({ detail: 'Notification device limit reached' });
      return reply.code(503).send({ detail: 'Notification registration could not be saved' });
    }
  });
  app.delete('/api/notifications/subscription', options, async (req: any, reply) => {
    const capability = req.body?.capability;
    if (typeof capability !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(capability)) return reply.code(400).send({ detail: 'Invalid notification registration' });
    try { notifications!.remove(capability); return reply.code(204).send(); }
    catch { return reply.code(503).send({ detail: 'Notification removal could not be saved' }); }
  });
}
