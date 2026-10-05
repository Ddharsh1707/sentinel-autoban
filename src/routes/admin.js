import crypto from 'node:crypto';
import { Router } from 'express';
import { isValidIp, normalizeIp } from '../ip.js';
import { banView, retryAfterSeconds } from '../bans.js';

function digest(s) {
  return crypto.createHash('sha256').update(String(s)).digest();
}

export function requireAdmin(adminToken) {
  const expected = digest(adminToken);
  return (req, res, next) => {
    const header = req.get('authorization') || '';
    const match = /^Bearer (.+)$/.exec(header);
    if (match && crypto.timingSafeEqual(digest(match[1]), expected)) return next();
    return res.status(401).json({ error: 'unauthorized' });
  };
}

export function publicApiRouter({ bans, clock }) {
  const router = Router();
  router.get('/api/check/:ip', (req, res) => {
    if (!isValidIp(req.params.ip)) return res.status(400).json({ error: 'invalid_ip' });
    const ip = normalizeIp(req.params.ip);
    const now = clock.now();
    const ban = bans.getActiveBan(ip, now);
    if (!ban) return res.json({ ip, banned: false });
    return res.json({ ip, banned: true, until: ban.until, retryAfterSeconds: retryAfterSeconds(ban, now) });
  });
  return router;
}

export function adminRouter({ db, bans, detector, clock, config }) {
  const router = Router();
  router.use(requireAdmin(config.adminToken));

  const listAllow = db.prepare('SELECT ip, note, created_at FROM allowlist ORDER BY created_at DESC');
  const getAllow = db.prepare('SELECT ip, note, created_at FROM allowlist WHERE ip = ?');
  const addAllow = db.prepare('INSERT INTO allowlist (ip, note, created_at) VALUES (?, ?, ?)');
  const delAllow = db.prepare('DELETE FROM allowlist WHERE ip = ?');
  const countSince = db.prepare('SELECT COUNT(*) AS n FROM login_events WHERE result = ? AND at > ?');
  const activeCount = db.prepare('SELECT COUNT(DISTINCT ip) AS n FROM bans WHERE until > ?');
  const topIps = db.prepare(
    `SELECT ip, COUNT(*) AS failures FROM login_events
     WHERE result = 'FAIL' AND at > ? GROUP BY ip ORDER BY failures DESC, ip LIMIT 5`,
  );

  router.get('/bans', (req, res) => {
    const activeOnly = req.query.active !== 'false';
    const now = clock.now();
    res.json({ bans: bans.list(activeOnly, now).map((b) => banView(b, now)) });
  });

  router.delete('/bans/:ip', (req, res) => {
    if (!isValidIp(req.params.ip)) return res.status(400).json({ error: 'invalid_ip' });
    const ip = normalizeIp(req.params.ip);
    if (!bans.liftBan(ip, clock.now())) return res.status(404).json({ error: 'no_active_ban' });
    return res.json({ lifted: true, ip });
  });

  router.get('/allowlist', (req, res) => {
    res.json({ allowlist: listAllow.all() });
  });

  router.post('/allowlist', (req, res) => {
    const { ip, note } = req.body ?? {};
    if (typeof ip !== 'string' || !isValidIp(ip)) return res.status(400).json({ error: 'invalid_ip' });
    if (note !== undefined && (typeof note !== 'string' || note.length > 200)) {
      return res.status(400).json({ error: 'invalid_input' });
    }
    const clean = normalizeIp(ip);
    if (getAllow.get(clean)) return res.status(409).json({ error: 'already_allowlisted' });
    addAllow.run(clean, note ?? '', clock.now());
    return res.status(201).json(getAllow.get(clean));
  });

  router.delete('/allowlist/:ip', (req, res) => {
    const removed = delAllow.run(normalizeIp(req.params.ip)).changes > 0;
    if (!removed) return res.status(404).json({ error: 'not_found' });
    return res.json({ removed: true });
  });

  router.post('/ingest', (req, res) => {
    const { lines } = req.body ?? {};
    const valid =
      Array.isArray(lines) &&
      lines.length >= 1 &&
      lines.length <= 1000 &&
      lines.every((l) => typeof l === 'string' && l.length <= 2000);
    if (!valid) return res.status(400).json({ error: 'invalid_input' });

    let processed = 0;
    let skipped = 0;
    const bansCreated = [];
    for (const line of lines) {
      const result = detector.ingestLine(line, 'ingest');
      if (!result) {
        skipped += 1;
        continue;
      }
      processed += 1;
      if (result.ban) bansCreated.push({ ip: result.ban.ip, until: result.ban.until });
    }
    return res.json({ processed, skipped, bansCreated });
  });

  router.get('/stats', (req, res) => {
    const now = clock.now();
    const hourAgo = now - 3600 * 1000;
    res.json({
      now,
      activeBans: activeCount.get(now).n,
      failuresLastHour: countSince.get('FAIL', hourAgo).n,
      successesLastHour: countSince.get('SUCCESS', hourAgo).n,
      topIps: topIps.all(hourAgo),
      config: {
        threshold: config.threshold,
        windowSeconds: config.windowSeconds,
        banDurationSeconds: config.banDurationSeconds,
        escalation: config.escalation,
        maxBanSeconds: config.maxBanSeconds,
      },
    });
  });

  return router;
}
