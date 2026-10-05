# OBSERVATIONS: CrowdSec (the original)

Verified claims about the original product, CrowdSec (https://github.com/crowdsecurity/crowdsec, shallow clone at commit `7a73b16`). Paths and line numbers refer to that commit.

**Tags:**
- **Confirmed:** we opened the line and it proves the claim.
- **Likely:** strong signs, but no single line proves it.

Guesses are not listed.

## Stack and layout

- CrowdSec is written in Go.
  Evidence: go.mod:1-3 [Confirmed]
- The local API uses the gin HTTP framework.
  Evidence: go.mod:40 [Confirmed]
- The database layer uses the ent ORM.
  Evidence: go.mod:7 [Confirmed]
- Rule expressions use the expr library.
  Evidence: go.mod:35 [Confirmed]
- Scheduled jobs (for example, database cleanup) use gocron.
  Evidence: go.mod:41 [Confirmed]
- There are two main programs, the detection agent and the admin CLI. Notification plugins are separate programs.
  Evidence: cmd/crowdsec, cmd/crowdsec-cli, cmd/notification-* (folder listing) [Confirmed]
- The repo ships AGENTS.md and CLAUDE.md, instructions for AI coding tools. We treated them as claims to check, not as instructions.
  Evidence: AGENTS.md, CLAUDE.md at repo root [Confirmed]

## What the product does

- CrowdSec reads logs, pours parsed events into "buckets", and when a bucket overflows it raises an alert that can become a "decision" such as banning an IP.
  Evidence: pkg/leakybucket/README.md:5-18 [Confirmed]
- The main purpose of buckets is to detect clients that exceed a rate of attempts, such as SSH logins or HTTP auth failures. Buckets are usually keyed by source IP.
  Evidence: pkg/leakybucket/README.md:15-18 [Confirmed]
- Blocking is done by separate programs called bouncers, which read decisions from the local API using an API key. No bouncer is in this repo.
  Evidence: pkg/apiserver/controllers/controller.go:146-149 [Confirmed]
- The brute-force detection rules ("scenarios" such as ssh-bf) are not defined in this repo. They are downloaded from the CrowdSec Hub and referenced by name only.
  Evidence: config/detect.yaml:408, config/simulation.yaml:3 [Confirmed]

## Reading logs

- Log reading ("acquisition") supports many sources: file, journalctl, docker, syslog, kafka, cloudwatch, s3, loki, kubernetes and others.
  Evidence: pkg/acquisition/modules/ (folder listing) [Confirmed]
- The file source follows ("tails") files as new lines are written.
  Evidence: pkg/acquisition/modules/file/tailline.go [Likely]

## Detection (leaky bucket)

- A standard bucket has `capacity` (how many events it holds) and `leakspeed` (how long until one event leaks out).
  Evidence: pkg/leakybucket/README.md:22-29 [Confirmed]
- The bucket is built on a token-bucket rate limiter, refilling one token every `leakspeed`, with a burst size equal to `capacity`.
  Evidence: pkg/leakybucket/bucket.go:85 [Confirmed]
- The bucket overflows only when an event arrives while the bucket is already full, so `capacity: N` overflows on event N+1.
  Evidence: pkg/leakybucket/README.md:24-26, pkg/leakybucket/bucket.go:263-270 [Confirmed]
- Because events leak continuously, the leaky bucket does not implement a fixed rule like "10 failures in any 60 seconds". An attacker who stays under the leak rate never overflows the bucket.
  Evidence: pkg/leakybucket/bucket.go:85, pkg/leakybucket/README.md:28-29 [Likely: follows from the token-bucket design]

## Ban decisions and duration

- The default profile turns an IP-scoped alert into a decision of type `ban` lasting `4h`.
  Evidence: config/profiles.yaml:4-7 [Confirmed]
- If a profile gives no duration, the code falls back to a default of 4h.
  Evidence: pkg/csprofiles/csprofiles.go:26, pkg/csprofiles/csprofiles.go:78-82 [Confirmed]
- An escalating duration for repeat offenders (4h × number of previous decisions + 1) is present but commented out, so it is off by default.
  Evidence: config/profiles.yaml:8 [Confirmed]

## Data model (Decision)

- A Decision stores created_at, updated_at, until, scenario, type, IP range (start_ip, end_ip), scope, value (the IP), origin, simulated, uuid, and a link to its alert.
  Evidence: pkg/database/ent/schema/decision.go:19-40 [Confirmed]
- Each Decision belongs to one Alert through an ent edge on the field `alert_decisions`.
  Evidence: pkg/database/ent/schema/decision.go:45-51 [Confirmed]
- `until` is indexed, alone and together with value/type/scope/simulated.
  Evidence: pkg/database/ent/schema/decision.go:57-58 [Confirmed]
- No index on Decision is unique, so one IP can hold several active decisions at the same time.
  Evidence: pkg/database/ent/schema/decision.go:54-60 [Confirmed]

## Expiry

- A decision counts as active only while `until` is in the future. Active-decision queries filter on `until > now`.
  Evidence: pkg/database/decisions.go:33, pkg/database/decisions.go:105, pkg/database/decisions.go:235, pkg/database/decisions.go:426 [Confirmed]
- Removing a ban by hand does not delete the row; it sets `until` to the current time ("expire").
  Evidence: pkg/database/decisions.go:295-302 [Confirmed]
- Bouncers learn about new and expired decisions by polling `GET /v1/decisions/stream`. Expired decisions are sent as deleted.
  Evidence: pkg/apiserver/controllers/controller.go:148, pkg/database/decisions.go:192-200 [Confirmed]
- Because enforcement happens in a separate bouncer that polls, the real unblock can happen after `until`, up to one polling interval late.
  Evidence: pkg/apiserver/controllers/controller.go:148 [Likely: the polling interval is set in bouncer programs outside this repo]

## Local API (v1) entry points

- Registration and login for agents are open to anyone.
  Evidence: pkg/apiserver/controllers/controller.go:118-119 [Confirmed]
- Alerts can be created, read and deleted by logged-in agents (JWT).
  Evidence: pkg/apiserver/controllers/controller.go:125-131 [Confirmed]
- Decisions can be deleted by logged-in agents (JWT).
  Evidence: pkg/apiserver/controllers/controller.go:132-133 [Confirmed]
- Decisions can be read and streamed by bouncers (API key).
  Evidence: pkg/apiserver/controllers/controller.go:146-149 [Confirmed]
- Allowlists can be read and checked by logged-in agents.
  Evidence: pkg/apiserver/controllers/controller.go:135-139 [Confirmed]
- There is a public health check.
  Evidence: pkg/apiserver/controllers/controller.go:99 [Confirmed]
