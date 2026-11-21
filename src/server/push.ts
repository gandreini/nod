import type { FastifyInstance } from 'fastify';
import type { Nodes } from 'mdast';
import type { Pool } from 'pg';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { z } from 'zod';
import type { PushPlatform, PushSender } from '../ports/push.ts';
import type { Preferences } from '../shared/contracts.ts';
import { events, type ServerEvent } from './events.ts';
import { isQuietTime } from './preferences.ts';
import { workOriginSql } from './turn-chain.ts';

type QuietHours = Pick<Preferences, 'quietHoursEnabled' | 'quietStart' | 'quietEnd' | 'timeZone'>;

export interface PushOptions {
  pool: Pool;
  ownerId: string;
  sender?: PushSender;
  quietHours(): Promise<QuietHours>;
  redact(text: string): string;
  failure?: (event: string, error: unknown, context?: Record<string, unknown>) => void;
}

const deviceToken = z
  .string()
  .min(1)
  .max(4096)
  .regex(/^[\w:.-]+$/);
const registration = z.object({ token: deviceToken, platform: z.literal('android') });
const removal = z.object({ token: deviceToken });
const unavailable = { error: 'Push notifications are not set up on this server.' };
const parser = unified().use(remarkParse);
const breaks = new Set(['paragraph', 'heading', 'listItem', 'tableCell', 'break']);

export function notificationText(
  text: string,
  attachments: unknown,
  redact: (text: string) => string,
) {
  let plain = '';
  function walk(node: Nodes) {
    if (node.type === 'code' || node.type === 'html' || node.type === 'definition') return;
    if (node.type === 'image') plain += node.alt ? `${node.alt} ` : '';
    else if (node.type === 'text' || node.type === 'inlineCode') plain += node.value;
    if ('children' in node) for (const child of node.children) walk(child as Nodes);
    if (breaks.has(node.type)) plain += ' ';
  }
  try {
    walk(parser.parse(text.slice(0, 16_384)));
  } catch {
    plain = text;
  }
  let body = redact(plain).replace(/\s+/g, ' ').trim();
  if (!body) {
    const files: unknown[] = Array.isArray(attachments) ? attachments : [];
    const first = files[0] as { name?: unknown } | undefined;
    const name = files.length === 1 && typeof first?.name === 'string' ? first.name.trim() : '';
    body =
      files.length > 1
        ? `Shared ${files.length} attachments.`
        : name
          ? `Shared ${redact(name)}`
          : files.length
            ? 'Shared an attachment.'
            : 'You have a new message from Nod.';
  }
  const characters = Array.from(body);
  return characters.length > 240 ? `${characters.slice(0, 239).join('').trimEnd()}…` : body;
}

const newMessages = `
  FROM messages m LEFT JOIN turns u ON u.id=m.turn_id AND u.owner_id=m.owner_id
  WHERE m.owner_id=$1 AND m.role='assistant' AND m.hidden_at IS NULL
    AND COALESCE(u.channel,m.delivered_channel,'web')='web'
    AND m.created_at >= GREATEST((SELECT since FROM push_state WHERE owner_id=$1), now()-interval '10 minutes')
    AND NOT EXISTS (SELECT 1 FROM push_sent s WHERE s.message_id=m.id)`;

const fromSchedule = `EXISTS(SELECT 1 FROM turns o ${workOriginSql('o')}
  WHERE o.id=m.turn_id AND o.owner_id=m.owner_id AND work_origin.source='schedule')`;

