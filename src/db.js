import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { hashPassword } from './passwords.js';

// Test-only demo accounts for the local portal (listed in README.md).
export const DEMO_USERS = [
  { username: 'student1', password: 'results2026' },
  { username: 'student2', password: 'results2026' },
  { username: 'admin_demo', password: 'admin2026' },
];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE CHECK (length(username) BETWEEN 1 AND 64),
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS login_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  ip TEXT NOT NULL,
  username TEXT NOT NULL DEFAULT '',
  result TEXT NOT NULL CHECK (result IN ('SUCCESS', 'FAIL')),
  source TEXT NOT NULL CHECK (source IN ('portal', 'file', 'ingest')),
  raw_line TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_events_ip_result_at ON login_events (ip, result, at);

CREATE TABLE IF NOT EXISTS bans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  until INTEGER NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  offence_number INTEGER NOT NULL,
  failures_counted INTEGER NOT NULL,
  lifted_at INTEGER,
  lifted_by TEXT,
  CHECK (until > created_at OR lifted_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_bans_ip_until ON bans (ip, until);
CREATE INDEX IF NOT EXISTS idx_bans_until ON bans (until);

CREATE TABLE IF NOT EXISTS allowlist (
  ip TEXT PRIMARY KEY,
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
`;

export function openDb(dbPath, clock) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);

  const insertUser = db.prepare(
    'INSERT OR IGNORE INTO users (username, password_hash, created_at) VALUES (?, ?, ?)',
  );
  for (const u of DEMO_USERS) {
    const exists = db.prepare('SELECT 1 FROM users WHERE username = ?').get(u.username);
    if (!exists) insertUser.run(u.username, hashPassword(u.password), clock.now());
  }
  return db;
}

// Runs fn inside BEGIN IMMEDIATE so a check-then-insert can never interleave with another writer.
export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
