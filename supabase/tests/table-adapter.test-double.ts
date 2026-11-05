// Test double for supabase/functions/server/table-adapter.tsx, backed by PGlite + the real schema.
import { PgError, encode, run } from './pg.ts'

export type Row = Record<string, unknown>
export class DbUniqueError extends Error {
  constructor(public constraint: string) {
    super(`unique violation: ${constraint}`)
  }
}
async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof PgError && err.code === '23505') throw new DbUniqueError(/constraint "([^"]+)"/.exec(err.message)?.[1] ?? 'unknown')
    throw err
  }
}
export const selectById = async (table: string, id: string) => (await run(`select * from ${table} where id = $1`, [id]))[0] ?? null
export const selectByIds = (table: string, ids: string[]) => run(`select * from ${table} where id = any($1::uuid[])`, [ids])
export const selectWhere = (table: string, column: string, value: string, opts: { array?: boolean } = {}) =>
  opts.array ? run(`select * from ${table} where $1 = any(${column}) order by created_at`, [value]) : run(`select * from ${table} where ${column}::text = $1 order by created_at`, [value])
export const selectAll = (table: string) => run(`select * from ${table} order by created_at`)
export async function insertRow(table: string, row: Row) {
  const { cols, params, casts } = await encode(table, row)
  return guarded(async () => (await run(`insert into ${table} (${cols.join(', ')}) values (${casts.join(', ')}) returning *`, params))[0])
}
export async function upsertRow(table: string, row: Row) {
  const { cols, params, casts } = await encode(table, row)
  const set = cols.filter((c) => c !== 'id').map((c) => `${c} = excluded.${c}`).join(', ')
  return guarded(async () => (await run(`insert into ${table} (${cols.join(', ')}) values (${casts.join(', ')}) on conflict (id) do update set ${set} returning *`, params))[0])
}
export const deleteRow = async (table: string, id: string) => void (await run(`delete from ${table} where id = $1`, [id]))
export const deleteWhereBefore = async (table: string, column: string, before: string) => void (await run(`delete from ${table} where ${column} < $1::timestamptz`, [before]))
export const getGlobalRow = async (slug: string) => ((await run<{ data: Row }>(`select data from dw_globals where slug = $1`, [slug]))[0]?.data as Row) ?? null
export const setGlobalRow = async (slug: string, value: Row) =>
  void (await run(`insert into dw_globals (slug, data) values ($1, $2::jsonb) on conflict (slug) do update set data = excluded.data, updated_at = now()`, [slug, JSON.stringify(value)]))
