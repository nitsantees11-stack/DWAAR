import type { Access, FieldAccess, PayloadRequest } from 'payload'

/** CMS editors sign in through the `admins` collection (Figma SSO). */
export const isAdminReq = (req: PayloadRequest) => req.user?.collection === 'admins'

/** Public app accounts live in `users`; never confuse them with CMS admins. */
export const isAppUserReq = (req: PayloadRequest) => req.user?.collection === 'users'

export const adminOnly: Access = ({ req }) => isAdminReq(req)

export const adminOnlyField: FieldAccess = ({ req }) => isAdminReq(req)

export const publicRead: Access = () => true

/** Admins see everything; app users only see their own record in `users`. */
export const selfOrAdmin: Access = ({ req }) => {
  if (isAdminReq(req)) return true
  if (isAppUserReq(req) && req.user) return { id: { equals: req.user.id } }
  return false
}

/** Row-level ownership for user-owned records. */
export const ownerOrAdmin =
  (field: string): Access =>
  ({ req }) => {
    if (isAdminReq(req)) return true
    if (isAppUserReq(req) && req.user) return { [field]: { equals: req.user.id } }
    return false
  }

export const appUserOrAdmin: Access = ({ req }) => isAdminReq(req) || isAppUserReq(req)

/** Partner accounts (technicians, mechanics, riders, hub technicians) live in `partners`. */
export const isPartnerReq = (req: PayloadRequest) => req.user?.collection === 'partners'

/**
 * Partner reads/writes are only honoured when they come through the validated partner API
 * (`/api/partner/v1`, which checks the app key and token and sets this context flag). A partner
 * token used against Payload's generic REST routes therefore sees nothing.
 */
export const isPartnerApiReq = (req: PayloadRequest) => isPartnerReq(req) && req.context?.partnerApi === true

/** Admins see all; a partner (through the partner API) sees only rows where `field` is them. */
export const partnerOwnerOrAdmin =
  (field: string): Access =>
  ({ req }) => {
    if (isAdminReq(req)) return true
    if (isPartnerApiReq(req) && req.user) return { [field]: { equals: req.user.id } }
    return false
  }
