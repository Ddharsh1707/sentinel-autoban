# Sentinel: auto-ban for password-guessing bots

During result week, bots hammer the college portal guessing passwords. Sentinel reads the login logs, bans an IP after **10 failed logins within 60 seconds**, never touches a normal student logging in at the same time, and lifts the ban **at the exact millisecond it expires**. It doesn't need a bouncer, a rule download or a cleanup job.

This is a clean-room rebuild of the core of [CrowdSec](https://github.com/crowdsecurity/crowdsec), built only from our own docs in [`docs/`](docs/).

## Run it (Node.js 22.13 or newer)

```bash
npm install
cp .env.example .env
npm start
```

Then open:
- http://localhost:3000: the student portal login.
- http://localhost:3000/dashboard: the admin dashboard. The token is `ADMIN_TOKEN` from `.env`; if it's blank, the server prints a random one at startup.

**Prove the Killer Tests:**

```bash
npm test
```

The test suite has 29 checks, including every Killer Test acceptance criterion, run against a real HTTP server with a controllable clock.

To watch an attack in the terminal, run `npm run demo` in a second terminal while the server is running.

**Demo accounts (local test data only):**

| Username | Password |
|---|---|
| `student1` | `results2026` |
| `student2` | `results2026` |
| `admin_demo` | `admin2026` |

## How the Killer Tests are met

| Killer Test | How Sentinel does it | Proved by |
|---|---|---|
| 1. 10 failed logins from one IP within a minute get that IP banned | Every attempt is written to `logs/auth.log` and fed through the log parser (Sentinel, sshd and nginx/Apache formats are supported). Failures are counted per IP over a sliding 60-second window of real timestamps. The **10th** failure creates the ban (CrowdSec's leaky bucket fires on capacity + 1). | `test/killer.test.js` AC1.1–AC1.5, plus a parallel burst |
| 2. A normal user logging in at the same time is not affected | Counting is per IP and failures only. A banned IP never affects another. There is an allowlist for shared IPs. | AC2.1–AC2.3 |
| 3. The ban is lifted exactly when it expires | A ban is active only while `now < until`. The check runs in the same process on every request, so there's no polling delay. A request at `until − 1 ms` is blocked; one at `until` is served. | AC3.1–AC3.3 |

## Our 2 improvements (from [`docs/GAPS.md`](docs/GAPS.md))

1. **Escalating bans:** an IP's nth ban lasts n × the base duration, capped. CrowdSec ships this switched off.
2. **Live admin dashboard:** active bans with countdowns, one-click unban, an allowlist, the top attacking IPs, and a built-in live attack demo.

## Testing with several IPs from one laptop

With `TRUST_PROXY=true` (the default in `.env.example`), the first `X-Forwarded-For` address is treated as the client IP:

```bash
curl -X POST localhost:3000/login -H "content-type: application/json" -H "x-forwarded-for: 203.0.113.7" -d '{"username":"student1","password":"wrong"}'
```

Log lines can also be sent directly, in Sentinel, sshd or nginx/Apache format:

```bash
curl -X POST localhost:3000/api/admin/ingest -H "authorization: Bearer <ADMIN_TOKEN>" -H "content-type: application/json" -d '{"lines":["Oct  5 18:40:01 host sshd[1]: Failed password for root from 203.0.113.9 port 22 ssh2"]}'
```

To follow real log files, set `LOG_FILES=/var/log/auth.log` in `.env`.

## Settings

All settings are in [`.env.example`](.env.example) and documented in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#configuration-environment-variables).

The main ones:
- `THRESHOLD=10`
- `WINDOW_SECONDS=60`
- `BAN_DURATION_SECONDS=60`
- `ESCALATION=true`
- `MAX_BAN_SECONDS=86400`

## Project layout

```
src/
  server.js        starts the app and the log tailer
  app.js           wires routes, database, detector
  detector.js      sliding-window rule and ban decision
  bans.js          ban store: active = now < until, escalation
  banGate.js       blocks banned IPs on every portal request
  parser.js        Sentinel and sshd log formats
  tailer.js        follows external log files
  routes/          portal (login) and admin API
public/            login page and dashboard
test/              Killer Tests, improvements, parser, tailer
docs/              OBSERVATIONS, PRD, ARCHITECTURE, DATA_MODEL, API, GAPS, AGENT_LOG
```

## Stack

- Node.js with the built-in `node:sqlite`, `node:test` and `crypto` (scrypt password hashing)
- Express 5

Nothing else to install, and no database server.
