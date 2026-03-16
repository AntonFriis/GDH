import { pathToFileURL } from 'node:url';
import { taskClassValues } from '@gdh/domain';
import { phaseZeroMetadata } from '@gdh/shared';
import Fastify, { type FastifyInstance } from 'fastify';

export function buildServer(): FastifyInstance {
  const app = Fastify({ logger: false });

  app.get('/health', async () => {
    return {
      status: 'ok',
      phase: phaseZeroMetadata.phase,
    };
  });

  app.get('/meta', async () => {
    return {
      ...phaseZeroMetadata,
      supportedTaskClasses: taskClassValues,
    };
  });

  return app;
}

export async function startServer(port = Number(process.env.API_PORT ?? 3000)): Promise<void> {
  const app = buildServer();
  await app.listen({ port, host: '0.0.0.0' });
}

const entrypoint = process.argv[1];

if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  void startServer();
}
