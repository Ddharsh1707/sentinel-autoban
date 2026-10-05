# SUBMISSION

## Team
- **Team ID:** DBG-493
- **Team name:** NEXORA
- **Members:** _[names]_

## Card
- **Track:** ♣ Cyber Security
- **Card:** Intrusion Detection & Auto-Ban (The Sentinel). Brutal, ×1.2.
- **Solution title:** Sentinel: auto-ban for password-guessing bots

## Original repo studied
- **Repo:** https://github.com/crowdsecurity/crowdsec
- **Commit studied:** `7a73b16` (shallow clone, Monday 5 October 2026)
- **Areas studied:**
  - log acquisition (`pkg/acquisition`)
  - leaky buckets (`pkg/leakybucket`)
  - profiles and ban duration (`config/profiles.yaml`, `pkg/csprofiles`)
  - decisions and expiry (`pkg/database`)
  - Local API routes (`pkg/apiserver/controllers/controller.go`)

## Run command
Needs Node.js 22.13 or newer.

```bash
npm install
cp .env.example .env
npm start
```

- **Portal:** http://localhost:3000
- **Dashboard:** http://localhost:3000/dashboard (token: `ADMIN_TOKEN` in `.env`, or printed at startup)
- **Tests:** `npm test`
- **Terminal demo:** `npm run demo`

**Time limits are in `.env`,** so the Killer Tests can be checked in minutes:

| Setting | Default |
|---|---|
| `WINDOW_SECONDS` | `60` |
| `BAN_DURATION_SECONDS` | `60` |
| `MAX_BAN_SECONDS` | `86400` |
| `THRESHOLD` | `10` |

To simulate several IPs from one laptop, keep `TRUST_PROXY=true` and send an `X-Forwarded-For` or `X-Real-IP` header.

## Libraries used
| Library | Use |
|---|---|
| `express` 5 | HTTP server and routing (the only npm dependency) |
| `node:sqlite` (Node built-in) | Database for users, login events, bans and the allowlist |
| `node:crypto` (Node built-in) | scrypt password hashing; constant-time token comparison |
| `node:test` (Node built-in) | Automated tests |
| `node:fs`, `node:net` (Node built-in) | Log tailing; IP validation |

No CrowdSec code or packages are used.

## Killer Tests
| # | Test | Status | Where it is proved |
|---|---|---|---|
| 1 | 10 failed logins from one IP within a minute get that IP banned | Passing | `test/killer.test.js` AC1.1–AC1.5 |
| 2 | A normal user logging in at the same time is not affected | Passing | `test/killer.test.js` AC2.1–AC2.3 |
| 3 | The ban is lifted exactly when it expires | Passing | `test/killer.test.js` AC3.1–AC3.3 |

Run `npm test` to check all 29 tests.

## Improvements (from docs/GAPS.md)
1. **Escalating bans for repeat offenders.** The nth ban lasts n × the base duration, capped at `MAX_BAN_SECONDS`. CrowdSec has this only as a commented-out line (`config/profiles.yaml:8`). Proved by `test/improvements.test.js` AC4.1.
2. **Live admin dashboard.** It shows active bans with live countdowns and the top attacking IPs, and has one-click unban, allowlist management (for shared college IPs) and a built-in attack demo. CrowdSec has no web UI in its repo. Proved by `test/improvements.test.js` AC5.1–AC5.3.

## Key differences from the original
- **Exact sliding window instead of a leaky bucket,** so the 10th failure bans. CrowdSec overflows on capacity + 1, and a slow attacker can stay under its leak rate.
- **Ban enforced in-process on every request** (`now < until`), so there's no bouncer polling delay at the start or end of a ban.
- **One active ban per IP,** enforced in a transaction. CrowdSec allows duplicate active decisions.

## Clean-room declaration
- The repo was created empty after 4 PM.
- Docs were pushed before any code.
- No CrowdSec code or packages were used; general libraries only (Express and Node built-ins).
- No secrets are committed.

## Links
- **Demo video (backup):** _[link]_
- **Deck:** `deck.pdf` in the repo root
