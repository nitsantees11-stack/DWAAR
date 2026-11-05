import type { Metadata } from 'next'
import { getCategories } from '@/lib/catalog'
import { asMedia } from '@/lib/media'
import { LoginScreen } from './LoginScreen'

export const metadata: Metadata = { title: 'Login' }

/** Static entry screen; the OTP flow runs in the client component via server actions. */
export default async function LoginPage() {
  const categories = await getCategories()
  const tiles = categories
    .filter((c) => c.status === 'live')
    .map((c) => {
      const media = asMedia(c.heroImage)
      return { id: c.id, name: c.name, icon: c.icon, promise: c.promise?.value ?? '', image: media ? { url: media.url, alt: media.alt } : null }
    })
  return <LoginScreen tiles={tiles} />
}
