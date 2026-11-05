export type LegalDoc = { title: string; updated: string; intro: string; sections: { heading: string; body: string[] }[] }

/** Fixed policy copy (not CMS-managed). Contact details are filled from the business config at render. */
export const LEGAL_DOCS: Record<'terms' | 'privacy' | 'refunds' | 'about', LegalDoc> = {
  terms: {
    title: 'Terms of service',
    updated: '4 November 2026',
    intro:
      'These terms govern your use of the dwaar app and the repair services booked through it. By creating an account you agree to them.',
    sections: [
      {
        heading: 'Your account',
        body: [
          'You sign in with an Indian mobile number verified by a one-time password. Keep your phone secure; anyone with access to it can sign in as you.',
          'Provide accurate names, addresses and device details. Partners rely on them to reach you and bring the right parts.',
        ],
      },
      {
        heading: 'Bookings and pricing',
        body: [
          'Prices shown before booking are estimates. For range-priced and tier-priced repairs, the final price is set after checkup and sent to the app as a quote.',
          'No additional work or part is charged without your approval in the app. Visit fees, night fees, cancellation fees and quote-decline fees are shown on each section page before you book.',
          'Coupons apply only when their conditions are met at the time of booking and cannot be exchanged for cash.',
        ],
      },
      {
        heading: 'Service OTP and handover',
        body: [
          'Share the Start OTP only with the assigned partner when they are physically present. Sharing it confirms that work may begin or that your device has been picked up.',
          'For pickup & drop repairs, remove your SIM and memory card before handover. Device condition is recorded with photos at pickup.',
        ],
      },
      {
        heading: 'Warranty',
        body: [
          'Warranties are issued only for repairs billed and approved in the app. Coverage periods are listed per section and service and appear on your warranty card.',
          'Warranty does not cover physical or liquid damage after the repair, or repairs opened by a third party.',
        ],
      },
      {
        heading: 'Conduct',
        body: ['Treat partners with respect. dwaar may suspend accounts involved in abuse, fraud or repeated no-shows.'],
      },
    ],
  },
  privacy: {
    title: 'Privacy policy',
    updated: '4 November 2026',
    intro: 'This policy explains what dwaar collects, why, and the choices you control in Settings.',
    sections: [
      {
        heading: 'What we collect',
        body: [
          'Account data: mobile number, name and, if you add them, gender, date of birth and an alternate WhatsApp number.',
          'Service data: addresses, device details, booking history, quotes, payments, ratings and support tickets.',
          'Location: GPS coordinates attached to an address only when "Share live location" is on in Settings > Privacy.',
        ],
      },
      {
        heading: 'How we use it',
        body: [
          'To assign partners, show prices, send booking updates through the channels you enable, issue warranties and resolve support requests.',
          'Partners see your name, address and a masked phone number only for the booking they are assigned to.',
        ],
      },
      {
        heading: 'Your choices',
        body: [
          'Notification channels, personalised offers, location sharing and analytics can be switched off at any time in Settings.',
          'You can delete your account from Settings > Delete account. Billing and warranty records are retained for 180 days to meet legal obligations, then removed.',
        ],
      },
      {
        heading: 'Security',
        body: ['One-time passwords are stored only as salted hashes and expire within five minutes. Sessions use secure, HTTP-only cookies.'],
      },
    ],
  },
  refunds: {
    title: 'Cancellation & refund policy',
    updated: '4 November 2026',
    intro: 'Plans change. Here is exactly what it costs to cancel, and how refunds work.',
    sections: [
      {
        heading: 'Cancelling a booking',
        body: [
          'Cancelling before a partner is assigned is always free.',
          'After a partner is assigned, a small cancellation fee may apply. The exact amount is shown on the section page and on your booking before you confirm the cancellation.',
        ],
      },
      {
        heading: 'Declining a quote',
        body: [
          'If you decline the quote after checkup, only the visit or checkup fee shown for that section is charged. For pickup & drop repairs your device is returned without repair.',
        ],
      },
      {
        heading: 'Refunds',
        body: [
          'Payments are taken after the job, for the approved amount only. If you are charged in error, raise a ticket from Help and the refund is processed to the original payment method within 5–7 working days.',
          'If we miss the promised time, dwaar Cash is credited to your wallet automatically and adjusted against your next bill.',
        ],
      },
    ],
  },
  about: {
    title: 'About dwaar',
    updated: '4 November 2026',
    intro:
      'dwaar means door. We bring verified repair partners to yours — for phones, air conditioners and two-wheelers today, with fridges and cars on the way.',
    sections: [
      {
        heading: 'How we work',
        body: [
          'Each vertical has its own flow: pickup and hub repair for phones, home visits for ACs, and on-the-spot SOS for bikes.',
          'Every job follows the same promise: price first, approval in the app, live status, and a digital warranty on the final bill.',
        ],
      },
      {
        heading: 'Where we are',
        body: ['We operate in a focused zone around our hub so partners reach you fast. New zones open as we grow.'],
      },
    ],
  },
}
