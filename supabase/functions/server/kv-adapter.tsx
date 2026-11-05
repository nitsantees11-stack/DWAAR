import { createClient } from 'jsr:@supabase/supabase-js@2.49.8'

/**
 * Short-lived server data in the dw_kv table (see supabase/sql/dwaar-schema.sql): sessions, OTP
 * challenges, rate limits, idempotency records and locks. `insert` fails when the key already
 * exists, which is the atomic primitive behind locks. Tests swap this module for an in-memory one.
 */
const TABLE = 'dw_kv'
let cached: ReturnType<typeof createClient> | null = null
export function db() {
  cached ??= createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return cached
}

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`)

export async function get(key: string): Promise<unknown> {
  const { data, error } = await db().from(TABLE).select('value').eq('key', key).maybeSingle()
  if (error) throw new Error(error.message)
  return data?.value ?? undefined
}

export async function mget(keys: string[]): Promise<Map<string, unknown>> {
  const out = new Map<string, unknown>()
  for (let i = 0; i < keys.length; i += 200) {
    const chunk = keys.slice(i, i + 200)
    const { data, error } = await db().from(TABLE).select('key, value').in('key', chunk)
    if (error) throw new Error(error.message)
    for (const row of data ?? []) out.set(row.key as string, row.value)
  }
  return out
}

export async function set(key: string, value: unknown): Promise<void> {
  const { error } = await db().from(TABLE).upsert({ key, value })
  if (error) throw new Error(error.message)
}

export async function mset(entries: [string, unknown][]): Promise<void> {
  for (let i = 0; i < entries.length; i += 200) {
    const chunk = entries.slice(i, i + 200).map(([key, value]) => ({ key, value }))
    const { error } = await db().from(TABLE).upsert(chunk)
    if (error) throw new Error(error.message)
  }
}

/** Inserts only if the key is free. Returns false when another writer already holds it. */
export async function insert(key: string, value: unknown): Promise<boolean> {
  const { error } = await db().from(TABLE).insert({ key, value })
  if (!error) return true
  if (error.code === '23505' || /duplicate key/i.test(error.message)) return false
  throw new Error(error.message)
}

export async function del(key: string): Promise<void> {
  const { error } = await db().from(TABLE).delete().eq('key', key)
  if (error) throw new Error(error.message)
}

export async function mdel(keys: string[]): Promise<void> {
  for (let i = 0; i < keys.length; i += 200) {
    const { error } = await db().from(TABLE).delete().in('key', keys.slice(i, i + 200))
    if (error) throw new Error(error.message)
  }
}

/** Deletes a lock row only while `owner` still holds it. */
export async function delIf(key: string, value: { owner?: string }): Promise<void> {
  if (!value?.owner) return
  const { error } = await db().from(TABLE).delete().eq('key', key).eq('value->>owner', value.owner)
  if (error) throw new Error(error.message)
}

export async function scan(prefix: string, limit = 5000): Promise<{ key: string; value: unknown }[]> {
  const out: { key: string; value: unknown }[] = []
  for (let from = 0; out.length < limit; from += 1000) {
    const { data, error } = await db()
      .from(TABLE)
      .select('key, value')
      .like('key', `${likeEscape(prefix)}%`)
      .order('key')
      .range(from, from + 999)
    if (error) throw new Error(error.message)
    for (const row of data ?? []) out.push({ key: row.key as string, value: row.value })
    if (!data || data.length < 1000) break
  }
  return out
}

export async function scanKeys(prefix: string, limit = 5000): Promise<string[]> {
  const out: string[] = []
  for (let from = 0; out.length < limit; from += 1000) {
    const { data, error } = await db().from(TABLE).select('key').like('key', `${likeEscape(prefix)}%`).order('key').range(from, from + 999)
    if (error) throw new Error(error.message)
    for (const row of data ?? []) out.push(row.key as string)
    if (!data || data.length < 1000) break
  }
  return out
}
