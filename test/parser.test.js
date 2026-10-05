import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLine } from '../src/parser.js';
import { formatAuthLine } from '../src/authLog.js';

const NOW = Date.UTC(2026, 9, 5, 13, 0, 0);

test('reads Sentinel lines it writes itself', () => {
  const line = formatAuthLine({ at: NOW, ip: '203.0.113.7', user: 'student 1', result: 'FAIL' });
  assert.deepEqual(parseLine(line, 0), { at: NOW, ip: '203.0.113.7', user: 'student_1', result: 'FAIL' });
});

test('reads sshd failed and accepted lines', () => {
  const fail = parseLine(
    'Oct  5 18:40:01 host sshd[1234]: Failed password for invalid user bob from 203.0.113.7 port 52211 ssh2',
    NOW,
  );
  assert.equal(fail.result, 'FAIL');
  assert.equal(fail.ip, '203.0.113.7');
  assert.equal(fail.user, 'bob');
  assert.equal(fail.at, new Date(2026, 9, 5, 18, 40, 1).getTime());

  const ok = parseLine('Oct 15 09:01:02 host sshd[9]: Accepted password for alice from ::ffff:10.0.0.2 port 1 ssh2', NOW);
  assert.equal(ok.result, 'SUCCESS');
  assert.equal(ok.ip, '10.0.0.2');
});

test('reads nginx/Apache access lines for failed and successful login POSTs', () => {
  const fail = parseLine(
    '203.0.113.7 - - [05/Oct/2026:18:40:01 +0530] "POST /login HTTP/1.1" 401 123 "-" "curl/8.5"',
    NOW,
  );
  assert.deepEqual(fail, { at: Date.UTC(2026, 9, 5, 13, 10, 1), ip: '203.0.113.7', user: '', result: 'FAIL' });

  const wp = parseLine('198.51.100.4 - alice [05/Oct/2026:13:00:00 +0000] "POST /wp-login.php?x=1 HTTP/1.1" 302 0', NOW);
  assert.equal(wp.result, 'SUCCESS');
  assert.equal(wp.user, 'alice');

  // Not a login attempt: wrong method, wrong path, or an unrelated status.
  assert.equal(parseLine('203.0.113.7 - - [05/Oct/2026:13:00:00 +0000] "GET /login HTTP/1.1" 401 0', NOW), null);
  assert.equal(parseLine('203.0.113.7 - - [05/Oct/2026:13:00:00 +0000] "POST /upload HTTP/1.1" 401 0', NOW), null);
  assert.equal(parseLine('203.0.113.7 - - [05/Oct/2026:13:00:00 +0000] "POST /login HTTP/1.1" 500 0', NOW), null);
});

test('ignores other lines and bad IPs', () => {
  assert.equal(parseLine('hello world', NOW), null);
  assert.equal(parseLine('2026-10-05T10:00:00Z sentinel-auth: result=FAIL ip=999.1.1.1 user=x', NOW), null);
  assert.equal(parseLine(42, NOW), null);
});
