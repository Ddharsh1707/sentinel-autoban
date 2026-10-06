# HACKBACK code review · DBG-493 · Intrusion Detection & Auto-ban
- Reviewed at: 2026-10-06T08:38:09Z (2026-10-06T14:08:09+05:30 IST)
- Judged commit: af9af3c465710a0db538aa52bd19ccd447ff9c6a (2026-10-05T23:29:07+05:30) · the last commit before the code freeze
- Reviewer: AI agent run by a HACKBACK judge

### DBG-493 · Intrusion Detection & Auto-ban
Commit: af9af3c · 2026-10-05T23:29:07+05:30 · Clean-room: OK

| Section | Score | Why (path:line) |
|---|---|---|
| A. Core flow | 30/30 | End-to-end ingestion, parsing, detection, ban decision, and blocker work seamlessly: log tailer (`src/tailer.js:9-74`), ingest API (`src/routes/admin.js:83-105`), multi-format parser (`src/parser.js:44-81`), sliding-window detector (`src/detector.js:10-57`), atomic ban storage with escalation (`src/bans.js:38-44`, `src/db.js:71-81`), and synchronous ban enforcement middleware with Retry-After (`src/banGate.js:6-24`, `src/routes/portal.js:12-23`). |
| B. Killer Tests | 30/30 | All 3 killer tests pass with full test suite coverage (29/29 tests pass): KT1 (10/10) bans on 10th failure in 60s window ignoring successes (`test/killer.test.js:26-95`); KT2 (10/10) isolates attacker IP so normal users and allowlisted IPs are unaffected (`test/killer.test.js:98-125`); KT3 (10/10) checks `now < until` on every request, lifting ban at exact expiry without polling or cron lag, and enforces fresh start (`test/killer.test.js:128-174`). |
| C. Two improvements | 20/20 | Both promised improvements from `docs/GAPS.md:20-28` are fully built and tested: 1) Escalating bans for repeat offenders based on offence count capped at `maxBanSeconds` (`src/bans.js:20-24, 39-40`, `test/improvements.test.js:23-43`); 2) Live admin dashboard with bearer token auth, real-time countdowns, one-click unban, allowlist management, and attack simulator (`src/routes/admin.js:10-127`, `public/dashboard.html:1-218`, `test/improvements.test.js:45-79`). |
| D. Built from their docs | 10/10 | Architecture, routes, and data entities match docs with high fidelity: PRD acceptance criteria AC1.1–AC5.3 match tests 1:1 (`docs/PRD.md:79-102`); all endpoints match `docs/API.md:24-106` (`src/routes/portal.js:15-69`, `src/routes/admin.js:22-125`); SQLite tables and indexes match `docs/DATA_MODEL.md:47-98` (`src/db.js:13-52`). |
| E. Engineering | 10/10 | Strict input validation on all routes (`src/routes/portal.js:25-32`, `src/routes/admin.js:67-70, 86-90`); constant-time timing-safe token checks with pre-hashing (`src/routes/admin.js:10-18`); scrypt password hashing with dummy burnTime against user enumeration (`src/passwords.js:11-23`); safe proxy header handling with `TRUST_PROXY=false` default (`src/ip.js:15-26`, `src/config.js:16`); CRLF log sanitization (`src/authLog.js:5-9`); malformed log handling (`src/parser.js:26, 45, 80`); zero committed secrets (`.gitignore:2`). |
| Total | 100/100 | |

Killer Tests:
1. READY · 10/10 · Sliding window over stored timestamps (`src/detector.js:14-17, 31-36`) bans on the 10th failure (`src/detector.js:41`) within 60s window (`src/config.js:45-46`), ignoring successes (`src/detector.js:26`). Proven by 7 tests in `test/killer.test.js:26-95` (AC1.1–AC1.5, X-Real-IP, parallel burst).
2. READY · 10/10 · Failures and bans are keyed strictly by IP (`src/detector.js:15-16, src/bans.js:5, src/banGate.js:8-12`); successful logins never increment failure counts (`src/detector.js:26`); dedicated allowlist exempts trusted IPs (`src/detector.js:18, 27`). Normal users log in unimpeded during active attacks. Proven by `test/killer.test.js:98-125` (AC2.1–AC2.3).
3. READY · 10/10 · Ban stores millisecond UTC `until` in SQLite (`src/db.js:36, src/bans.js:40`) and `banGate` checks `now < until` synchronously on every request (`src/banGate.js:11, src/bans.js:5`), lifting the ban at the exact millisecond without background cleanup jobs or polling lag. Fresh start ensures prior failures do not cause immediate re-ban (`src/detector.js:30, 34`). Proven by `test/killer.test.js:128-174` (AC3.1–AC3.3, log-during-ban).

Improvements:
1. Escalating bans for repeat offenders · 10/10 · Implemented in `src/bans.js:20-24, 39-40`, calculating `durationSeconds = min(base * offenceNumber, maxBanSeconds)` and configured via `src/config.js:48-49`. Proven in `test/improvements.test.js:23-43` (AC4.1, escalation off test).
2. Live admin dashboard with manual unban and allowlist · 10/10 · Token-protected JSON admin API in `src/routes/admin.js:10-127` (`/bans`, `/bans/:ip`, `/allowlist`, `/stats`, `/ingest`) and full-featured frontend in `public/dashboard.html:1-218` featuring real-time countdown timers, one-click manual unban, allowlist CRUD, top attacker stats, and an interactive demo simulator. Proven in `test/improvements.test.js:45-79` (AC5.1–AC5.3).

Flags: none.

3 questions for the judges to ask this team in their Defence, aimed at the weakest spots you found.
1. In `src/ip.js:19`, when `TRUST_PROXY=true`, the client IP is extracted via `forwarded.split(',')[0]`. If an attacker directly sends a spoofed `X-Forwarded-For: <victim-ip>` through an edge proxy that appends rather than strips the client header (yielding `<victim-ip>, <attacker-ip>`), how would you prevent an attacker from maliciously banning innocent students or university administrative IPs?
2. In `src/tailer.js:20`, external log file read offsets are initialized to file size at startup and held only in memory (`docs/ARCHITECTURE.md:70`). If Sentinel crashes or restarts during a distributed brute-force attack, any unread log lines produced right before or during downtime are dropped, resetting the window for attacking bots. How would you persist file offsets and ensure at-least-once log processing across process restarts?
3. Sentinel optimizes for zero-latency ban enforcement by coupling detection, SQLite storage, and web proxying in a single Node.js process. If the college portal needs to horizontally scale across multiple servers behind a load balancer during peak result week, how would you synchronize sliding-window failure counters and ban state across instances without introducing the bouncer polling latency you criticized in CrowdSec?

SCORE core=30 kt=30 imp=20 docs=10 eng=10 total=100
