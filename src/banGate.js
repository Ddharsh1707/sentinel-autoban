import { clientIp } from './ip.js';
import { retryAfterSeconds } from './bans.js';

// Runs before every portal route. A ban is enforced in this same process on every request,
// so it starts and ends at the exact millisecond with no polling delay.
export function banGate({ bans, clock, config }) {
  return (req, res, next) => {
    const ip = clientIp(req, config.trustProxy);
    req.clientIp = ip;
    const now = clock.now();
    const ban = bans.getActiveBan(ip, now);
    if (!ban) return next();

    const retry = retryAfterSeconds(ban, now);
    res.set('Retry-After', String(retry));
    return res.status(403).json({
      error: 'banned',
      ip,
      until: ban.until,
      retryAfterSeconds: retry,
      reason: ban.reason,
    });
  };
}
