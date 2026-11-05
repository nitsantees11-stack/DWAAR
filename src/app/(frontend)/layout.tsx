import React from "react"
import type { Metadata, Viewport } from "next"
import {
  Bricolage_Grotesque,
  JetBrains_Mono,
  Noto_Sans_Devanagari,
  Plus_Jakarta_Sans,
} from "next/font/google"
import Script from "next/script"
import { BodyCustomCode, renderHeadCustomCode } from "@/lib/make-custom-code"
import {
  makeSiteSettings,
  sanitizeHtmlAttribute,
} from "@/lib/make-site-settings"
import "./styles.css"

const display = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-bricolage",
  display: "swap",
})
const sans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-jakarta",
  display: "swap",
})
const devanagari = Noto_Sans_Devanagari({
  subsets: ["devanagari"],
  variable: "--font-devanagari",
  display: "swap",
  preload: false,
})
const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
})

const defaultTitle = "dwaar"
const title = makeSiteSettings.title ?? defaultTitle
const description =
  makeSiteSettings.description ??
  "Mobile, AC aur bike repair — pickup, doorstep aur roadside."
const favicon = makeSiteSettings.icons?.icon
const socialImage = makeSiteSettings.openGraph?.image
const googleAnalyticsId = sanitizeHtmlAttribute(
  makeSiteSettings.analytics?.googleAnalyticsId,
)

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000",
  ),
  title: { default: title, template: "%s · dwaar" },
  description,
  applicationName: "dwaar",
  appleWebApp: { capable: true, title: "dwaar", statusBarStyle: "default" },
  robots:
    makeSiteSettings.robots?.index === false
      ? { follow: false, index: false }
      : undefined,
  icons: {
    icon: favicon ?? "/favicon.svg",
    apple: "/icons/apple-touch-icon.png",
  },
  openGraph: {
    title,
    description,
    images: socialImage ? [socialImage] : undefined,
  },
  twitter: socialImage
    ? {
        card: "summary_large_image",
        images: [socialImage],
      }
    : undefined,
}

export const viewport: Viewport = {
  themeColor: "#f5f4f0",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const language = sanitizeHtmlAttribute(makeSiteSettings.language) || "en"
  const addBypassLinks = makeSiteSettings.accessibility?.addBypassLinks === true
  const customScripts = makeSiteSettings.customScripts

  return (
    <html
      lang={language}
      data-scroll-behavior="smooth"
      className={`${display.variable} ${sans.variable} ${devanagari.variable} ${mono.variable}`}
    >
      <head>
        {renderHeadCustomCode(customScripts?.headStart, "head-start")}
        {renderHeadCustomCode(customScripts?.headEnd, "head-end")}
      </head>
      <body className="min-h-dvh bg-canvas font-sans text-ink antialiased">
        <BodyCustomCode html={customScripts?.bodyStart} />
        {addBypassLinks && (
          <a className="figma-bypass-link" href="#root">
            Skip to content
          </a>
        )}
        <div id="root" tabIndex={-1}>
          {children}
        </div>
        {googleAnalyticsId && (
          <>
            <Script
              src={`https://www.googletagmanager.com/gtag/js?id=${googleAnalyticsId}`}
              strategy="afterInteractive"
            />
            <Script id="figma-google-analytics" strategy="afterInteractive">
              {`
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', ${JSON.stringify(googleAnalyticsId)});
`}
            </Script>
          </>
        )}
        <BodyCustomCode html={customScripts?.bodyEnd} />
      </body>
    </html>
  )
}
