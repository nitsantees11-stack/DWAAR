'use client'

import { Share2 } from 'lucide-react'
import { ui } from '@/components/ui'

/** Native share sheet where available, WhatsApp otherwise. */
export function ShareButton({ text, label }: { text: string; label: string }) {
  return (
    <button
      type="button"
      onClick={async () => {
        if (navigator.share) {
          try {
            await navigator.share({ text })
            return
          } catch {
            // Dismissed or unsupported; fall back to WhatsApp.
          }
        }
        window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener')
      }}
      className={`${ui.btnSm} bg-white/15 text-white ring-1 ring-white/30 hover:bg-white/25`}
    >
      <Share2 className="h-3.5 w-3.5" />
      {label}
    </button>
  )
}
