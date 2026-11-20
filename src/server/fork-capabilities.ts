import type { FastifyInstance } from 'fastify';

export function registerForkCapabilities(
  app: FastifyInstance,
  features: () => Record<string, object | undefined>,
) {
  app.get('/api/fork/capabilities', async () => ({
    features: Object.fromEntries(
      Object.entries(features()).filter((entry): entry is [string, object] => Boolean(entry[1])),
    ),
  }));
}
