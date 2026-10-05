import path from 'node:path';
import { Router } from 'express';
import { banGate } from '../banGate.js';
import { formatAuthLine } from '../authLog.js';
import { verifyPassword, burnTime } from '../passwords.js';
import { retryAfterSeconds } from '../bans.js';

const MAX_FIELD = 128;

export function portalRouter({ db, bans, detector, authLog, clock, config, publicDir }) {
  const router = Router();
  const gate = banGate({ bans, clock, config });
  const findUser = db.prepare('SELECT username, password_hash FROM users WHERE username = ?');

  router.get('/', gate, (req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  router.get('/portal', gate, (req, res) => {
    res.json({ ok: true });
  });

  router.post('/login', gate, (req, res) => {
    const { username, password } = req.body ?? {};
    const valid =
      typeof username === 'string' &&
      typeof password === 'string' &&
      username.length > 0 &&
      password.length > 0 &&
      username.length <= MAX_FIELD &&
      password.length <= MAX_FIELD;
    if (!valid) return res.status(400).json({ error: 'invalid_input' });

    const user = findUser.get(username);
    let success = false;
    if (user) success = verifyPassword(password, user.password_hash);
    else burnTime(password);

    // Check the clock after the password work, so the logged time is when the outcome was known.
    const at = clock.now();
    const line = formatAuthLine({
      at,
      ip: req.clientIp,
      user: username,
      result: success ? 'SUCCESS' : 'FAIL',
    });
    authLog.append(line);
    const outcome = detector.ingestLine(line, 'portal');

    if (success) return res.status(200).json({ ok: true, user: username });

    if (outcome?.ban) {
      const retry = retryAfterSeconds(outcome.ban, at);
      res.set('Retry-After', String(retry));
      return res.status(403).json({
        error: 'banned',
        ip: outcome.ban.ip,
        until: outcome.ban.until,
        retryAfterSeconds: retry,
        reason: outcome.ban.reason,
      });
    }

    return res.status(401).json({
      error: 'invalid_credentials',
      failuresInWindow: outcome?.failuresInWindow ?? 0,
      threshold: config.threshold,
    });
  });

  return router;
}
