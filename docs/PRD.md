# PRD: Sentinel, auto-ban for password-guessing bots

## Problem

During result week the college portal is hit by bots guessing passwords. Today nobody notices until real students cannot log in or an account is taken over. The portal needs to read its own login logs, spot an IP that is guessing passwords, ban that IP automatically, and lift the ban by itself when it expires. It must do all this without ever blocking a normal student who is logging in at the same time.

## Target users

| User | What they need |
|---|---|
| **Student** (portal user) | To log in normally during result week, even while an attack is happening. Never blocked by someone else's attack. |
| **Portal admin** (IT cell) | To see attacks and bans live, unban someone by hand, and allowlist trusted IPs (for example the exam cell office). |
| **Attacker** (bot) | Not a user we serve. Must be stopped after 10 failed logins in one minute. |

## Problem statement

For the college IT cell, who find out about password-guessing bots only after students complain, Sentinel reads login logs, bans an attacking IP after 10 failed logins in one minute, and lifts the ban at the exact second it expires. Unlike CrowdSec, it needs no separate bouncer, no rule download from a hub, and no polling delay.

## Definitions (exact; the Killer Tests depend on these)

| Term | Exact meaning |
|---|---|
| **Failed login** | A login attempt with a wrong username or wrong password, from a source IP that is not currently banned. Validation errors (missing fields) are **not** failures. Attempts rejected because the IP is already banned are **not** counted. |
| **Window** | The last `WINDOW_SECONDS` (default **60**) seconds, measured backwards from the time of the newest failure. A failure at time `t` is inside the window if `t > now - 60s`. |
| **Threshold** | `THRESHOLD` (default **10**). When an IP's number of failures inside the window reaches the threshold, the IP is banned at once. The **10th** failure triggers the ban, not the 11th. |
| **Ban** | A record `{ ip, created_at, until }`. Every time below is in milliseconds since the Unix epoch, UTC. |
| **Active ban** | A ban where `now < until`. At `now >= until` the ban is over. Nothing has to delete it. |
| **Ban duration** | `BAN_DURATION_SECONDS` (default **60**, so testers can watch it expire). The 1st ban of an IP lasts 1× the duration. With escalation on (improvement 1), the nth ban lasts n× the duration, capped at `MAX_BAN_SECONDS`. |
| **Fresh start after a ban** | Failures that happened before or at a ban's `created_at` never count towards a later ban. |
| **Allowlisted IP** | An IP on the admin's allowlist. Its failures are logged but never cause a ban. |

## Core flow

1. A visitor sends `POST /login` with a username and password from IP `X`.
2. The **ban check** runs first. If `X` has an active ban, the server answers **403** with the ban's `until` and `retryAfterSeconds`. Nothing else happens, and the attempt is not counted.
3. The server checks the credentials against the users table (passwords are stored as scrypt hashes).
4. The server writes one line to the **auth log** (`logs/auth.log`), for example:
   `2026-10-05T18:40:00.123Z sentinel-auth: result=FAIL ip=203.0.113.7 user=student1`
5. The **detector** reads that same line, using the same parser that reads external log files, and stores it as a login event.
6. If the result is FAIL and `X` is not allowlisted, the detector counts `X`'s failures inside the window that came after `X`'s last ban. If the count is at least the threshold and `X` has no active ban, it creates a ban.
7. The response tells the outcome:
   - **200** on success
   - **401** on a failure that did not cause a ban (with `failuresInWindow`)
   - **403** on the failure that caused the ban
8. Every later request from `X` gets **403** until `until`. From `until` onwards, requests from `X` are handled normally again, with no restart, no cleanup job and no delay.

External log files listed in `LOG_FILES` (for example an sshd or web server log) go through steps 5–6 too: Sentinel follows each file and parses every new line.

## Features (MoSCoW)

