import type { Metadata, Viewport } from "next";
import { Fraunces, Jost } from "next/font/google";
import { SITE } from "@/lib/content";
import "./globals.css";

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  weight: "variable",
  axes: ["opsz"],
});

const jost = Jost({
  subsets: ["latin"],
  variable: "--font-jost",
  weight: ["300", "400", "500", "600"],
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: {
    default: `${SITE.name} | Precision Wood Processing in Nigeria`,
    template: `%s | ${SITE.name}`,
  },
  description: SITE.description,
  alternates: { canonical: "/" },
  openGraph: {
    siteName: SITE.name,
    type: "website",
    locale: "en_NG",
    images: ["/images/hero.jpg"],
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE.name} | Precision Wood Processing in Nigeria`,
    description: SITE.description,
    images: ["/images/hero.jpg"],
  },
};

const BUSINESS_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "LocalBusiness",
  "@id": `${SITE.url}/#business`,
  name: SITE.name,
  alternateName: SITE.shortName,
  slogan: SITE.slogan,
  description: SITE.description,
  url: SITE.url,
  logo: `${SITE.url}/images/nightowl.png`,
  image: `${SITE.url}/images/hero.jpg`,
  telephone: "+2348084441277",
  email: SITE.email,
  address: { "@type": "PostalAddress", addressCountry: "NG" },
  areaServed: { "@type": "Country", name: "Nigeria" },
  founder: { "@type": "Person", name: "Asim Balarabe Yazid" },
  sameAs: [SITE.instagram, SITE.tiktok, SITE.pitchVideo],
  knowsAbout: [
    "precision wood cutting",
    "edge banding",
    "custom furniture fabrication",
    "kitchen cabinets",
    "MDF and plywood processing",
  ],
};

const WEBSITE_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: SITE.name,
  url: SITE.url,
  publisher: { "@id": `${SITE.url}/#business` },
};

export const viewport: Viewport = {
  themeColor: "#0c0a08",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${fraunces.variable} ${jost.variable}`}>
      <body className="grain min-h-screen">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(BUSINESS_JSON_LD) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(WEBSITE_JSON_LD) }}
        />
        {children}
      </body>
    </html>
  );
}
