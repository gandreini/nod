import { ApiError, errorText, read } from './api';

export type ConnectionProblemKind = 'address' | 'token' | 'unreachable' | 'rejected' | 'not-nod';

export class ConnectionProblem extends Error {
  constructor(
    readonly kind: ConnectionProblemKind,
    message: string,
  ) {
    super(message);
  }
}

export interface Connection {
  origin: string;
  token: string;
  owner: string;
}

const sameDevice = ['localhost', '127.0.0.1', '[::1]'];

export function serverOrigin(value: string): string {
  try {
    if (value.length > 2048) throw new Error();
    const url = new URL(value.trim());
    if (
      (url.protocol !== 'https:' &&
        !(url.protocol === 'http:' && sameDevice.includes(url.hostname))) ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    )
      throw new Error();
    return url.origin;
  } catch {
    throw new ConnectionProblem(
      'address',
      'Enter your server’s HTTPS address, such as https://nod.example.com, with no path.',
    );
  }
}

export async function sessionRequest(origin: string, token: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    return await fetch(`${origin}/api/session`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
  } catch (error) {
    const reason =
      error instanceof Error && error.name === 'AbortError'
        ? 'no answer in 10 seconds'
        : String(error);
    throw new ConnectionProblem(
      'unreachable',
      `Could not reach ${origin} (${reason}). Check the address and that the server is running.`,
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function checkServer(input: { url: string; token: string }): Promise<Connection> {
  const origin = serverOrigin(input.url);
  const token = input.token.trim();
  if (!/^[A-Za-z0-9_-]{43,}$/.test(token))
    throw new ConnectionProblem(
      'token',
      'This is not a server token. Copy NOD_AUTH_TOKEN from the server’s .env file.',
    );
  const response = await sessionRequest(origin, token);
  let session:
    { user?: { id?: unknown }; settings?: { onboardingCompleted?: unknown } } | undefined;
  try {
    session = await read(response);
  } catch (problem) {
    if (!(problem instanceof ApiError))
      throw new ConnectionProblem(
        'unreachable',
        `${origin} stopped answering (${errorText(problem)}). Check that the server is running.`,
      );
    const said = problem.reason ? `: ${problem.reason}` : '';
    if (problem.status === 401)
      throw new ConnectionProblem(
        'rejected',
        `The server refused this token${said} (HTTP 401). Nothing was saved.`,
      );
    if (problem.status === 403)
      throw new ConnectionProblem(
        'rejected',
        `The server refused the request${said} (HTTP 403). Nothing was saved.`,
      );
    throw new ConnectionProblem(
      'not-nod',
      `${origin} did not answer as a Nod server${said} (HTTP ${problem.status}).`,
    );
  }
  const owner = session?.user?.id;
  if (
    typeof owner !== 'string' ||
    !owner ||
    owner.length > 200 ||
    typeof session?.settings?.onboardingCompleted !== 'boolean'
  )
    throw new ConnectionProblem(
      'not-nod',
      `${origin} did not answer as a Nod server (HTTP ${response.status}).`,
    );
  return { origin, token, owner };
}