export function createPush(options: PushOptions) {
  const { pool, ownerId, sender } = options;

  async function initialize() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS push_devices (
        token text PRIMARY KEY, owner_id text NOT NULL, platform text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        last_seen_at timestamptz NOT NULL DEFAULT clock_timestamp()
      );
      CREATE INDEX IF NOT EXISTS push_devices_owner ON push_devices(owner_id,last_seen_at);
      CREATE TABLE IF NOT EXISTS push_state (owner_id text PRIMARY KEY, since timestamptz NOT NULL);
      CREATE TABLE IF NOT EXISTS push_sent (
        message_id uuid PRIMARY KEY, owner_id text NOT NULL, sent_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await pool.query(
      'INSERT INTO push_state(owner_id,since) VALUES($1,clock_timestamp()) ON CONFLICT(owner_id) DO NOTHING',
      [ownerId],
    );
  }

  function feature() {
    return sender ? { version: 1, platforms: [...sender.platforms] } : undefined;
  }

  function registerRoutes(app: FastifyInstance) {
    app.put('/api/fork/push/devices', async (request, reply) => {
      if (!sender) return reply.code(404).send(unavailable);
      const parsed = registration.safeParse(request.body);
      if (!parsed.success)
        return reply
          .code(400)
          .send({ error: 'Send an Android FCM token as { token, platform: "android" }.' });
      await pool.query(
        `INSERT INTO push_devices(token,owner_id,platform) VALUES($1,$2,$3)
         ON CONFLICT(token) DO UPDATE SET owner_id=$2,platform=$3,last_seen_at=clock_timestamp()`,
        [parsed.data.token, ownerId, parsed.data.platform],
      );
      await pool.query(
        `DELETE FROM push_devices WHERE owner_id=$1 AND token IN (
           SELECT token FROM push_devices WHERE owner_id=$1
           ORDER BY last_seen_at DESC,created_at DESC OFFSET 20)`,
        [ownerId],
      );
      return reply.code(204).send();
    });
    app.delete('/api/fork/push/devices', async (request, reply) => {
      if (!sender) return reply.code(404).send(unavailable);
      const parsed = removal.safeParse(request.body);
      if (!parsed.success)
        return reply.code(400).send({ error: 'Send the token to remove as { token }.' });
      await pool.query('DELETE FROM push_devices WHERE owner_id=$1 AND token=$2', [
        ownerId,
        parsed.data.token,
      ]);
      return reply.code(204).send();
    });
  }

  async function pass(active: PushSender) {
    if (isQuietTime(await options.quietHours())) {
      await pool.query(
        `INSERT INTO push_sent(message_id,owner_id) SELECT m.id,m.owner_id ${newMessages}
           AND NOT ${fromSchedule}
         ON CONFLICT(message_id) DO NOTHING`,
        [ownerId],
      );
    }
    const claimed = await pool.query<{ id: string; text: string; attachments: unknown }>(
      `WITH picked AS (
         SELECT m.id,m.text,m.attachments,m.created_at ${newMessages}
         ORDER BY m.created_at,m.id LIMIT 10
       ), claimed AS (
         INSERT INTO push_sent(message_id,owner_id) SELECT id,$1 FROM picked
         ON CONFLICT(message_id) DO NOTHING RETURNING message_id
       )
       SELECT p.id,p.text,p.attachments FROM picked p JOIN claimed c ON c.message_id=p.id
       ORDER BY p.created_at,p.id`,
      [ownerId],
    );
    if (claimed.rowCount) {
      const devices = await pool.query<{ token: string; platform: PushPlatform }>(
        'SELECT token,platform FROM push_devices WHERE owner_id=$1',
        [ownerId],
      );
      for (const message of claimed.rows) {
        const notification = {
          title: 'Nod',
          body: notificationText(message.text, message.attachments, options.redact),
          data: { messageId: message.id },
        };
        for (const device of devices.rows) {
          const result = await active.send(device, notification);
          if (result.status === 'gone')
            await pool.query('DELETE FROM push_devices WHERE owner_id=$1 AND token=$2', [
              ownerId,
              device.token,
            ]);
          if (result.status === 'failed')
            options.failure?.(
              'push_send',
              { name: 'PushSendError', status: result.httpStatus },
              { reason: options.redact(result.reason), httpStatus: result.httpStatus },
            );
        }
      }
    }
    await pool.query(
      "DELETE FROM push_sent WHERE owner_id=$1 AND sent_at < now()-interval '1 day'",
      [ownerId],
    );
  }

  let running: Promise<void> | undefined;
  let again = false;
  function deliver(): Promise<void> {
    const active = sender;
    if (!active) return Promise.resolve();
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      do {
        again = false;
        try {
          await pass(active);
        } catch (error) {
          options.failure?.('push_delivery', error);
        }
      } while (again);
    })().finally(() => {
      running = undefined;
    });
    return running;
  }

  const listener = (event: ServerEvent) => {
    if (event.type === 'refresh') void deliver();
  };
  function start() {
    if (!sender) return;
    events.on('event', listener);
    void deliver();
  }
  async function stop() {
    events.off('event', listener);
    await running;
  }

  return { initialize, registerRoutes, feature, deliver, start, stop };
}
