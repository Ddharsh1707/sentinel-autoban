import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { fakeClock } from '../src/clock.js';
import { createApp } from '../src/app.js';
import { createTailer } from '../src/tailer.js';

const quiet = { log() {}, warn() {} };

function sshdFail(i) {
  return `Oct  5 18:41:${String(i * 3).padStart(2, '0')} portal sshd[77]: Failed password for root from 192.0.2.50 port ${6000 + i} ssh2`;
}

test('follows a log file: ignores old lines, bans on new ones, handles partial lines and truncation', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-'));
  const file = path.join(dir, 'auth.log');
  // Lines already in the file at startup must not be replayed.
  fs.writeFileSync(file, Array.from({ length: 12 }, (_, i) => sshdFail(i)).join('\n') + '\n');

  const config = loadConfig({ DB_PATH: ':memory:', ADMIN_TOKEN: 'x' });
  config.authLogPath = null;
  const { detector, bans } = createApp({ config, clock: fakeClock() });
  const tailer = createTailer({ files: [file], detector, intervalMs: 50, logger: quiet });

  assert.equal(tailer.poll().length, 0, 'old lines are not replayed');

  // 9 new failures, the 10th written without its newline yet.
  fs.appendFileSync(file, Array.from({ length: 9 }, (_, i) => sshdFail(i)).join('\n') + '\n' + sshdFail(9));
  assert.equal(tailer.poll().length, 0, 'partial line waits for its newline');
  fs.appendFileSync(file, '\n');
  const created = tailer.poll();
  assert.equal(created.length, 1);
  assert.equal(created[0].ip, '192.0.2.50');
  assert.ok(bans.getActiveBan('192.0.2.50', created[0].created_at));

  // Truncation (log rotation): reading restarts from the beginning without crashing.
  fs.writeFileSync(file, 'rotated\n');
  assert.doesNotThrow(() => tailer.poll());
  fs.rmSync(dir, { recursive: true, force: true });
});

test('never follows the portal\'s own auth log (it would double count)', () => {
  const config = loadConfig({ DB_PATH: ':memory:', ADMIN_TOKEN: 'x' });
  config.authLogPath = null;
  const { detector } = createApp({ config, clock: fakeClock() });
  const own = path.join(os.tmpdir(), 'sentinel-own.log');
  const tailer = createTailer({ files: [own], detector, intervalMs: 50, skipPath: own, logger: quiet });
  assert.deepEqual(tailer.files, []);
});
