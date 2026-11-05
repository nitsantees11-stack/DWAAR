// The edge function carries copies of pure app modules (Deno needs explicit .tsx imports).
// This fails if a copy drifts from its source in src/lib.
import { assertEquals } from 'jsr:@std/assert@1'

const PAIRS: [string, string][] = [
  ['src/lib/booking-machine.ts', 'lib-booking-machine.tsx'],
  ['src/lib/pricing.ts', 'lib-pricing.tsx'],
  ['src/lib/slots.ts', 'lib-slots.tsx'],
  ['src/lib/time.ts', 'lib-time.tsx'],
  ['src/lib/geo.ts', 'lib-geo.tsx'],
  ['src/lib/money.ts', 'lib-money.tsx'],
  ['src/lib/partner/constants.ts', 'lib-partner-constants.tsx'],
]
const root = new URL('../../', import.meta.url)
const normalize = (s: string) =>
  s
    .split('\n')
    .filter((l) => !l.startsWith('// Copied from'))
    .join('\n')
    .replace(/from '\.\/lib-([a-z-]+)\.tsx'/g, "from './$1'")
    .trim()

for (const [src, copy] of PAIRS) {
  Deno.test(`${copy} matches ${src}`, () => {
    const a = Deno.readTextFileSync(new URL(src, root))
    const b = Deno.readTextFileSync(new URL(`supabase/functions/server/${copy}`, root))
    assertEquals(normalize(b), normalize(a), `run: copy ${src} into supabase/functions/server/${copy}`)
  })
}
