// Ban store. A ban is active exactly while now < until. Nothing needs to delete it when it ends.

export function createBanStore(db, config) {
  const activeStmt = db.prepare(
    'SELECT * FROM bans WHERE ip = ? AND until > ? ORDER BY until DESC LIMIT 1',
  );
  const latestStmt = db.prepare('SELECT * FROM bans WHERE ip = ? ORDER BY id DESC LIMIT 1');
  const countStmt = db.prepare('SELECT COUNT(*) AS n FROM bans WHERE ip = ?');
  const insertStmt = db.prepare(
    `INSERT INTO bans (ip, created_at, until, reason, offence_number, failures_counted)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const byIdStmt = db.prepare('SELECT * FROM bans WHERE id = ?');
  const liftStmt = db.prepare(
    "UPDATE bans SET until = ?, lifted_at = ?, lifted_by = 'admin' WHERE ip = ? AND until > ?",
  );
  const listActiveStmt = db.prepare('SELECT * FROM bans WHERE until > ? ORDER BY id DESC LIMIT 200');
  const listAllStmt = db.prepare('SELECT * FROM bans ORDER BY id DESC LIMIT 200');

  function durationSeconds(offenceNumber) {
    const base = config.banDurationSeconds;
    const seconds = config.escalation ? base * offenceNumber : base;
    return Math.min(seconds, config.maxBanSeconds);
  }

  return {
    durationSeconds,

    getActiveBan(ip, now) {
      return activeStmt.get(ip, now) ?? null;
    },

    getLatestBan(ip) {
      return latestStmt.get(ip) ?? null;
    },

    // Caller must hold a transaction and have checked there is no active ban.
    createBan(ip, at, failuresCounted) {
      const offenceNumber = countStmt.get(ip).n + 1;
      const until = at + durationSeconds(offenceNumber) * 1000;
      const reason = `${failuresCounted} failed logins in ${config.windowSeconds}s`;
      const { lastInsertRowid } = insertStmt.run(ip, at, until, reason, offenceNumber, failuresCounted);
      return byIdStmt.get(lastInsertRowid);
    },

    liftBan(ip, now) {
      return liftStmt.run(now, now, ip, now).changes > 0;
    },

    list(activeOnly, now) {
      return activeOnly ? listActiveStmt.all(now) : listAllStmt.all();
    },
  };
}

export function retryAfterSeconds(ban, now) {
  return Math.max(0, Math.ceil((ban.until - now) / 1000));
}

export function banView(ban, now) {
  return {
    ...ban,
    active: ban.until > now,
    retryAfterSeconds: retryAfterSeconds(ban, now),
  };
}
