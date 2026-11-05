'use client'

import { useEffect } from 'react'
import { intlLocale, type Lang } from '@/lib/i18n'

let hapticsEnabled = true

/** Short vibration on supported phones when the user has haptics switched on. */
export function haptic(pattern: number | number[] = 12) {
  if (!hapticsEnabled || typeof navigator === 'undefined' || !('vibrate' in navigator)) return
  try {
    navigator.vibrate(pattern)
  } catch {
    // Some browsers throw outside a user gesture; feedback is best-effort.
  }
}

/** Applies the signed-in user's app preferences to the document. */
export function AppPrefs({ lang, reduceMotion, haptics }: { lang: Lang; reduceMotion: boolean; haptics: boolean }) {
  useEffect(() => {
    const root = document.documentElement
    root.lang = intlLocale(lang)
    root.dataset.reduceMotion = reduceMotion ? 'true' : 'false'
    hapticsEnabled = haptics
  }, [lang, reduceMotion, haptics])
  return null
}
