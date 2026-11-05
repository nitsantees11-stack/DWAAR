/* E2E: category values in the Payload Partner API (GET /categories, PATCH /me with id/key/slug). Test data removed at the end. */
import { randomBytes, randomUUID } from 'node:crypto'
import config from '@payload-config'
import { getPayload, handleEndpoints } from 'payload'

const KEY = randomBytes(24).toString('hex')
process.env.PARTNER_API_KEY = KEY // ephemeral, this process only
const UID = `e2e-cat-${randomBytes(4).toString('hex')}`
const results: { name: string; ok: boolean; info?: string }[] = []
const check = (name: string, cond: unknown, info?: unknown) => results.push({ name, ok: Boolean(cond), info: cond ? undefined : JSON.stringify(info)?.slice(0, 400) })

async function api(method: string, path: string, o: { body?: any; key?: string | null } = {}) {
  const headers = new Headers({ 'x-dwaar-user-id': UID })
  const key = o.key === undefined ? KEY : o.key
  if (key) headers.set('x-dwaar-partner-key', key)
  let body: string | undefined
  if (method !== 'GET') {
    headers.set('content-type', 'application/json')
    body = JSON.stringify({ idempotencyKey: randomUUID(), ...o.body })
  }
  const res = await handleEndpoints({ config, request: new Request(`http://localhost:3000/api/partner/v1/${path}`, { method, headers, body }) })
  return { status: res.status, json: (await res.json().catch(() => null)) as any }
}

const payload = await getPayload({ config })
try {
  check('GET categories needs the partner key', (await api('GET', 'categories', { key: null })).json?.error === 'missing_api_key')
  const cats = (await api('GET', 'categories')).json
  check('GET categories lists the live keys', JSON.stringify(cats?.categories?.map((c: any) => c.key).sort()) === JSON.stringify(['ac', 'bike', 'mobile']), cats)
  check('GET categories maps roles to keys', JSON.stringify(cats?.roles) === JSON.stringify({ technician: ['ac'], mechanic: ['bike'], rider: ['mobile'], hub_technician: ['mobile'] }), cats?.roles)
  const ac = cats.categories.find((c: any) => c.key === 'ac')
  check('each category has id, slug, name, flow, roles', cats.categories.every((c: any) => c.id && c.slug && c.name && c.flow && c.roles.length), cats.categories)

  const byKey = await api('PATCH', 'me', { body: { role: 'technician', categories: ['ac'] } })
  check('PATCH me accepts key "ac"', byKey.status === 200 && byKey.json.partner.categories[0]?.id === ac.id && byKey.json.partner.categories[0]?.key === 'ac', byKey.json)
  const stored = (await payload.find({ collection: 'partners', overrideAccess: true, depth: 0, where: { externalUserId: { equals: UID } } })).docs[0] as any
  check('stored as the category id', JSON.stringify(stored?.categories) === JSON.stringify([ac.id]), stored?.categories)
  check('PATCH me accepts the slug', (await api('PATCH', 'me', { body: { categories: [ac.slug] } })).json?.partner?.categories?.[0]?.id === ac.id)
  check('PATCH me still accepts the id', (await api('PATCH', 'me', { body: { categories: [ac.id] } })).json?.partner?.categories?.[0]?.id === ac.id)
  const dup = await api('PATCH', 'me', { body: { categories: ['AC', ac.id] } })
  check('case-insensitive key, duplicates merged', dup.json?.partner?.categories?.length === 1, dup.json)
  check('wrong flow for the role -> category_role_mismatch', (await api('PATCH', 'me', { body: { categories: ['bike'] } })).json?.error === 'category_role_mismatch')
  const soon = await api('PATCH', 'me', { body: { categories: ['fridge'] } })
  check('coming-soon category -> invalid_category naming it', soon.json?.error === 'invalid_category' && soon.json?.params?.value === 'fridge', soon.json)
  check('unknown value -> invalid_category', (await api('PATCH', 'me', { body: { categories: ['washing-machine'] } })).json?.error === 'invalid_category')
  const swap = await api('PATCH', 'me', { body: { role: 'mechanic', categories: ['bike'] } })
  check('role and key change together', swap.json?.partner?.role === 'mechanic' && swap.json?.partner?.categories?.[0]?.key === 'bike', swap.json)
  check('rider + mobile', (await api('PATCH', 'me', { body: { role: 'rider', categories: ['mobile'] } })).json?.partner?.categories?.[0]?.key === 'mobile')

  await api('PATCH', 'me', { body: { role: 'technician', categories: ['ac'] } })
  const test = await api('GET', 'skill-test?category=ac')
  check('skill test by key', test.status === 200 && test.json.test?.questions?.length > 0, test.json)
  check('skill test answers stay hidden', !JSON.stringify(test.json).includes('correctIndex'))
  check('skill test for an unselected key -> category_not_selected', (await api('GET', 'skill-test?category=bike')).json?.error === 'category_not_selected')
  const n = test.json?.test?.questions?.length ?? 1
  const sub = await api('POST', 'skill-test/submit', { body: { category: 'ac', answers: Array.from({ length: n }, () => 0) } })
  check('skill test submit by key', sub.status === 200 && typeof sub.json.score === 'number', sub.json)
} catch (err) {
  check('harness crashed', false, String((err as Error)?.stack ?? err))
} finally {
  const ids = ((await payload.find({ collection: 'partners', overrideAccess: true, depth: 0, pagination: false, where: { externalUserId: { equals: UID } } })).docs as any[]).map((d) => d.id)
  for (const id of ids) await payload.delete({ collection: 'idempotency-keys', overrideAccess: true, where: { scopeKey: { like: `p:${id}` } } })
  if (ids.length) await payload.delete({ collection: 'partners', overrideAccess: true, where: { id: { in: ids } } })
  const left = (await payload.count({ collection: 'partners', overrideAccess: true, where: { externalUserId: { equals: UID } } })).totalDocs
  check('test partner cleaned up', left === 0, left)
  const passed = results.filter((r) => r.ok).length
  const { writeFileSync } = await import('node:fs')
  writeFileSync('.tmp/categories-results.json', JSON.stringify({ passed, failed: results.length - passed, failures: results.filter((r) => !r.ok), all: results.map((r) => `${r.ok ? 'PASS' : 'FAIL'} ${r.name}`) }, null, 1))
  process.exit(0)
}
