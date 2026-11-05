import path from 'path'
import { buildFigmaConfig } from '@payloadcms/figma'
import { mcpPlugin } from '@payloadcms/plugin-mcp'
import { en as adminLanguage } from '@payloadcms/translations/languages/en'
import { fileURLToPath } from 'url'
import { Admins } from './collections/Admins'
import { Media } from './collections/Media'
import { Folders } from './collections/Folders'
import { Tags } from './collections/Tags'
import { Users } from './collections/Users'
import { OtpChallenges } from './collections/OtpChallenges'
import { Addresses } from './collections/Addresses'
import { ServiceCategories } from './collections/ServiceCategories'
import { Services } from './collections/Services'
import { DeviceModels } from './collections/DeviceModels'
import { Promotions } from './collections/Promotions'
import { Bookings } from './collections/Bookings'
import { BookingEvents } from './collections/BookingEvents'
import { Warranties } from './collections/Warranties'
import { SupportTickets } from './collections/SupportTickets'
import { Waitlist } from './collections/Waitlist'
import { Partners } from './collections/Partners'
import { PartnerDocuments } from './collections/PartnerDocuments'
import { JobOffers } from './collections/JobOffers'
import { PartnerLocations } from './collections/PartnerLocations'
import { JobMedia } from './collections/JobMedia'
import { EarningsLedger } from './collections/EarningsLedger'
import { Payouts } from './collections/Payouts'
import { PartnerTickets } from './collections/PartnerTickets'
import { SkillTests } from './collections/SkillTests'
import { IdempotencyKeys } from './collections/IdempotencyKeys'
import { ProblemVideos } from './collections/ProblemVideos'
import { BusinessConfig } from './globals/BusinessConfig'
import { partnerEndpoints } from './partner-api'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

export default buildFigmaConfig({
  admin: {
    user: Admins.slug,
    constrainWidth: true,
    dashboard: {
      widgets: [],
      defaultLayout: [
        { widgetSlug: 'activity', width: 'full' },
        { widgetSlug: 'collections', width: 'full' },
      ],
    },
    importMap: {
      baseDir: path.resolve(dirname),
    },
  },
  i18n: {
    fallbackLanguage: 'en',
    supportedLanguages: { 'en': adminLanguage },
  },
  collections: [
    ServiceCategories,
    Services,
    DeviceModels,
    Promotions,
    Bookings,
    BookingEvents,
    ProblemVideos,
    Warranties,
    SupportTickets,
    Users,
    Addresses,
    Waitlist,
    Partners,
    PartnerDocuments,
    JobOffers,
    PartnerLocations,
    JobMedia,
    EarningsLedger,
    Payouts,
    PartnerTickets,
    SkillTests,
    OtpChallenges,
    IdempotencyKeys,
    Admins,
    Media,
    Folders,
    Tags,
  ],
  globals: [BusinessConfig],
  // dwaar Partner API (served at /api/partner/v1/*); see src/partner-api.
  endpoints: partnerEndpoints,
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  localization: {
    locales: [{ code: 'en', label: 'English' }],
    fallback: true,
    defaultLocale: 'en',
  },
  plugins: [mcpPlugin({})],
  figma: {},
})
