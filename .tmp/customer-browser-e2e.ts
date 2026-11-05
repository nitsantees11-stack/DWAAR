/* Browser E2E of the customer app on the Supabase backend (preview pointed at a backend through
 * .tmp/backend-override.json). Run: deno run -A .tmp/customer-browser-e2e.ts <phone> <oldPhone> */
import puppeteer, { type Page } from 'npm:puppeteer-core@23'

const BASE = 'http://localhost:3000'
const [PHONE = '9876543299', OLD_PHONE = ''] = Deno.args
const results: { name: string; ok: boolean; info?: string }[] = []
const check = (name: string, ok: unknown, info?: unknown) => results.push({ name, ok: Boolean(ok), info: ok ? undefined : String(info ?? '').slice(0, 300) })
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
let shot = 0
async function snap(page: Page, label: string) {
  await page.screenshot({ path: `/tmp/shots/${String(++shot).padStart(2, '0')}-${label}.png`, fullPage: true }).catch(() => undefined)
}
async function text(page: Page) {
  return page.evaluate(() => document.body.innerText)
}
async function waitText(page: Page, needle: string | RegExp, ms = 25_000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const t = await text(page).catch(() => '')
    if (typeof needle === 'string' ? t.includes(needle) : needle.test(t)) return true
    await sleep(300)
  }
  return false
}
/** Clicks the first enabled button (or link) whose text contains `label`. */
async function click(page: Page, label: string, selector = 'button, a') {
  const ok = await page.evaluate(
    (label, selector) => {
      const el = [...document.querySelectorAll<HTMLElement>(selector)].find((e) => e.innerText.includes(label) && !(e as HTMLButtonElement).disabled)
      if (!el) return false
      el.click()
      return true
    },
    label,
    selector,
  )
  if (!ok) throw new Error(`no clickable "${label}"`)
}
async function fill(page: Page, selector: string, value: string) {
  await page.waitForSelector(selector, { timeout: 15_000 })
  await page.click(selector, { clickCount: 3 })
  await page.type(selector, value)
}

async function login(page: Page, phone: string) {
  await page.setCookie({ name: 'dwaar-lang', value: 'en', url: BASE })
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' })
  await fill(page, 'input[autocomplete="tel-national"]', phone)
  await click(page, 'Send OTP')
  await page.waitForFunction(() => [...document.querySelectorAll('span.font-mono')].some((s) => /^\d{6}$/.test(s.textContent ?? '')), { timeout: 25_000 })
  const code = await page.evaluate(() => [...document.querySelectorAll('span.font-mono')].map((s) => s.textContent ?? '').find((t) => /^\d{6}$/.test(t)))
  await page.type('input[autocomplete="one-time-code"]', String(code))
  await page.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 30_000 })
}

