import { pathToFileURL } from 'node:url';
import { createDashboardQueryService, type DashboardQueryService } from '@gdh/artifact-store';
import { taskClassValues } from '@gdh/domain';
import { findRepoRoot, phaseMetadata } from '@gdh/shared';
import Fastify, { type FastifyInstance } from 'fastify';

export interface BuildServerOptions {
  queryService?: DashboardQueryService;
  repoRoot?: string;
}

function artifactContentType(format: string): string {
  switch (format) {
    case 'json':
      return 'application/json; charset=utf-8';
    case 'markdown':
      return 'text/markdown; charset=utf-8';
    case 'patch':
      return 'text/x-diff; charset=utf-8';
    default:
      return 'text/plain; charset=utf-8';
  }
}

export function buildServer(options: BuildServerOptions = {}): FastifyInstance {
  const app = Fastify({ logger: false });
  const queryService =
    options.queryService ??
    createDashboardQueryService({
      repoRoot: options.repoRoot ?? process.cwd(),
    });

  app.get('/health', async () => {
    return {
      status: 'ok',
      phase: phaseMetadata.phase,
    };
  });

  app.get('/meta', async () => {
    return {
      ...phaseMetadata,
      supportedTaskClasses: taskClassValues,
    };
  });

  app.get('/api/overview', async () => {
    return queryService.getOverview();
  });

  app.get('/api/runs', async (request) => {
    const query = request.query as { sort?: string; status?: string };
    return {
      items: await queryService.listRuns({
        status: query.status,
        sort:
          query.sort === 'updated_asc' ||
          query.sort === 'created_desc' ||
          query.sort === 'created_asc'
            ? query.sort
            : 'updated_desc',
      }),
    };
  });

  app.get('/api/runs/:runId', async (request, reply) => {
    const params = request.params as { runId: string };
    const detail = await queryService.getRunDetail(params.runId);

    if (!detail) {
      reply.code(404);
      return {
        error: 'Run not found.',
        runId: params.runId,
      };
    }

    return detail;
  });

  app.get('/api/approvals', async () => {
    return {
      items: await queryService.listApprovals(),
    };
  });

  app.get('/api/benchmarks', async () => {
    return {
      items: await queryService.listBenchmarks(),
    };
  });

  app.get('/api/benchmarks/:benchmarkRunId', async (request, reply) => {
    const params = request.params as { benchmarkRunId: string };
    const detail = await queryService.getBenchmarkDetail(params.benchmarkRunId);

    if (!detail) {
      reply.code(404);
      return {
        benchmarkRunId: params.benchmarkRunId,
        error: 'Benchmark run not found.',
      };
    }

    return detail;
  });

  app.get('/api/failures', async () => {
    return queryService.getFailureTaxonomy();
  });

  app.get('/api/artifacts/content', async (request, reply) => {
    const query = request.query as { path?: string };

    if (!query.path) {
      reply.code(400);
      return {
        error: 'The "path" query parameter is required.',
      };
    }

    const artifact = await queryService.readArtifactContent(query.path);

    if (!artifact) {
      reply.code(404);
      return {
        error: 'Artifact not found or not available for preview.',
        path: query.path,
      };
    }

    reply.header('content-type', artifactContentType(artifact.format));
    return artifact.content;
  });

  return app;
}

export async function startServer(port = Number(process.env.API_PORT ?? 3000)): Promise<void> {
  const repoRoot = await findRepoRoot(process.cwd());
  const app = buildServer({ repoRoot });
  await app.listen({ port, host: '0.0.0.0' });
}

const entrypoint = process.argv[1];

if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  void startServer();
}
