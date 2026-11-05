import Link from 'next/link'
import { Logo } from '@/components/Logo'
import { ui } from '@/components/ui'
import { makeT } from '@/lib/i18n'

/** Rendered for unknown routes and when a page calls notFound(). */
export default function NotFound() {
  const t = makeT('hinglish')
  return (
    <main className="mx-auto flex min-h-[70dvh] max-w-md flex-col items-center justify-center px-6 py-16 text-center">
      <Logo />
      <p className="mt-10 font-display text-[96px] font-extrabold leading-none tracking-tight text-brand">404</p>
      <h1 className={`${ui.h2} mt-4`}>{t('notfound.title')}</h1>
      <p className="mt-2 text-muted">{t('notfound.body')}</p>
      <Link href="/" className={`${ui.btn} ${ui.primary} mt-8`}>
        {t('notfound.home')}
      </Link>
    </main>
  )
}
