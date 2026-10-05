import net from 'node:net';
import { normalizeIp } from './ip.js';

// Sentinel's own format, written by the portal:
// 2026-10-05T18:40:00.123Z sentinel-auth: result=FAIL ip=203.0.113.7 user=student1
const SENTINEL_RE = /^(\S+) sentinel-auth: result=(SUCCESS|FAIL) ip=(\S+) user=(\S*)\s*$/;

// Standard OpenSSH lines:
// Oct  5 18:40:01 host sshd[1234]: Failed password for invalid user bob from 203.0.113.7 port 52211 ssh2
// Oct  5 18:40:01 host sshd[1234]: Accepted password for alice from 198.51.100.4 port 52212 ssh2
const SSHD_RE =
  /^([A-Z][a-z]{2})\s+(\d{1,2}) (\d{2}):(\d{2}):(\d{2}) \S+ sshd\[\d+\]: (Failed|Accepted) password for (?:invalid user )?(\S+) from (\S+) port \d+/;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Turns one log line into { at, ip, user, result } or null when the line is not a login attempt.
 * `fallbackNow` is used only if the line's own timestamp cannot be read.
 */
export function parseLine(line, fallbackNow) {
  if (typeof line !== 'string') return null;
  const text = line.replace(/\r$/, '');

  let m = SENTINEL_RE.exec(text);
  if (m) {
    const ip = normalizeIp(m[3]);
    if (!net.isIP(ip)) return null;
    const parsed = Date.parse(m[1]);
    return {
      at: Number.isFinite(parsed) ? parsed : fallbackNow,
      ip,
      user: m[4],
      result: m[2],
    };
  }

  m = SSHD_RE.exec(text);
  if (m) {
    const ip = normalizeIp(m[8]);
    const month = MONTHS.indexOf(m[1]);
    if (!net.isIP(ip) || month === -1) return null;
    // sshd lines carry no year or zone: read them as local time in the current year.
    const year = new Date(fallbackNow).getFullYear();
    const at = new Date(year, month, Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])).getTime();
    return {
      at: Number.isFinite(at) ? at : fallbackNow,
      ip,
      user: m[7],
      result: m[6] === 'Failed' ? 'FAIL' : 'SUCCESS',
    };
  }

  return null;
}
