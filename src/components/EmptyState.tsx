import type { LucideIcon } from 'lucide-react'
import { ui } from './ui'

export function EmptyState({
  Icon,
  title,
  body,
  action,
}: {
  Icon: LucideIcon
  title: string
  body?: string
  action?: React.ReactNode
}) {
  return (
    <div className={`${ui.card} flex flex-col items-center px-6 py-12 text-center`}>
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-line-2 text-ink-2">
        <Icon className="h-6 w-6" />
      </span>
      <p className="mt-4 text-[16px] font-bold">{title}</p>
      {body && <p className="mt-1 max-w-sm text-[14px] text-muted">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}
