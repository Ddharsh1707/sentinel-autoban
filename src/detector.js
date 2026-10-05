import { parseLine } from './parser.js';
import { transaction } from './db.js';

/**
 * The detector stores every login event and decides bans.
 * Rule: an IP is banned when its failures inside the window reach the threshold.
 * Window: failures with at > (time of newest failure - WINDOW). Fresh start: only failures at or
 * after the end of the IP's latest ban count. Allowlisted IPs are never banned.
 */
export function createDetector({ db, bans, config, clock }) {
  const insertEvent = db.prepare(
    'INSERT INTO login_events (at, ip, username, result, source, raw_line) VALUES (?, ?, ?, ?, ?, ?)',
  );
  const countFailures = db.prepare(
    `SELECT COUNT(*) AS n FROM login_events
     WHERE ip = ? AND result = 'FAIL' AND at > ? AND at >= ? AND at <= ?`,
  );
  const allowlisted = db.prepare('SELECT 1 FROM allowlist WHERE ip = ?');

  const windowMs = config.windowSeconds * 1000;

  function processEvent(event, source, rawLine) {
    return transaction(db, () => {
      insertEvent.run(event.at, event.ip, event.user ?? '', event.result, source, rawLine ?? '');

      if (event.result !== 'FAIL') return { event, ban: null, failuresInWindow: 0 };
      if (allowlisted.get(event.ip)) return { event, ban: null, failuresInWindow: 0, allowlisted: true };

      const latest = bans.getLatestBan(event.ip);
      const freshFrom = latest ? latest.until : -Infinity;
      const failuresInWindow = countFailures.get(
        event.ip,
        event.at - windowMs,
        freshFrom,
        event.at,
      ).n;

      // One active ban per IP: failures logged during a ban (e.g. sshd) never stack a second ban.
      if (latest && latest.until > event.at) return { event, ban: null, failuresInWindow };

      if (failuresInWindow >= config.threshold) {
        const ban = bans.createBan(event.ip, event.at, failuresInWindow);
        return { event, ban, failuresInWindow };
      }
      return { event, ban: null, failuresInWindow };
    });
  }

  return {
    /** Parse one log line and process it. Returns null when the line is not a login attempt. */
    ingestLine(line, source) {
      const event = parseLine(line, clock.now());
      if (!event) return null;
      return processEvent(event, source, line);
    },
  };
}
