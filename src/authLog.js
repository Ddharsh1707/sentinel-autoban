import fs from 'node:fs';
import path from 'node:path';

// Usernames are typed by visitors: keep them on one line and one token so the log stays parseable.
function safeUser(user) {
  return String(user ?? '')
    .replace(/[\s\u0000-\u001f\u007f]+/g, '_')
    .slice(0, 64);
}

export function formatAuthLine({ at, ip, user, result }) {
  return `${new Date(at).toISOString()} sentinel-auth: result=${result} ip=${ip} user=${safeUser(user)}`;
}

export function createAuthLog(logPath) {
  if (logPath) fs.mkdirSync(path.dirname(path.resolve(logPath)), { recursive: true });
  return {
    path: logPath ? path.resolve(logPath) : null,
    append(line) {
      if (logPath) fs.appendFileSync(logPath, line + '\n');
    },
  };
}
