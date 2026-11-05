import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { Logo } from '@/components/Logo'
import { ui } from '@/components/ui'
import { getBusinessConfig } from '@/lib/catalog'
import { LEGAL_DOCS } from './content'

type Props = { params: Promise<{ doc: string }> }

export const dynamicParams = false

export function generateStaticParams() {
  return Object.keys(LEGAL_DOCS).map((doc) => ({ doc }))
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { doc } = await params
  const entry = LEGAL_DOCS[doc as keyof typeof LEGAL_DOCS]
  return entry ? { title: entry.title } : {}
}

export default async function LegalPage({ params }: Props) {
  const { doc } = await params
  const entry = LEGAL_DOCS[doc as keyof typeof LEGAL_DOCS]
  if (!entry) notFound()
  const support = (await getBusinessConfig()).support ?? {}

  return (
    <div className="min-h-dvh">
      <header className="border-b border-line bg-surface">
        <div className={`${ui.narrow} flex h-16 items-center justify-between`}>
          <Link href="/" aria-label="dwaar">
            <Logo />
          </Link>
          <Link href="/" className="inline-flex items-center gap-1.5 text-[13px] font-bold text-muted hover:text-ink">
            <ArrowLeft className="h-4 w-4" />
            dwaar
          </Link>
        </div>
      </header>
      <article className={`${ui.narrow} py-10`}>
        <p className={ui.eyebrow}>Updated {entry.updated}</p>
        <h1 className={`${ui.h1} mt-2`}>{entry.title}</h1>
        <p className="mt-4 text-[17px] leading-relaxed text-ink-2">{entry.intro}</p>
        <div className="mt-10 space-y-8">
          {entry.sections.map((section) => (
            <section key={section.heading}>
              <h2 className="text-[19px] font-bold">{section.heading}</h2>
              <div className="mt-2 space-y-3 text-[15px] leading-relaxed text-ink-2">
                {section.body.map((p) => (
                  <p key={p}>{p}</p>
                ))}
              </div>
            </section>
          ))}
        </div>
        <div className={`${ui.card} mt-12 p-5 text-[14px]`}>
          <p className="font-bold">Contact</p>
          <p className="mt-1 text-ink-2">
            {[support.email, support.phone].filter(Boolean).join(' · ')}
            {support.hours ? ` — ${support.hours}` : ''}
          </p>
        </div>
        <nav className="mt-8 flex flex-wrap gap-2">
          {Object.entries(LEGAL_DOCS)
            .filter(([key]) => key !== doc)
            .map(([key, d]) => (
              <Link key={key} href={`/legal/${key}`} className={`${ui.chip} hover:ring-ink/30`}>
                {d.title}
              </Link>
            ))}
        </nav>
      </article>
    </div>
  )
}
