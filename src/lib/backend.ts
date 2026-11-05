import { readFileSync } from 'node:fs'
import { projectId, publicAnonKey } from '../../utils/supabase/info'

export type Backend = 'payload' | 'supabase'

/**
 * Which backend serves the app. `payload` until the Supabase data import is verified; then
 * `supabase`. Payload stays installed as a backup either way.
 */
const DEFAULT_BACKEND: Backend = 'payload'

/** The dwaar edge function (supabase/functions/server). */
export const SUPABASE_FUNCTION_URL = `https://${projectId}.supabase.co/functions/v1/make-server-4d6fa028`

/** The Supabase gateway wants the public anon key on every call; app auth travels in our own headers. */
export const SUPABASE_GATEWAY_HEADERS = { Authorization: `Bearer ${publicAnonKey}`, apikey: publicAnonKey }

type Override = { backend?: Backend; functionUrl?: string }

/**
 * Development only: `.tmp/backend-override.json` can point the preview at another backend or a
 * locally served copy of the function, for testing. Never read in production builds.
 */
function devOverride(): Override | null {
  if (process.env.NODE_ENV === 'production') return null
  try {
    return JSON.parse(readFileSync('.tmp/backend-override.json', 'utf8')) as Override
  } catch {
    return null
  }
}

export function backend(): Backend {
  return devOverride()?.backend ?? DEFAULT_BACKEND
}

export const isSupabase = () => backend() === 'supabase'

export function functionUrl() {
  return devOverride()?.functionUrl ?? SUPABASE_FUNCTION_URL
}
