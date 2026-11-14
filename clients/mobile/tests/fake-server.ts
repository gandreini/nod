import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function startFakeServer() {
  const data = await mkdtemp(join(tmpdir(), 'nod-mobile-'));
  const port = 43000 + Math.floor(Math.random() * 2000);
  const token = randomBytes(32).toString('hex');
  const controlToken = randomBytes(32).toString('hex');
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn('../../node_modules/.bin/tsx', ['tool/fake-server.mts'], {
    env: {
      ...process.env,
      NOD_VALIDATION_PORT: String(port),
      NOD_VALIDATION_TOKEN: token,
      NOD_VALIDATION_CONTROL_TOKEN: controlToken,
      NOD_VALIDATION_DATA: join(data, 'store.json'),
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise<void>((resolve, reject) => {
    child.once('exit', (code) => reject(new Error(`Fake server exited with code ${code}`)));
    child.stdout!.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes('"ready":true')) resolve();
    });
  });
  return {
    origin,
    token,
    control(path: string, body: unknown) {
      return fetch(`${origin}${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Fixture-Control': controlToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    },
    async stop() {
      child.kill('SIGTERM');
      await rm(data, { recursive: true, force: true });
    },
  };
}