try {
  const page = await browser.newPage()
  page.setDefaultTimeout(30_000)
  await page.setViewport({ width: 420, height: 900 })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))

  // Login page renders the catalog from Supabase.
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' })
  const loginText = await text(page)
  check('login page renders the catalog from Supabase', /AC Service/.test(loginText) && /Mobile Repair/.test(loginText), loginText.slice(0, 200))

  await login(page, PHONE)
  check('new customer lands on onboarding', page.url().includes('/onboarding'), page.url())
  await snap(page, 'onboarding')
  await fill(page, 'form input', 'Browser Tester')
  await page.evaluate(() => document.querySelector<HTMLFormElement>('form')?.requestSubmit())
  await page.waitForFunction(() => location.pathname === '/', { timeout: 30_000 })
  await sleep(1500)
  const home = await text(page)
  await snap(page, 'home')
  check('home shows Supabase catalog', /AC|Mobile|Bike/i.test(home), home.slice(0, 300))

  await page.goto(`${BASE}/account`, { waitUntil: 'networkidle2' })
  check('account shows the new name', (await text(page)).includes('Browser Tester'), (await text(page)).slice(0, 200))

  // Address through the app.
  await page.goto(`${BASE}/account/addresses`, { waitUntil: 'networkidle2' })
  await snap(page, 'addresses')
  if (!(await page.$('#addr-flat'))) await click(page, 'Add')
  await fill(page, '#addr-flat', 'B-12, Tower 3')
  await fill(page, '#addr-area', 'Sector 29')
  await fill(page, '#addr-city', 'Gurugram')
  await fill(page, '#addr-pincode', '122001')
  await fill(page, '#addr-contactName', 'Browser Tester')
  await fill(page, '#addr-contactPhone', PHONE)
  await page.evaluate(() => [...document.querySelectorAll('form')].find((f) => f.querySelector('#addr-flat'))?.requestSubmit())
  check('address saved', await waitText(page, 'Tower 3'), (await text(page)).slice(0, 300))
  await snap(page, 'address-saved')

  // Book an AC service through the wizard.
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' })
  const acHref = await page.evaluate(() => [...document.querySelectorAll<HTMLAnchorElement>('a[href^="/services/"]')].map((a) => a.getAttribute('href')).find((h) => /ac/i.test(h ?? '')))
  const slug = (acHref ?? '/services/ac-repair').split('/')[2]
  await page.goto(`${BASE}/book/${slug}`, { waitUntil: 'networkidle2' })
  await snap(page, 'book-0')
  // Step 0: first service card.
  await page.evaluate(() => {
    const main = document.querySelector('main') ?? document.body
    const card = [...main.querySelectorAll<HTMLButtonElement>('button')].find((b) => /₹/.test(b.innerText) && !b.disabled)
    card?.click()
  })
  await sleep(300)
  await click(page, 'Next')
  // Step 1: device type and brand (first options).
  await sleep(500)
  await snap(page, 'book-1')
  await page.evaluate(() => {
    const groups = [...document.querySelectorAll('p')].filter((p) => /Type|Brand/i.test(p.textContent ?? ''))
    for (const g of groups) {
      const btn = g.parentElement?.querySelector<HTMLButtonElement>('button')
      btn?.click()
    }
  })
  await sleep(300)
  await click(page, 'Next')
  // Step 2: the saved address.
  await sleep(500)
  await snap(page, 'book-2')
  await click(page, 'Tower 3', 'button')
  await click(page, 'Next')
  // Step 3: first slot.
  await sleep(500)
  await snap(page, 'book-3')
  const pickSlot = () =>
    page.evaluate(() => {
      const slot = [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => /\d(am|pm)\s*[–-]\s*\d/i.test(b.innerText) && !b.disabled)
      slot?.click()
      return Boolean(slot)
    })
  if (!(await pickSlot())) {
    await click(page, 'Tomorrow')
    await sleep(300)
    await pickSlot()
  }
  await sleep(300)
  await click(page, 'Next')
  // Step 4: review, trust, confirm.
  await sleep(800)
  await snap(page, 'book-4')
  await page.evaluate(() => document.querySelector<HTMLInputElement>('input[type="checkbox"]')?.click())
  await sleep(200)
  await click(page, 'Confirm booking')
  await page.waitForFunction(() => /^\/bookings\/[0-9a-f-]{36}/.test(location.pathname), { timeout: 40_000 }).catch(() => undefined)
  await sleep(1500)
  await snap(page, 'booking')
  const bookingUrl = page.url()
  check('booking created through the wizard', /\/bookings\/[0-9a-f-]{36}/.test(bookingUrl), `${bookingUrl} :: ${(await text(page)).slice(0, 300)}`)
  const bookingText = await text(page)
  check('booking page shows code and status', /DW[A-Z0-9]{7}/.test(bookingText) && /Booked|booked/i.test(bookingText), bookingText.slice(0, 300))

  await page.goto(`${BASE}/bookings`, { waitUntil: 'networkidle2' })
  check('bookings list shows the booking', /DW[A-Z0-9]{7}|AC/i.test(await text(page)))

  // Help ticket.
  await page.goto(`${BASE}/help`, { waitUntil: 'networkidle2' })
  await snap(page, 'help')
  const ta = await page.$('textarea')
  if (ta) {
    await ta.type('AC booking ka time confirm karna hai please')
    await page.evaluate(() => [...document.querySelectorAll('form')].find((f) => f.querySelector('textarea'))?.requestSubmit())
    check('support ticket created', await waitText(page, /T[A-Z0-9]{6}/), (await text(page)).slice(0, 300))
  }

  // Logout.
  await page.goto(`${BASE}/account`, { waitUntil: 'networkidle2' })
  await click(page, 'Log out').catch(async () => click(page, 'Logout'))
  await page.waitForFunction(() => location.pathname.startsWith('/login'), { timeout: 20_000 }).catch(() => undefined)
  check('logout returns to login', page.url().includes('/login'), page.url())
  check('no client-side crashes', errors.length === 0, errors.join(' | '))

  // An imported customer sees their old booking.
  if (OLD_PHONE) {
    const p2 = await browser.newPage()
    await p2.setViewport({ width: 420, height: 900 })
    await login(p2, OLD_PHONE)
    check('imported customer goes straight in (already onboarded)', !p2.url().includes('/onboarding'), p2.url())
    await p2.goto(`${BASE}/bookings`, { waitUntil: 'networkidle2' })
    await click(p2, 'Past').catch(() => undefined)
    await sleep(800)
    await snap(p2, 'old-bookings')
    const t = await text(p2)
    check('imported booking visible', t.includes('Puncture') || t.includes('DWNR47S97'), t.slice(0, 300))
  }
} catch (err) {
  check('harness crashed', false, String((err as Error)?.stack ?? err))
} finally {
  await browser.close()
  const passed = results.filter((r) => r.ok).length
  console.log(JSON.stringify({ passed, failed: results.length - passed, results }, null, 1))
}
