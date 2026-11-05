import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'dwaar · Repair aapke darwaze par',
    short_name: 'dwaar',
    description: 'Mobile, AC aur bike repair — pickup, doorstep aur roadside.',
    start_url: '/',
    display: 'standalone',
    background_color: '#f5f4f0',
    theme_color: '#f5f4f0',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
