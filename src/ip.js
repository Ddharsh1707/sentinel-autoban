import net from 'node:net';

// "::ffff:1.2.3.4" (IPv4-mapped IPv6) is stored as "1.2.3.4" so one client has one key.
export function normalizeIp(raw) {
  if (typeof raw !== 'string') return '';
  let ip = raw.trim();
  if (ip.toLowerCase().startsWith('::ffff:') && net.isIPv4(ip.slice(7))) ip = ip.slice(7);
  return ip.toLowerCase();
}

export function isValidIp(raw) {
  return net.isIP(normalizeIp(raw)) !== 0;
}

export function clientIp(req, trustProxy) {
  if (trustProxy) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.trim()) {
      const first = normalizeIp(forwarded.split(',')[0]);
      if (net.isIP(first)) return first;
    }
    const real = normalizeIp(req.headers['x-real-ip']);
    if (net.isIP(real)) return real;
  }
  return normalizeIp(req.socket.remoteAddress || '');
}
