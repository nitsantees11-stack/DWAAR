export type ActionParams = Record<string, string | number>

export type ActionFailure = {
  ok: false
  /** Maps to an `err.<code>` dictionary key on the client. */
  error: string
  params?: ActionParams
  field?: string
}

export type ActionResult<T extends object = object> = ({ ok: true } & T) | ActionFailure

export function fail(error: string, params?: ActionParams, field?: string): ActionFailure {
  return { ok: false, error, ...(params ? { params } : {}), ...(field ? { field } : {}) }
}
