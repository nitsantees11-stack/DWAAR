'use client'

import { useEffect, useRef, useState } from 'react'
import { CircleAlert, CircleCheck, LoaderCircle, RotateCcw, Square, Upload, Video } from 'lucide-react'
import { uploadProblemVideo } from '../../../actions/problem-video'
import { useI18n } from '@/components/I18nProvider'
import { cx, ui } from '@/components/ui'
import { errorKey, type DictKey } from '@/lib/i18n'

export type ProblemVideoValue = { id: string; durationSec: number; previewUrl: string }

const MAX_RECORD_SEC = 30
const MAX_PICK_SEC = 60
const MAX_BYTES = 25 * 1024 * 1024

function pickMimeType() {
  if (typeof MediaRecorder === 'undefined') return ''
  const candidates = ['video/mp4;codecs=avc1,mp4a', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
  return candidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? ''
}

function readDuration(url: string) {
  return new Promise<number>((resolve) => {
    const el = document.createElement('video')
    el.preload = 'metadata'
    el.onloadedmetadata = () => resolve(Number.isFinite(el.duration) ? el.duration : 0)
    el.onerror = () => resolve(0)
    el.src = url
  })
}

/**
 * Records (or picks) a short video of the problem and uploads it straight away, so the
 * booking itself only carries the stored video's id.
 */
export function ProblemVideo({
  value,
  onChange,
  onBusy,
  required,
}: {
  value: ProblemVideoValue | null
  onChange: (value: ProblemVideoValue | null) => void
  onBusy: (busy: boolean) => void
  required: boolean
}) {
  const { t } = useI18n()
  const [mode, setMode] = useState<'idle' | 'recording' | 'uploading'>('idle')
  const [error, setError] = useState<DictKey | null>(null)
  const [errorParams, setErrorParams] = useState<Record<string, number>>({})
  const [left, setLeft] = useState(MAX_RECORD_SEC)
  const liveRef = useRef<HTMLVideoElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  function stopStream() {
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }

  useEffect(() => () => stopStream(), [])
  useEffect(() => onBusy(mode !== 'idle'), [mode, onBusy])

  function fail(key: DictKey, params: Record<string, number> = {}) {
    setError(key)
    setErrorParams(params)
    setMode('idle')
  }

  async function upload(blob: Blob, durationSec: number) {
    const type = (blob.type.split(';')[0] || 'video/webm').toLowerCase()
    if (blob.size > MAX_BYTES) return fail('err.video_size')
    setMode('uploading')
    const previewUrl = URL.createObjectURL(blob)
    const ext = type === 'video/quicktime' ? 'mov' : type.split('/')[1]
    const form = new FormData()
    form.set('video', new File([blob], `problem.${ext}`, { type }))
    form.set('durationSec', String(Math.round(durationSec)))
    try {
      const res = await uploadProblemVideo(form)
      if (!res.ok) {
        URL.revokeObjectURL(previewUrl)
        return fail(errorKey(res.error))
      }
      if (value) URL.revokeObjectURL(value.previewUrl)
      onChange({ id: res.id, durationSec: Math.round(durationSec), previewUrl })
      setMode('idle')
    } catch {
      URL.revokeObjectURL(previewUrl)
      fail('err.video_upload')
    }
  }

  async function startRecording() {
    setError(null)
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') return fail('book.videoNoCamera')
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: true,
      })
    } catch {
      return fail('book.videoNoCamera')
    }
    streamRef.current = stream
    const mimeType = pickMimeType()
    // A modest bitrate keeps a 30-second clip around 6 MB on mobile data.
    const recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: 1_500_000, audioBitsPerSecond: 64_000 })
    recorderRef.current = recorder
    const chunks: Blob[] = []
    const startedAt = Date.now()
    recorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data)
    recorder.onstop = () => {
      const seconds = (Date.now() - startedAt) / 1000
      stopStream()
      const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || 'video/webm' })
      if (blob.size === 0) return fail('err.video_upload')
      void upload(blob, seconds)
    }
    setLeft(MAX_RECORD_SEC)
    setMode('recording')
    recorder.start(1000)
    timerRef.current = setInterval(() => {
      const remaining = MAX_RECORD_SEC - Math.floor((Date.now() - startedAt) / 1000)
      setLeft(Math.max(0, remaining))
      if (remaining <= 0 && recorder.state === 'recording') recorder.stop()
    }, 250)
  }

  useEffect(() => {
    if (mode === 'recording' && liveRef.current && streamRef.current) {
      liveRef.current.srcObject = streamRef.current
      void liveRef.current.play().catch(() => undefined)
    }
  }, [mode])

  function stopRecording() {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
  }

  async function onPick(file: File | undefined) {
    if (fileRef.current) fileRef.current.value = ''
    if (!file) return
    setError(null)
    if (!file.type.startsWith('video/')) return fail('err.video_type')
    if (file.size > MAX_BYTES) return fail('err.video_size')
    const url = URL.createObjectURL(file)
    const seconds = await readDuration(url)
    URL.revokeObjectURL(url)
    if (seconds > MAX_PICK_SEC) return fail('book.videoTooLong', { sec: MAX_PICK_SEC })
    await upload(file, seconds)
  }

  return (
    <div className={cx(ui.card, 'p-5')}>
      <div className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-(--accent-soft) text-(--accent)">
          <Video className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-[16px] font-bold">
            {t('book.videoTitle')}
            {required && <span className="rounded-full bg-ink px-2 py-0.5 text-[11px] font-bold text-white">{t('book.videoRequired')}</span>}
          </p>
          <p className="mt-1 text-[13px] text-muted">{t('book.videoHint', { sec: MAX_RECORD_SEC })}</p>
        </div>
      </div>

      {mode === 'recording' && (
        <div className="relative mt-4 overflow-hidden rounded-2xl bg-ink">
          <video ref={liveRef} muted playsInline autoPlay className="aspect-video w-full object-cover" />
          <span className="absolute left-3 top-3 inline-flex items-center gap-2 rounded-full bg-black/60 px-3 py-1.5 text-[12px] font-bold text-white backdrop-blur">
            <span className="h-2 w-2 animate-pulse rounded-full bg-danger" />
            {t('book.videoRecording', { left })}
          </span>
          <div className="absolute inset-x-0 bottom-0 h-1 bg-white/20">
            <div className="h-full bg-danger transition-[width] duration-200" style={{ width: `${((MAX_RECORD_SEC - left) / MAX_RECORD_SEC) * 100}%` }} />
          </div>
        </div>
      )}

      {mode !== 'recording' && value && (
        <div className="mt-4 overflow-hidden rounded-2xl bg-ink">
          <video src={value.previewUrl} controls playsInline preload="metadata" className="aspect-video w-full object-contain" />
        </div>
      )}

      {mode === 'uploading' && (
        <p className="mt-3 flex items-center gap-2 text-[14px] font-semibold text-ink-2">
          <LoaderCircle className="h-4 w-4 animate-spin" />
          {t('book.videoUploading')}
        </p>
      )}
      {mode === 'idle' && value && (
        <p className="mt-3 flex items-center gap-2 text-[14px] font-bold text-success">
          <CircleCheck className="h-4 w-4" />
          {t('book.videoReady')}
        </p>
      )}
      {error && (
        <p className="mt-3 flex items-start gap-2 rounded-2xl bg-danger-soft p-3 text-[13px] font-semibold text-danger">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          {t(error, errorParams)}
        </p>
      )}

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {mode === 'recording' ? (
          <button type="button" onClick={stopRecording} className={cx(ui.btn, ui.danger, 'sm:col-span-2')}>
            <Square className="h-4 w-4 fill-current" />
            {t('book.videoStop')}
          </button>
        ) : (
          <>
            <button type="button" disabled={mode === 'uploading'} onClick={startRecording} className={cx(ui.btn, ui.accent)}>
              {value ? <RotateCcw className="h-4 w-4" /> : <Video className="h-4 w-4" />}
              {value ? t('book.videoRetake') : t('book.videoRecord')}
            </button>
            <button type="button" disabled={mode === 'uploading'} onClick={() => fileRef.current?.click()} className={cx(ui.btn, ui.secondary)}>
              <Upload className="h-4 w-4" />
              {t('book.videoPick')}
            </button>
          </>
        )}
      </div>
      <input ref={fileRef} type="file" accept="video/*" hidden onChange={(e) => onPick(e.target.files?.[0])} />
    </div>
  )
}
