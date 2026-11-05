'use client'

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { useI18n } from './I18nProvider'
import { haptic } from './AppPrefs'
import { cx, ui } from './ui'

export function CopyButton({ value, className }: { value: string; className?: string }) {
  const { t } = useI18n()
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className={cx(ui.btnSm, ui.secondary, className)}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
          haptic()
          setCopied(true)
          setTimeout(() => setCopied(false), 1600)
        } catch {
          setCopied(false)
        }
      }}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? t('common.copied') : t('common.copy')}
    </button>
  )
}
