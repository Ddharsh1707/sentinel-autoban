import { loadConfig } from '../src/config.js';
import { fakeClock } from '../src/clock.js';
import { createApp } from '../src/app.js';

export const ADMIN_TOKEN = 'test-admin-token';
export const GOOD = { username: 'student1', password: 'results2026' };
export const BAD = { username: 'student1', password: 'wrong-guess' };

/** Starts a real HTTP server on a random port with a fake clock and an in-memory database. */
export async function startTestServer(env = {}) {
  const config = loadConfig({
    DB_PATH: ':memory:',
    TRUST_PROXY: 'true',
    ADMIN_TOKEN,
    ...env,
  });
  config.authLogPath = null; // tests do not write log files
  const clock = fakeClock();
  const ctx = createApp({ config, clock });
  const server = await new Promise((resolve) => {
    const s = ctx.app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  async function request(method, path, { ip, body, token, headers: extra } = {}) {
    const headers = { ...extra };
    if (ip) headers['x-forwarded-for'] = ip;
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(base + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* HTML page */
    }
    return { status: res.status, body: json, headers: res.headers };
  }

  return {
    base,
    config,
    clock,
    ctx,
    request,
    login: (ip, creds) => request('POST', '/login', { ip, body: creds }),
    admin: (method, path, body) => request(method, path, { token: ADMIN_TOKEN, body }),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
