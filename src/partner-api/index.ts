import type { Endpoint } from 'payload'
import { authEndpoints } from './auth'
import { categoryEndpoints } from './categories'
import { fileEndpoints } from './files'
import { preflightFor, route } from './http'
import { jobEndpoints } from './jobs'
import { liveEndpoints } from './live'
import { meEndpoints } from './me'
import { moneyEndpoints } from './money'
import { supportEndpoints } from './support'

/** Connection check for the Partner app: valid URL + app key, no partner token needed. */
const healthEndpoint = route('get', 'health', { auth: false }, async () => ({
  body: { service: 'dwaar-partner-api', version: 'v1', serverTime: new Date().toISOString() },
}))

const routes: Endpoint[] = [
  healthEndpoint,
  ...authEndpoints,
  ...categoryEndpoints,
  ...meEndpoints,
  ...liveEndpoints,
  ...jobEndpoints,
  ...moneyEndpoints,
  ...supportEndpoints,
  ...fileEndpoints,
]

/** dwaar Partner API, served by Payload at /api/partner/v1/*. */
export const partnerEndpoints: Endpoint[] = [...routes, ...preflightFor(routes)]
