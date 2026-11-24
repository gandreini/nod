import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import type { z } from 'zod';
import type { DiscoveredCatalog } from '../ports/discovered.ts';
import type { AccountRow } from './discovered-connections.ts';

type McpPath = Extract<AccountRow['paths'][number], { kind: 'mcp' }>;
type CatalogEntry = { at: number; value: Promise<DiscoveredCatalog>; ready?: DiscoveredCatalog };

export function registerForkMcpRoutes(
  app: FastifyInstance,
  options: {
    pool: Pool;
    owner: string;
    catalogs: Map<string, CatalogEntry>;
    catalog(
      row: AccountRow,
      path: McpPath,
      signal?: AbortSignal,
      allowStale?: boolean,
    ): Promise<DiscoveredCatalog>;
    schema: { service: z.ZodType<string> };
    error(message: string, statusCode?: number): Error;
  },
) {
  const { pool, owner, catalogs, catalog, error } = options;
  const paths = (rows: AccountRow[]) =>
    rows.flatMap((row) =>
      row.paths.flatMap((path) => (path.kind === 'mcp' ? [{ row, path: path as McpPath }] : [])),
    );

  async function serviceRows(service: string) {
    const rows = (
      await pool.query<AccountRow>(
        'SELECT * FROM discovered_connections WHERE owner_id=$1 AND service=$2 ORDER BY created_at',
        [owner, options.schema.service.parse(service)],
      )
    ).rows;
    if (!rows.length) throw error('This connected service is unavailable.', 404);
    return rows;
  }

  async function toolCounts() {
    const rows = (
      await pool.query<AccountRow>(
        'SELECT * FROM discovered_connections WHERE owner_id=$1 AND NOT reconnect_required',
        [owner],
      )
    ).rows;
    const counts = await Promise.all(
      paths(rows).map(({ row, path }) =>
        Promise.race([
          catalog(row, path, AbortSignal.timeout(20_000), true).then(
            ({ tools }) => ({ connectionId: row.id, tools: tools.length }),
            () => undefined,
          ),
          new Promise<undefined>((resolve) => setTimeout(resolve, 3_000)),
        ]),
      ),
    );
    return counts.filter((count) => count !== undefined);
  }

  async function refreshTools(service: string, signal?: AbortSignal) {
    const found = paths((await serviceRows(service)).filter((row) => !row.reconnect_required));
    if (!found.length) throw error('This service has no connected MCP server to refresh.', 409);
    const results = await Promise.all(
      found.map(async ({ row, path }) => {
        const key = JSON.stringify([row.id, row.account_id, path]);
        const previous = catalogs.get(key);
        const before = previous?.ready?.tools.map((tool) => tool.name);
        catalogs.delete(key);
        const tools = await catalog(row, path, signal).then(
          (listed) => listed.tools,
          (cause: unknown) => {
            if (previous && !catalogs.has(key)) catalogs.set(key, previous);
            throw cause;
          },
        );
        const names = tools.map((tool) => tool.name);
        return {
          connectionId: row.id,
          tools: names.length,
          ...(before
            ? {
                added: names.filter((name) => !before.includes(name)),
                removed: before.filter((name) => !names.includes(name)),
              }
            : {}),
        };
      }),
    );
    return { results };
  }

  app.get('/api/fork/apps/mcp/tools', async (_request, reply) =>
    reply.header('Cache-Control', 'no-store').send({ counts: await toolCounts() }),
  );
  app.post<{ Params: { service: string } }>(
    '/api/fork/apps/mcp/:service/refresh',
    async (request, reply) => {
      const controller = new AbortController();
      reply.raw.once('close', () => controller.abort());
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]);
      return reply
        .header('Cache-Control', 'no-store')
        .send(await refreshTools(request.params.service, signal));
    },
  );
}
