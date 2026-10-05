import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, GOOD, BAD } from './helpers.js';

const ATTACKER = '203.0.113.7';
const STUDENT = '198.51.100.20';

let t;
beforeEach(async () => {
  t = await startTestServer();
});
afterEach(async () => {
  await t.close();
});

async function failTimes(ip, n, stepMs = 1000) {
  const results = [];
  for (let i = 0; i < n; i++) {
    results.push(await t.login(ip, BAD));
    t.clock.advance(stepMs);
  }
  return results;
}

describe('Killer Test 1: 10 failed logins from one IP within a minute get that IP banned', () => {
  test('AC1.1: the 10th failure bans; the 11th request is blocked', async () => {
    const start = t.clock.now();
    const results = await failTimes(ATTACKER, 10);
    for (const r of results.slice(0, 9)) assert.equal(r.status, 401);
    const tenth = results[9];
    assert.equal(tenth.status, 403);
    assert.equal(tenth.body.error, 'banned');
    const tenthAt = start + 9 * 1000;
    assert.equal(tenth.body.until, tenthAt + t.config.banDurationSeconds * 1000);

    const eleventh = await t.login(ATTACKER, GOOD);
    assert.equal(eleventh.status, 403, 'even a correct password is blocked while banned');
    assert.ok(Number(eleventh.headers.get('retry-after')) > 0);
  });

  test('AC1.2: 9 failures within a minute do not ban', async () => {
    const results = await failTimes(ATTACKER, 9);
    for (const r of results) assert.equal(r.status, 401);
    assert.equal(results[8].body.failuresInWindow, 9);
    const check = await t.request('GET', `/api/check/${ATTACKER}`);
    assert.equal(check.body.banned, false);
  });

  test('AC1.3: failures spread over more than 60 seconds do not ban', async () => {
    await failTimes(ATTACKER, 9, 7000); // failures at 0s, 7s ... 56s; clock is now at 63s
    const tenth = await t.login(ATTACKER, BAD); // only the one at 0s has left the window
    assert.equal(tenth.status, 401);
    assert.equal(tenth.body.failuresInWindow, 9);
  });

  test('AC1.4: 10 sshd "Failed password" log lines within a minute ban the IP', async () => {
    const lines = [];
    for (let s = 0; s < 10; s++) {
      lines.push(
        `Oct  5 18:40:${String(s * 5).padStart(2, '0')} portal sshd[811]: Failed password for invalid user admin from ${ATTACKER} port ${50000 + s} ssh2`,
      );
    }
    const res = await t.admin('POST', '/api/admin/ingest', { lines });
    assert.equal(res.status, 200);
    assert.equal(res.body.processed, 10);
    assert.equal(res.body.bansCreated.length, 1);
    assert.equal(res.body.bansCreated[0].ip, ATTACKER);
  });

  test('parallel burst: 20 simultaneous failures create exactly one ban', async () => {
    await Promise.all(Array.from({ length: 20 }, () => t.login(ATTACKER, BAD)));
    const bans = await t.admin('GET', '/api/admin/bans?active=false');
    assert.equal(bans.body.bans.filter((b) => b.ip === ATTACKER).length, 1);
  });
});

describe('Killer Test 2: a normal user logging in at the same time is not affected', () => {
  test('AC2.1: student logs in before, during and after the attacker is banned', async () => {
    assert.equal((await t.login(STUDENT, GOOD)).status, 200);
    for (let i = 0; i < 10; i++) {
      await t.login(ATTACKER, BAD);
      assert.equal((await t.login(STUDENT, GOOD)).status, 200, `student blocked at attack step ${i + 1}`);
    }
    assert.equal((await t.login(ATTACKER, BAD)).status, 403);
    t.clock.advance(t.config.banDurationSeconds * 1000);
    assert.equal((await t.login(STUDENT, GOOD)).status, 200);
    assert.equal((await t.request('GET', `/api/check/${STUDENT}`)).body.banned, false);
  });

  test('AC2.2: a student who mistypes 3 times is not banned', async () => {
    await failTimes(ATTACKER, 10);
    await failTimes(STUDENT, 3);
    const ok = await t.login(STUDENT, GOOD);
    assert.equal(ok.status, 200);
  });

  test('AC2.3: an allowlisted IP is never banned', async () => {
    const shared = '10.20.30.40';
    const add = await t.admin('POST', '/api/admin/allowlist', { ip: shared, note: 'exam cell office' });
    assert.equal(add.status, 201);
    const results = await failTimes(shared, 15, 100);
    for (const r of results) assert.equal(r.status, 401);
    assert.equal((await t.login(shared, GOOD)).status, 200);
  });
});

describe('Killer Test 3: the ban is lifted exactly when it expires', () => {
  async function banAttacker() {
    const results = await failTimes(ATTACKER, 10, 0);
    assert.equal(results[9].status, 403);
    return results[9].body.until;
  }

  test('AC3.1: still blocked 1 ms before until', async () => {
    const until = await banAttacker();
    t.clock.set(until - 1);
    const r = await t.request('GET', '/portal', { ip: ATTACKER });
    assert.equal(r.status, 403);
    assert.equal(r.body.retryAfterSeconds, 1);
  });

  test('AC3.2: allowed at exactly until, with no restart or cleanup job', async () => {
    const until = await banAttacker();
    t.clock.set(until);
    assert.equal((await t.request('GET', '/portal', { ip: ATTACKER })).status, 200);
    assert.equal((await t.request('GET', `/api/check/${ATTACKER}`)).body.banned, false);
    assert.equal((await t.login(ATTACKER, GOOD)).status, 200);
  });

  test('AC3.3: one failure after expiry does not re-ban (fresh start)', async () => {
    const until = await banAttacker();
    t.clock.set(until);
    const r = await t.login(ATTACKER, BAD);
    assert.equal(r.status, 401);
    assert.equal(r.body.failuresInWindow, 1);
  });

  test('log lines received during a ban do not count after it ends', async () => {
    const until = await banAttacker();
    // sshd keeps logging while the IP is banned at the web layer
    const during = new Date(until - 5000);
    const stamp = during.toTimeString().slice(0, 8);
    const mon = during.toLocaleString('en-US', { month: 'short' });
    const day = String(during.getDate()).padStart(2, ' ');
    const lines = Array.from(
      { length: 12 },
      (_, i) => `${mon} ${day} ${stamp} portal sshd[9]: Failed password for root from ${ATTACKER} port ${4000 + i} ssh2`,
    );
    const res = await t.admin('POST', '/api/admin/ingest', { lines });
    assert.equal(res.body.bansCreated.length, 0, 'no second ban while one is active');
    t.clock.set(until);
    assert.equal((await t.login(ATTACKER, BAD)).status, 401);
  });
});
