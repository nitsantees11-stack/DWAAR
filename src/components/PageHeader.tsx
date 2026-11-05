import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { ui } from './ui'

export function PageHeader({
  title,
  subtitle,
  back,
  action,
}: {
  title: string
  subtitle?: string
  back?: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-3 pb-6 pt-6 md:pt-10">
      {back && (
        <Link
          href={back}
          aria-label="Back"
          className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-full bg-surface ring-1 ring-line transition hover:ring-ink/30"
        >
          <ArrowLeft className="h-[18px] w-[18px]" />
        </Link>
      )}
      <div className="min-w-0 flex-1">
        <h1 className={ui.h2}>{title}</h1>
        {subtitle && <p className="mt-1 text-[14px] text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}
