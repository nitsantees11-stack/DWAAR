// Test double for supabase/functions/server/kv-adapter.tsx, backed by PGlite (dw_kv).
import { run } from './pg.ts'
export const db = () => { throw new Error('not used in tests') }
export const get = async (key: string) => (await run<{ value: unknown }>(`select value from dw_kv where key = $1`, [key]))[0]?.value ?? undefined
export async function mget(keys: string[]) {
  const rows = await run<{ key: string; value: unknown }>(`select key, value from dw_kv where key = any($1::text[])`, [keys])
  return new Map(rows.map((r) => [r.key, r.value]))
}
export const set = async (key: string, value: unknown) => void (await run(`insert into dw_kv (key, value) values ($1, $2::jsonb) on conflict (key) do update set value = excluded.value`, [key, JSON.stringify(value)]))
export const mset = async (entries: [string, unknown][]) => { for (const [k, v] of entries) await set(k, v) }
export const insert = async (key: string, value: unknown) => (await run(`insert into dw_kv (key, value) values ($1, $2::jsonb) on conflict do nothing returning key`, [key, JSON.stringify(value)])).length === 1
export const del = async (key: string) => void (await run(`delete from dw_kv where key = $1`, [key]))
export const mdel = async (keys: string[]) => void (await run(`delete from dw_kv where key = any($1::text[])`, [keys]))
export const delIf = async (key: string, value: { owner?: string }) => void (value?.owner && (await run(`delete from dw_kv where key = $1 and value->>'owner' = $2`, [key, value.owner])))
export const scan = async (prefix: string) => run<{ key: string; value: unknown }>(`select key, value from dw_kv where starts_with(key, $1) order by key`, [prefix])
export const scanKeys = async (prefix: string) => (await scan(prefix)).map((r) => r.key)
