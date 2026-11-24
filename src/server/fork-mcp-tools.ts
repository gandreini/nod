import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { z } from 'zod';
import type { DiscoveredCatalog, DiscoveredOAuthState } from '../ports/discovered.ts';
import type { AccountRow } from './discovered-connections.ts';
import type { createAppGrantVault } from './vault-app-grants.ts';

type McpPath = Extract<AccountRow['paths'][number], { kind: 'mcp' }>;
type CatalogEntry = { at: number; value: Promise<DiscoveredCatalog>; ready?: DiscoveredCatalog };

export function registerForkMcpRoutes(
  app: FastifyInstance,
  options: {
    pool: Pool;
    owner: string;
    grantVault: Awaited<ReturnType<typeof createAppGrantVault>>;
    catalogs: Map<string, CatalogEntry>;
    catalog(
      row: AccountRow,
      path: McpPath,
      signal?: AbortSignal,
      allowStale?: boolean,
    ): Promise<DiscoveredCatalog>;
    refresh?: () => void;
    schema: { service: z.ZodType<string>; name: z.ZodType<string> };
    redact(value: unknown, token: string): unknown;
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

  async function secrets(row: AccountRow) {
    const secret = await options.grantVault
      .read(row.id)
      .then((grant) => grant.value)
      .catch(() => '');
    const found = [secret];
    try {
      const token = (JSON.parse(secret) as DiscoveredOAuthState).tokens?.access_token;
      if (token) found.push(token);
    } catch {}
    return found.filter(Boolean);
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
        const key = `${row.id}:${path.id}:${row.account_id}`;
        const previous = catalogs.get(key);
        const before = previous?.ready?.tools.map((tool) => tool.name);
        catalogs.delete(key);
        const tools = await catalog(row, path, signal).then(
          (listed) => listed.tools,
          async (cause: unknown) => {
            if (previous && !catalogs.has(key)) catalogs.set(key, previous);
            if (cause && typeof cause === 'object' && 'statusCode' in cause) throw cause;
            const message = (await secrets(row)).reduce<unknown>(
              (text, value) => options.redact(text, value),
              cause instanceof Error ? cause.message : String(cause),
            );
            throw error(`Couldn't read the tools from ${row.name}: ${String(message)}`, 502);
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

  async function rename(service: string, name: string) {
    await serviceRows(service);
    const parsed = options.schema.name.safeParse(name);
    if (!parsed.success)
      throw error(
        "Use 2 to 80 letters, digits, spaces or . & ' _ -, starting with a letter or digit.",
      );
    await pool.query('UPDATE discovered_connections SET name=$3 WHERE owner_id=$1 AND service=$2', [
      owner,
      service,
      parsed.data,
    ]);
    options.refresh?.();
    return { name: parsed.data };
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
  app.patch<{ Params: { service: string } }>(
    '/api/fork/apps/mcp/:service',
    async (request, reply) => {
      const { name } = z.object({ name: z.string() }).strict().parse(request.body);
      return reply
        .header('Cache-Control', 'no-store')
        .send(await rename(request.params.service, name));
    },
  );
}