| Priority | Feature |
|---|---|
| **Must** | Login endpoint with the ban check before credentials are checked |
| **Must** | Auth log file written for every login attempt |
| **Must** | Log parser for our format and the standard sshd "Failed password" format |
| **Must** | Sliding-window failure counting per IP (threshold 10, window 60s) |
| **Must** | Ban with `until`; active only while `now < until`; checked on every request |
| **Must** | One active ban per IP at a time (no duplicates) |
| **Must** | Automated tests that prove the 3 Killer Tests |
| **Should** | **Improvement 1:** escalating ban duration for repeat offenders |
| **Should** | **Improvement 2:** live admin dashboard with manual unban and allowlist |
| **Should** | Follow external log files from `LOG_FILES` |
| **Should** | Ingest API so a tester can submit log lines directly |
| **Could** | Ban check API for other apps (`GET /api/check/:ip`) |
| **Could** | Stats: active bans, failures in the last hour, top attacking IPs |
| **Won't** | Blocking at the firewall (iptables, nftables), CAPI or community blocklists, IP ranges or CIDR bans, a scenario language, multiple servers, deployment |

## Out of scope

- Firewall-level blocking. Sentinel blocks inside the web app only.
- Banning ranges (CIDR). We ban single IPs only.
- Sharing bans with other servers or a central blocklist.
- Real student accounts, password reset and sessions beyond a simple success message.
- Hosting or deployment. It runs on one laptop.

## Acceptance criteria (Given / When / Then)

### Killer Test 1: 10 failed logins from one IP within a minute get that IP banned
- **AC1.1:** **Given** IP A has no failures and no ban, **when** A sends 10 failed logins within 60 seconds, **then** the 10th response is 403 with `error: "banned"`, a ban for A exists with `until = time of 10th failure + BAN_DURATION_SECONDS`, and an 11th request from A gets 403.
- **AC1.2:** **Given** IP A has no failures, **when** A sends 9 failed logins within 60 seconds, **then** all 9 responses are 401 and A has no ban.
- **AC1.3:** **Given** IP A sent 9 failures, the oldest more than 60 seconds ago, **when** A sends 1 more failure, **then** A is not banned, because fewer than 10 failures are inside the window.
- **AC1.4:** **Given** the log file contains 10 sshd "Failed password … from A" lines within 60 seconds, **when** the detector reads them, **then** A is banned.

### Killer Test 2: a normal user logging in at the same time is not affected
- **AC2.1:** **Given** IP A is sending failed logins and gets banned, **when** IP B logs in with correct credentials at the same time (before, during and after A's ban), **then** every one of B's logins returns 200 and B is never banned.
- **AC2.2:** **Given** IP B mistypes its password 3 times and then logs in correctly, **when** A is banned, **then** B is not banned and B's correct login returns 200.
- **AC2.3:** **Given** IP C is on the allowlist, **when** C sends 10 or more failed logins, **then** C is never banned.

### Killer Test 3: the ban is lifted exactly when it expires
- **AC3.1:** **Given** A was banned with `until = U`, **when** A sends a request at any time `t < U` (including `U - 1 ms`), **then** it gets 403.
- **AC3.2:** **Given** A was banned with `until = U`, **when** A sends a request at time `t >= U` (including exactly `U`), **then** it is processed normally (200 or 401), with no restart and no cleanup job.
- **AC3.3:** **Given** A's ban has expired, **when** A sends 1 failed login, **then** A is not banned again at once, because failures from before the ban do not count.

### Improvement 1: escalating bans
- **AC4.1:** **Given** escalation is on and A has been banned once before, **when** A is banned a 2nd time, **then** the ban lasts 2 × `BAN_DURATION_SECONDS`. A 3rd ban lasts 3×, and so on, never more than `MAX_BAN_SECONDS`.

### Improvement 2: admin dashboard
- **AC5.1:** **Given** the admin opens `/dashboard` and enters the admin token, **when** A gets banned, **then** A appears in the active-bans list within 2 seconds, with a live countdown to `until`.
- **AC5.2:** **Given** A has an active ban, **when** the admin presses Unban, **then** the ban's `until` is set to now, and A's next request is processed normally.
- **AC5.3:** **Given** a request to any `/api/admin/*` route without the right token, **then** the response is 401.
