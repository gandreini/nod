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
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  const collect = (chunk: Buffer) => (output += chunk.toString());
  child.stdout!.on('data', collect);
  child.stderr!.on('data', collect);
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Fake server was not ready after 10 s. Output:\n${output}`)),
        10_000,
      );
      child.once('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`Fake server exited with code ${code}. Output:\n${output}`));
      });
      child.stdout!.on('data', () => {
        if (!output.includes('"ready":true')) return;
        clearTimeout(timer);
        resolve();
      });
    });
  } catch (problem) {
    child.kill('SIGTERM');
    await rm(data, { recursive: true, force: true });
    throw problem;
  }
  child.stdout!.removeAllListeners('data').resume();
  child.stderr!.off('data', collect);
  child.stderr!.pipe(process.stderr);
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
