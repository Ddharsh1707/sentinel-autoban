import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, BAD } from './helpers.js';

const ATTACKER = '203.0.113.9';

let t;
beforeEach(async () => {
  t = await startTestServer({ BAN_DURATION_SECONDS: '60', MAX_BAN_SECONDS: '150' });
});
afterEach(async () => {
  await t.close();
});

async function banOnce() {
  let last;
  for (let i = 0; i < 10; i++) last = await t.login(ATTACKER, BAD);
  assert.equal(last.status, 403);
  return last.body;
}

describe('Improvement 1: escalating bans', () => {
  test('AC4.1: 1st ban 60s, 2nd 120s, 3rd capped at MAX_BAN_SECONDS', async () => {
    const lengths = [];
    for (let n = 0; n < 3; n++) {
      const start = t.clock.now();
      const ban = await banOnce();
      lengths.push((ban.until - start) / 1000);
      t.clock.set(ban.until);
    }
    assert.deepEqual(lengths, [60, 120, 150]);
  });

  test('escalation off: every ban has the same length', async () => {
    await t.close();
    t = await startTestServer({ ESCALATION: 'false', BAN_DURATION_SECONDS: '60' });
    const first = await banOnce();
    t.clock.set(first.until);
    const start = t.clock.now();
    const second = await banOnce();
    assert.equal((second.until - start) / 1000, 60);
  });
});

describe('Improvement 2: admin dashboard API', () => {
  test('AC5.3: admin routes need the token', async () => {
    assert.equal((await t.request('GET', '/api/admin/bans')).status, 401);
    assert.equal((await t.request('GET', '/api/admin/stats', { token: 'wrong' })).status, 401);
    assert.equal((await t.admin('GET', '/api/admin/stats')).status, 200);
  });

  test('AC5.1: an active ban is listed with a countdown', async () => {
    await banOnce();
    const res = await t.admin('GET', '/api/admin/bans');
    assert.equal(res.body.bans.length, 1);
    assert.equal(res.body.bans[0].ip, ATTACKER);
    assert.equal(res.body.bans[0].active, true);
    assert.equal(res.body.bans[0].retryAfterSeconds, 60);
    const stats = await t.admin('GET', '/api/admin/stats');
    assert.equal(stats.body.activeBans, 1);
    assert.equal(stats.body.topIps[0].ip, ATTACKER);
  });

  test('AC5.2: Unban lifts the ban at once', async () => {
    await banOnce();
    const lift = await t.admin('DELETE', `/api/admin/bans/${ATTACKER}`);
    assert.equal(lift.status, 200);
    assert.equal((await t.request('GET', '/portal', { ip: ATTACKER })).status, 200);
    assert.equal((await t.admin('DELETE', `/api/admin/bans/${ATTACKER}`)).status, 404);
  });

  test('allowlist add, duplicate and remove', async () => {
    assert.equal((await t.admin('POST', '/api/admin/allowlist', { ip: '10.0.0.5' })).status, 201);
    assert.equal((await t.admin('POST', '/api/admin/allowlist', { ip: '10.0.0.5' })).status, 409);
    assert.equal((await t.admin('POST', '/api/admin/allowlist', { ip: 'not-an-ip' })).status, 400);
    assert.equal((await t.admin('DELETE', '/api/admin/allowlist/10.0.0.5')).status, 200);
    assert.equal((await t.admin('DELETE', '/api/admin/allowlist/10.0.0.5')).status, 404);
  });
});

describe('Input and error handling', () => {
  test('missing fields are 400 and not counted as failures', async () => {
    for (let i = 0; i < 12; i++) {
      assert.equal((await t.request('POST', '/login', { ip: ATTACKER, body: { username: 'x' } })).status, 400);
    }
    assert.equal((await t.request('GET', `/api/check/${ATTACKER}`)).body.banned, false);
  });

  test('malformed JSON is 400 invalid_json; unknown route is 404', async () => {
    const res = await fetch(`${t.base}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': ATTACKER },
      body: '{"username": ',
    });
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: 'invalid_json' });
    assert.equal((await t.request('GET', '/nope')).status, 404);
  });

  test('invalid ip in check is 400', async () => {
    assert.equal((await t.request('GET', '/api/check/hello')).status, 400);
  });
});
