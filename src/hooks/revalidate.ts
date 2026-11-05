import { revalidateTag } from 'next/cache'
import type { CollectionAfterChangeHook, CollectionAfterDeleteHook, GlobalAfterChangeHook } from 'payload'

export const CATALOG_TAG = 'catalog'

/**
 * Expire the cached catalog immediately so the very next request sees an admin edit.
 * Outside a Next.js request (CLI seeding) there is no cache store, so this is a no-op.
 */
export function expireCatalog() {
  try {
    revalidateTag(CATALOG_TAG, { expire: 0 })
  } catch {
    // No incremental cache available (e.g. Payload CLI). Nothing to invalidate.
  }
}

export const catalogAfterChange: CollectionAfterChangeHook = ({ doc }) => {
  expireCatalog()
  return doc
}

export const catalogAfterDelete: CollectionAfterDeleteHook = ({ doc }) => {
  expireCatalog()
  return doc
}

export const catalogGlobalAfterChange: GlobalAfterChangeHook = ({ doc }) => {
  expireCatalog()
  return doc
}
