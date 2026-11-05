// Runs the generated SQL twice against real Postgres (PGlite) and checks the key constraints.
import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@1'
import { PGlite } from 'npm:@electric-sql/pglite@0.3'
import { SCHEMA, buildSql } from '../functions/server/schema.tsx'

Deno.test('schema SQL applies cleanly, twice, and enforces constraints', async () => {
  const sql = Deno.readTextFileSync(new URL('../sql/dwaar-schema.sql', import.meta.url))
  assertEquals(sql, buildSql(), 'supabase/sql/dwaar-schema.sql is stale: run supabase/tests/gen-sql.ts')
  const db = new PGlite()
  // Supabase provides the storage schema; stub the part we touch.
  await db.exec(`create schema storage; create table storage.buckets (id text primary key, name text, public boolean);`)
  await db.exec(sql)
  await db.exec(sql) // idempotent
  const tables = (await db.query<{ table_name: string }>(`select table_name from information_schema.tables where table_schema='public' and table_name like 'dw_%'`)).rows.map((r) => r.table_name)
  for (const s of Object.values(SCHEMA)) assert(tables.includes(s.table), `missing ${s.table}`)
  const rls = (await db.query<{ relname: string; relrowsecurity: boolean }>(`select relname, relrowsecurity from pg_class where relname like 'dw_%' and relkind='r'`)).rows
  assert(rls.every((r) => r.relrowsecurity), 'RLS must be on for every table')
  assertEquals((await db.query(`select id from storage.buckets order by id`)).rows.length, 2)

  const u = (await db.query<{ id: string }>(`insert into dw_users (username) values ('9876543210') returning id`)).rows[0].id
  await assertRejects(() => db.query(`insert into dw_users (username) values ('9876543210')`), Error, 'dw_users_username_key')
  const cat = (await db.query<{ id: string }>(`insert into dw_service_categories (name, slug, flow, icon) values ('AC', 'ac', 'doorstep', 'ac') returning id`)).rows[0].id
  await assertRejects(() => db.query(`insert into dw_service_categories (name, slug, flow, icon) values ('X', 'x', 'teleport', 'ac')`))
  const b = (await db.query<{ id: string }>(`insert into dw_bookings (booking_code, title, customer, category, flow) values ('DW1', 'AC service', '${u}', '${cat}', 'doorstep') returning id`)).rows[0].id
  await assertRejects(() => db.query(`update dw_bookings set status = 'FLYING' where id = '${b}'`))
  const p = (await db.query<{ id: string }>(`insert into dw_partners (username, categories, verification_status) values ('ext-1', array['${cat}']::uuid[], 'pending_verification') returning id`)).rows[0].id
  await assertRejects(() => db.query(`insert into dw_partners (username, external_user_id) values ('ext-2', 'u1'), ('ext-3', 'u1')`), Error, 'dw_partners_external_user_id_key')
  const o = `insert into dw_job_offers (booking, partner, offered_at, expires_at, offer_key, accept_lock) values ('${b}', '${p}', now(), now(), `
  await db.query(`${o} 'k1', 'L')`)
  await assertRejects(() => db.query(`${o} 'k2', 'L')`), Error, 'dw_job_offers_accept_lock_key')
  await db.query(`${o} 'k3', null)`)
  await db.query(`${o} 'k4', null)`) // many open offers without a lock
  const before = (await db.query<{ updated_at: string }>(`select updated_at from dw_bookings where id='${b}'`)).rows[0].updated_at
  await new Promise((r) => setTimeout(r, 20))
  await db.query(`update dw_bookings set title = 'x' where id = '${b}'`)
  const after = (await db.query<{ updated_at: string }>(`select updated_at from dw_bookings where id='${b}'`)).rows[0].updated_at
  assert(new Date(after) > new Date(before), 'updated_at trigger')
  await assertRejects(() => db.query(`delete from dw_users where id = '${u}'`)) // bookings keep their customer
  await db.close()
})
