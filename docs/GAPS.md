# GAPS: what CrowdSec gets wrong or misses (for our users)

Each gap has evidence in the original. Line references are to commit `7a73b16` (see OBSERVATIONS.md).

| # | Type | What is wrong or missing | Evidence | Who it hurts | What Sentinel does | Severity |
|---|---|---|---|---|---|---|
| 1 | Correctness vs our requirement | The leaky bucket is a rate limit, not "N failures in a time window". `capacity: N` overflows on event N+1, and an attacker who stays under the leak rate is never caught. | pkg/leakybucket/bucket.go:85, pkg/leakybucket/README.md:24-26 | Portal admins (attacks slip through) | Sliding window over stored timestamps; the 10th failure inside 60s bans | High |
| 2 | Timing | Blocking is done by a separate bouncer that polls `/v1/decisions/stream`, so blocking and unblocking happen up to one polling interval late. | pkg/apiserver/controllers/controller.go:148 | Students still blocked after the ban ended; bots get extra tries | The ban check runs in the same process on every request: `now < until` | High |
| 3 | Missing by default | Repeat offenders get the same 4h every time. Escalation exists only as a commented-out line. | config/profiles.yaml:7-8 | Admins (the same bot returns every 4h) | **Improvement 1:** escalating duration | Medium |
| 4 | Data | No unique rule on Decision, so one IP can collect several active bans. | pkg/database/ent/schema/decision.go:54-60 | Admins (confusing lists; unbanning one leaves another active) | One active ban per IP, enforced in a transaction | Medium |
| 5 | Usability | The detection rules are not in the product. They must be downloaded from the Hub, and the repo refers to them by name only. | config/detect.yaml:408 | New admins (nothing works offline out of the box) | Built-in rule, configured with 3 env variables | Medium |
| 6 | Usability | There is no web UI in this repo; it is managed through the CLI. | cmd/ folder listing (crowdsec, crowdsec-cli, notification plugins only) | Non-technical IT cell staff | **Improvement 2:** live dashboard | Medium |
| 7 | Fairness | Buckets are keyed by source IP, so students behind one shared college IP can be banned together because of one bad actor, unless an admin allowlists them through the CLI. | pkg/leakybucket/README.md:15-17, pkg/apiserver/controllers/controller.go:135-139 | Students on shared Wi-Fi | Allowlist managed from the dashboard | Medium |
| 8 | Default duration | A default of 4h is long for a student who simply forgot their password 10 times. | config/profiles.yaml:7 | Students | Short default (60s, configurable) plus escalation for repeat offenders | Low |

---

## The 2 improvements we build

### Improvement 1: escalating bans for repeat offenders
- **What:** an IP's nth ban lasts n × `BAN_DURATION_SECONDS`, capped at `MAX_BAN_SECONDS`. It is turned on with `ESCALATION=true`, which is the default.
- **Why it matters for the Brief:** during result week the same bots come back as soon as a ban ends. With escalation, a student who mistypes gets a short ban, while a bot that keeps returning gets longer and longer ones. The original has this idea but leaves it switched off (gap 3).
- **Acceptance:** AC4.1 in PRD.md.

### Improvement 2: live admin dashboard with manual unban and allowlist
- **What:** the `/dashboard` page shows active bans with a live countdown and the top attacking IPs, and has an Unban button and allowlist management. It is protected by `ADMIN_TOKEN`.
- **Why it matters for the Brief:** the IT cell finds out about attacks *before* students complain (the problem in the Brief). They can also immediately free a student who was wrongly blocked, or allowlist the exam cell's shared IP (gaps 6 and 7).
- **Acceptance:** AC5.1–AC5.3 in PRD.md.
