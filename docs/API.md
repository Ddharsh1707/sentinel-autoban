# API: Sentinel

- Base URL: `http://localhost:3000` (the port comes from `PORT`).
- Requests and responses are JSON (`Content-Type: application/json`), except the HTML pages.
- All times in responses are ms since the Unix epoch (UTC). `retryAfterSeconds` is rounded up.

## Who may call what

| Caller | How they are identified |
|---|---|
| Anyone | Nothing needed |
| Admin | Header `Authorization: Bearer <ADMIN_TOKEN>`. Compared in constant time. A wrong or missing token gets **401** `{ "error": "unauthorized" }`. If `ADMIN_TOKEN` is not set, the server generates a random token at startup and prints it to the console |

The **ban gate** runs before `GET /`, `POST /login` and `GET /portal`. For a banned IP it returns:

```
403 { "error": "banned", "ip": "203.0.113.7", "until": 1791130000000, "retryAfterSeconds": 42 }
```

It also sets the header `Retry-After: 42`. The admin API, the dashboard page and `/health` are **not** behind the ban gate, so an admin can never lock themselves out.

---

## Portal

### `GET /`
- **Who:** anyone (ban gate applies)
- **Output:** the login page (HTML)

### `POST /login`
- **Who:** anyone (ban gate applies)
- **Input:** `{ "username": string, "password": string }`

| Status | Body | When |
|---|---|---|
| 200 | `{ "ok": true, "user": "student1" }` | Correct credentials |
| 400 | `{ "error": "invalid_input" }` | Missing or non-string fields, or username or password longer than 128 characters. **Not counted as a failure.** |
| 401 | `{ "error": "invalid_credentials", "failuresInWindow": 3, "threshold": 10 }` | Wrong username or password; no ban yet |
| 403 | `{ "error": "banned", "ip", "until", "retryAfterSeconds", "reason" }` | This failure reached the threshold and created the ban, or the IP was already banned (ban gate) |

**Side effects:**
- One line is appended to `logs/auth.log` and one `login_events` row is written, for every 200, 401 and 403-on-trigger.
- Nothing is logged for a 400 or a ban-gate 403.

### `GET /portal`
- **Who:** anyone (ban gate applies)
- **Output:** `200 { "ok": true }`. This is a simple route testers can call to see whether an IP is blocked.

### `GET /health`
- **Who:** anyone
- **Output:** `200 { "ok": true, "now": <ms> }`

---

## Ban check (for other apps)

### `GET /api/check/:ip`
- **Who:** anyone
- **Output:**
  - `200 { "ip", "banned": true, "until", "retryAfterSeconds" }`, or
  - `200 { "ip", "banned": false }`
- **Errors:** `400 { "error": "invalid_ip" }` if `:ip` is not a valid IPv4 or IPv6 address.

---

## Admin (all need the Bearer token)

### `GET /api/admin/bans?active=true|false`
- **Output:** `200 { "bans": [ { "id", "ip", "created_at", "until", "reason", "offence_number", "failures_counted", "lifted_at", "lifted_by", "active": bool, "retryAfterSeconds" } ] }`. Newest first, at most 200.
- `active=true` (the default) returns only bans with `until > now`.

### `DELETE /api/admin/bans/:ip`
- **Effect:** lifts the IP's active ban by setting `until = now`, `lifted_at = now` and `lifted_by = 'admin'`.
- **Output:**
  - `200 { "lifted": true, "ip" }`, or
  - `404 { "error": "no_active_ban" }`
- **Errors:** 400 `invalid_ip`.

### `GET /api/admin/allowlist`
- **Output:** `200 { "allowlist": [ { "ip", "note", "created_at" } ] }`

### `POST /api/admin/allowlist`
- **Input:** `{ "ip": string, "note"?: string (max 200) }`
- **Output:**
  - `201 { "ip", "note", "created_at" }`
  - `409 { "error": "already_allowlisted" }`
- **Errors:** 400 `invalid_ip`.
- **Note:** adding an IP does **not** lift an existing ban. The admin does that separately.

### `DELETE /api/admin/allowlist/:ip`
- **Output:** `200 { "removed": true }` or `404 { "error": "not_found" }`

### `POST /api/admin/ingest`
- **Input:** `{ "lines": string[] }` (1–1000 lines, each at most 2000 characters)
- **Effect:** every line goes through the same parser and detector as the log files, with `source = 'ingest'`. Lines that don't parse are skipped.
- **Output:** `200 { "processed": 12, "skipped": 1, "bansCreated": [ { "ip", "until" } ] }`
- **Errors:** 400 `invalid_input`.

### `GET /api/admin/stats`
- **Output:** `200 { "now", "activeBans", "failuresLastHour", "successesLastHour", "topIps": [ { "ip", "failures" } ] (top 5 by failures in the last hour), "config": { "threshold", "windowSeconds", "banDurationSeconds", "escalation", "maxBanSeconds" } }`

### `GET /dashboard`
- **Who:** anyone can load the page; the data needs the token, which the page asks for.
- **Output:** HTML page. It polls `/api/admin/stats` and `/api/admin/bans` every 1 s. It shows active bans with a live countdown, an Unban button, the allowlist with add and remove, and the top attacking IPs.

---

## Log line formats the parser accepts

**1. Sentinel format** (written by the portal):
```
<ISO-8601 time> sentinel-auth: result=<SUCCESS|FAIL> ip=<ip> user=<username>
```

**2. sshd format.** The year is not in the line, so the current year is assumed:
```
<Mon> <day> <HH:MM:SS> <host> sshd[<pid>]: Failed password for [invalid user ]<user> from <ip> port <port> ssh2
<Mon> <day> <HH:MM:SS> <host> sshd[<pid>]: Accepted password for <user> from <ip> port <port> ssh2
```

Any other line is skipped.

## Errors common to all routes
- **404** `{ "error": "not_found" }` for unknown routes.
- **500** `{ "error": "internal" }`. The details are logged to the console and never sent to the client.
- **Malformed JSON body:** 400 `{ "error": "invalid_json" }`.
