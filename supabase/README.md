# dwaar on Supabase

The whole dwaar backend (catalog, customer accounts, bookings, dispatch, Partner API, money,
support, files) runs as one Supabase Edge Function on real Postgres tables.

| Part | Where |
|---|---|
| Database schema (22 `dw_*` tables + `dw_kv` + `dw_globals`, storage buckets) | `supabase/sql/dwaar-schema.sql` |
| Edge function `make-server-4d6fa028` | `supabase/functions/server/` (entry `index.tsx`, routes `app.tsx`) |
| Payload → Supabase data copy | `scripts/export-to-supabase.ts` |
| Tests (real Postgres via PGlite) | `supabase/tests/` |

## 1. Create the tables (once)

Supabase Dashboard → your project → **SQL Editor** → **New query** → paste the whole of
`supabase/sql/dwaar-schema.sql` → **Run**. It is safe to run again. Every table has Row Level
Security on with no policies, so only the edge function (service role) can read or write.

## 2. Secret

Supabase Dashboard → **Edge Functions** → **Secrets**: `PARTNER_API_KEY` = the same value the
Partner app sends in `X-Dwaar-Partner-Key`.

## 3. Deploy the function

The function folder must be named after the function when you use the Supabase CLI:

```sh
npx supabase login
npx supabase link --project-ref kbyvmlxcgmrxxqhdawom
cp -r supabase/functions/server supabase/functions/make-server-4d6fa028
npx supabase functions deploy make-server-4d6fa028
```

Check: `GET https://kbyvmlxcgmrxxqhdawom.supabase.co/functions/v1/make-server-4d6fa028/version`
(with `Authorization: Bearer <anon key>`) returns `{"phase":2,"backend":"postgres","build":"2026-11-05.2"}`.
The `build` value changes with each function update, so it shows whether the latest code is live.

## 4. Copy the data (done by the dwaar build agent)

```sh
pnpm exec payload run --input '{"scriptPath":"scripts/export-to-supabase.ts","scriptArgs":["<payload app url>"]}'
```

Copies every record (same ids) and every file. Needs the import token (`.tmp/dwaar-import-token`,
backed up in the chat session's storage), which is never committed; the function only holds its
SHA-256 (`importer.tsx`), so a new token needs a redeploy. Clear
`IMPORT_TOKEN_SHA256` after the move to close the import endpoint.

## 5. Switch the app

`src/lib/backend.ts` → `DEFAULT_BACKEND = 'supabase'`. Every customer screen and server action
then talks to the function (session cookie `dwaar-session`), and the Partner app keeps calling
`/api/partner/v1/*` on the dwaar app, which forwards to the function. Payload stays installed as a
backup; set it back to `'payload'` to return.

For testing in the preview only, `.tmp/backend-override.json` (gitignored, ignored in production)
can point the app at another backend or a local copy of the function:
`{"backend":"supabase","functionUrl":"http://127.0.0.1:8788/make-server-4d6fa028"}` with
`supabase/tests/local-server.ts` running.

## Managing data without an admin panel

Use **Table Editor** in the Supabase dashboard:

- Catalog: `dw_service_categories`, `dw_services`, `dw_device_models`, `dw_promotions`; config in `dw_globals` (`business-config`).
- Partner verification: review `dw_partner_documents` (set `status` to `approved` / `rejected`), then set the partner's `verification_status` to `approved`.
- Payouts: set `dw_payouts.status` to `paid` (with `reference`) or `failed`; a failed payout is refunded to the partner's ledger automatically.
- Support: write `reply` and `status` on `dw_support_tickets` / `dw_partner_tickets`. SOS alerts are `dw_partner_tickets` with `urgent = true`.

Do not edit `dw_bookings.status` by hand: status changes go through the state machine in the
function (customer, partner and dispatcher actions).

## Tests

```sh
deno run -A supabase/tests/gen-sql.ts                       # regenerate the SQL from schema.tsx
deno test --no-config -A --no-check supabase/tests/sql.test.ts supabase/tests/lib-sync.test.ts
SRC=http://localhost:3000 IMPORT_TOKEN=$(cat .tmp/dwaar-import-token) \
  deno test --no-config --import-map=supabase/tests/import_map.json -A --no-check supabase/tests/backend.test.ts
```
