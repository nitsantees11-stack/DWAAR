'use server'

import { fail, type ActionResult } from '@/lib/action-result'
import { isSupabase } from '@/lib/backend'
import { asAction, sb } from '@/lib/sb'
import { getCurrentUser } from '@/lib/app-auth'
import { getPayloadClient } from '@/lib/payload'
import { PROBLEM_VIDEO_MAX_BYTES, PROBLEM_VIDEO_MIME_TYPES } from '@/collections/ProblemVideos'

/**
 * Stores the customer's problem video before booking. The owner comes from the session,
 * never from the form; the type and size are checked here and again by the upload config.
 */
export async function uploadProblemVideo(form: FormData): Promise<ActionResult<{ id: string }>> {
  const user = await getCurrentUser()
  if (!user) return fail('auth')
  const file = form.get('video')
  // Multipart parts can arrive as Blob (not File) depending on the runtime decoder.
  if (!(file instanceof Blob) || file.size === 0) return fail('problem_video')
  const mimeType = file.type.split(';')[0].trim().toLowerCase()
  if (!PROBLEM_VIDEO_MIME_TYPES.includes(mimeType)) return fail('video_type')
  if (file.size > PROBLEM_VIDEO_MAX_BYTES) return fail('video_size')
  const rawDuration = Number(form.get('durationSec'))
  const durationSec = Number.isFinite(rawDuration) && rawDuration > 0 ? Math.min(600, Math.round(rawDuration)) : undefined
  if (isSupabase()) {
    const forward = new FormData()
    forward.set('video', new File([await file.arrayBuffer()], `problem.${mimeType === 'video/quicktime' ? 'mov' : mimeType.split('/')[1]}`, { type: mimeType }))
    if (durationSec) forward.set('durationSec', String(durationSec))
    return asAction(await sb('/c/problem-videos', { form: forward }), (x) => ({ id: String(x.id) }))
  }

  try {
    const payload = await getPayloadClient()
    const ext = mimeType === 'video/quicktime' ? 'mov' : mimeType.split('/')[1]
    const doc = await payload.create({
      collection: 'problem-videos',
      overrideAccess: true,
      depth: 0,
      data: { owner: user.id, durationSec },
      file: {
        data: Buffer.from(await file.arrayBuffer()),
        mimetype: mimeType,
        name: `problem-${user.id}-${Date.now()}.${ext}`,
        size: file.size,
      },
    })
    return { ok: true, id: doc.id }
  } catch {
    return fail('video_upload')
  }
}
