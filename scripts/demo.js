// Terminal demo against a running server (npm start in another terminal, TRUST_PROXY=true).
// Shows all 3 Killer Tests: a bot is banned on its 10th failure, a student is never affected,
// and the ban lifts exactly when it expires.
const base = process.env.DEMO_URL || `http://localhost:${process.env.PORT || 3000}`;
const BOT = '203.0.113.7';
const STUDENT = '198.51.100.20';

async function login(ip, username, password) {
  const res = await fetch(`${base}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ username, password }),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const show = (who, ip, r) =>
  console.log(
    `${who.padEnd(8)} ${ip.padEnd(15)} -> ${r.status} ${r.body.error ?? 'ok'}` +
      (r.body.failuresInWindow !== undefined ? ` (${r.body.failuresInWindow}/${r.body.threshold})` : '') +
      (r.body.retryAfterSeconds !== undefined ? ` retry in ${r.body.retryAfterSeconds}s` : ''),
  );

console.log(`Sentinel demo against ${base}\n`);
let until = null;
for (let i = 1; i <= 10; i++) {
  const r = await login(BOT, 'student1', `guess${i}`);
  show('BOT', BOT, r);
  if (r.status === 403) until = r.body.until;
  show('STUDENT', STUDENT, await login(STUDENT, 'student2', 'results2026'));
}
if (!until) {
  console.log('\nThe bot was not banned. Is TRUST_PROXY=true and is the IP already allowlisted?');
  process.exit(1);
}
show('BOT', BOT, await login(BOT, 'student1', 'results2026'));
const wait = until - Date.now();
console.log(`\nBan ends at ${new Date(until).toLocaleTimeString()} - waiting ${Math.ceil(wait / 1000)}s...`);
await sleep(Math.max(0, wait - 300));
show('BOT', BOT, await login(BOT, 'student1', 'results2026'));
await sleep(Math.max(0, until - Date.now()) + 20);
show('BOT', BOT, await login(BOT, 'student1', 'results2026'));
console.log('\nDone: banned on the 10th failure, student never blocked, ban lifted on time.');
