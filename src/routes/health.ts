import type { FastifyPluginAsync } from 'fastify';

export const healthRoutes: FastifyPluginAsync = async (app) => {
  // Lo usará también el "latido" externo (healthchecks) y el monitor cruzado entre nodos.
  app.get('/health', async () => ({ ok: true, ts: Math.floor(Date.now() / 1000) }));
};
