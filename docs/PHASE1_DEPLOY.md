# Phase 1 staging deployment

This branch intentionally does not reuse the production Worker, KV namespace, or data.

## 1. Create a separate D1 database

```bash
npx wrangler d1 create ofas-meeting-checkin-v2-db
```

Copy the returned `database_id` into `wrangler.toml`.

## 2. Apply migrations

Local:

```bash
npx wrangler d1 migrations apply ofas-meeting-checkin-v2-db --local
```

Remote staging database:

```bash
npx wrangler d1 migrations apply ofas-meeting-checkin-v2-db --remote
```

## 3. Configure secrets

```bash
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put EMAIL_FROM
```

`EMAIL_FROM` must be a sender on a domain verified by Resend.

## 4. Protect the application with Cloudflare Access

Create a separate custom hostname for v2, place a Cloudflare Access application in front of it,
and allow only staff email addresses. Keep `REQUIRE_ACCESS = "true"`.

The API requires both headers injected by Access:

- `Cf-Access-Authenticated-User-Email`
- `Cf-Access-Jwt-Assertion`

Do not expose an unprotected `workers.dev` route for production use.

## 5. Deploy staging

```bash
npx wrangler deploy
```

Verify `GET /api/health` returns:

```json
{"ok":true,"database":"connected"}
```

## 6. Smoke test before real data

1. Import a small fake roster.
2. Open the check-in screen on two devices.
3. Submit the same attendee simultaneously.
4. Confirm one request succeeds and the other reports an existing check-in.
5. Undo the check-in and confirm both devices synchronize.
6. Send a test QR email to the signed-in staff email.
7. Export the roster and check-in CSV.
