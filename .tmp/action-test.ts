import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import config from '@payload-config'
import { getPayload } from 'payload'
import { createRequire } from 'node:module'
const req = createRequire(import.meta.url)
const { encodeReply } = req('next/dist/compiled/react-server-dom-turbopack/client.edge.js')
const BASE = 'http://localhost:3000'
const payload = await getPayload({ config })
const out: string[] = []
const pw = randomUUID()
await payload.delete({ collection: 'users', overrideAccess: true, where: { username: { equals: '6999900096' } } })
const u = await payload.create({ collection: 'users', overrideAccess: true, data: { username: '6999900096', password: pw, name: 'Action Tester', language: 'hinglish', onboarded: true } as any })
try {
  const { token } = await payload.login({ collection: 'users', data: { username: '6999900096', password: pw } as any })
  const cookie = `app-session=${token}; dwaar-lang=hinglish`
  const html = await (await fetch(`${BASE}/book/mobile-repair`, { headers: { cookie } })).text()
  const srcs = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1])
  let actionId: string | null = null
  const manifest = JSON.parse(readFileSync('.next/dev/server/server-reference-manifest.json', 'utf8'))
  actionId = Object.entries(manifest.node).find(([, v]: any) => v.exportedName === 'uploadProblemVideo')?.[0] ?? null
  for (const src of actionId ? [] : srcs) {
    const js = await (await fetch(new URL(src, BASE))).text()
    const m = js.match(/createServerReference\)?\(\s*"([0-9a-f]{40,})"[^)]*?"uploadProblemVideo"/) || js.match(/"([0-9a-f]{40,})"[^"]{0,200}"uploadProblemVideo"/)
    if (m) { actionId = m[1]; break }
  }
  out.push(`actionId found: ${Boolean(actionId)} (scripts scanned: ${srcs.length})`)
  if (actionId) {
    const send = async (buf: Buffer, type: string, name: string) => {
      const arg = new FormData()
      arg.set('video', new File([buf], name, { type }))
      arg.set('durationSec', '3')
      const fd = await encodeReply([arg])
      const res = await fetch(`${BASE}/book/mobile-repair`, { method: 'POST', headers: { cookie, 'Next-Action': actionId!, Accept: 'text/x-component' }, body: fd })
      return { status: res.status, body: (await res.text()).slice(-300) }
    }
    const ok = await send(readFileSync('.tmp/problem.mp4'), 'video/mp4', 'problem.mp4')
    out.push(`mp4 upload -> ${ok.status} ${ok.body.replace(/\s+/g, ' ')}`)
    const big = await send(Buffer.alloc(3 * 1024 * 1024, 1), 'video/mp4', 'big.mp4')
    out.push(`3 MB body (over the old 1 MB default) -> ${big.status} ${big.body.replace(/\s+/g, ' ').slice(-160)}`)
    const pdf = await send(Buffer.from('%PDF-1.4'), 'application/pdf', 'x.pdf')
    out.push(`pdf -> ${pdf.status} ${pdf.body.replace(/\s+/g, ' ').slice(-120)}`)
    const docs = (await payload.find({ collection: 'problem-videos', overrideAccess: true, depth: 0, where: { owner: { equals: u.id } } })).docs as any[]
    out.push(`stored for tester: ${docs.length} -> ${docs.map((d) => `${d.mimeType} ${d.filesize}B dur=${d.durationSec}`).join(', ')}`)
  }
} catch (e) {
  out.push(`crash: ${String((e as Error).stack).slice(0, 600)}`)
} finally {
  await payload.delete({ collection: 'problem-videos', overrideAccess: true, where: { owner: { equals: u.id } } })
  await payload.delete({ collection: 'users', overrideAccess: true, where: { id: { equals: u.id } } })
  writeFileSync('.tmp/action-results.txt', out.join('\n'))
  process.exit(0)
}
