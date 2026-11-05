// Shared in-process Postgres (PGlite) with the real dwaar schema, for adapter test doubles.
import { PGlite } from 'npm:@electric-sql/pglite@0.3'
import { buildSql } from '../functions/server/schema.tsx'

export const pg = new PGlite()
await pg.exec(`create schema storage; create table storage.buckets (id text primary key, name text, public boolean);`)
await pg.exec(buildSql())

/** Mimic PostgREST JSON: timestamps as ISO strings, bigint as number. */
export function normalize(row: Record<string, unknown>) {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row)) out[k] = v instanceof Date ? v.toISOString() : typeof v === 'bigint' ? Number(v) : v
  return out
}

const types = new Map<string, Map<string, string>>()
export async function columnTypes(table: string) {
  if (!types.has(table)) {
    const res = await pg.query<{ column_name: string; data_type: string; udt_name: string }>(
      `select column_name, data_type, udt_name from information_schema.columns where table_name = $1`,
      [table],
    )
    types.set(table, new Map(res.rows.map((r) => [r.column_name, r.data_type === 'ARRAY' ? r.udt_name.replace(/^_/, '') + '[]' : r.udt_name])))
  }
  return types.get(table)!
}

export async function encode(table: string, row: Record<string, unknown>) {
  const t = await columnTypes(table)
  const cols = Object.keys(row).filter((k) => t.has(k))
  const params = cols.map((k) => {
    const v = row[k]
    const type = t.get(k)!
    if (v === null || v === undefined) return null
    if (type === 'jsonb') return JSON.stringify(v)
    return v
  })
  const casts = cols.map((k, i) => `$${i + 1}::${t.get(k)}`)
  return { cols, params, casts }
}

export class PgError extends Error {
  constructor(public code: string, message: string) {
    super(message)
  }
}

export async function run<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  try {
    return (await pg.query(sql, params)).rows.map((r) => normalize(r as Record<string, unknown>)) as T[]
  } catch (err) {
    const e = err as { code?: string; message: string }
    throw new PgError(e.code ?? 'XX000', e.message)
  }
}
