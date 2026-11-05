import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { langOf, requireUser } from '@/lib/app-auth'
import { OnboardingForm } from './OnboardingForm'

export const metadata: Metadata = { title: 'Welcome' }

export default async function OnboardingPage() {
  const user = await requireUser()
  if (user.onboarded && user.name) redirect('/')
  return <OnboardingForm initialLang={langOf(user)} initialName={user.name ?? ''} phone={user.username} />
}
