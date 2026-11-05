import type { CollectionConfig } from 'payload'

import { createFolderField, createTagField } from 'payload'
import { catalogAfterChange, catalogAfterDelete } from '../hooks/revalidate'

export const Media: CollectionConfig = {
  slug: 'media',
  access: {
    read: () => true,
  },
  // Category hero images are read through the cached catalog; replacing a file must refresh it.
  hooks: { afterChange: [catalogAfterChange], afterDelete: [catalogAfterDelete] },
  fields: [
    {
      name: 'alt',
      type: 'text',
      required: true,
    },
    createFolderField({ relationTo: 'folders' }),
    createTagField({ relationTo: 'tags' }),
  ],
  upload: {
    // Read access is public for every media file, so CDN caching is safe.
    modifyResponseHeaders: ({ headers }) => {
      headers.set('Cache-Control', 'public, max-age=3600, s-maxage=3600')
      return headers
    },
  },
}
