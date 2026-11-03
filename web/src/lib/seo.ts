// Per-page SEO metadata for the public marketing pages. Plain data with no
// React imports: the Cloudflare worker reads it to rewrite the HTML <head> for
// crawlers, and the pages read it to keep the head in sync after navigation.

export const SITE_URL = "https://openside.pro";

export interface SeoMeta {
  /** Short page name, used in breadcrumbs. */
  name: string;
  title: string;
  description: string;
}

export const SEO_PAGES: Record<string, SeoMeta> = {
  "/": {
    name: "Home",
    title: "Openside: Open-source alternative to Riverside and Loom",
    description:
      "Record studio-quality podcasts, interviews, and calls right from your browser. Separate tracks for every guest, a built-in screen recorder, and free self-hosting.",
  },
  "/features": {
    name: "Features",
    title:
      "Features: Local recording, separate tracks, screen recorder | Openside",
    description:
      "Record up to 4K video and 48kHz audio locally in the browser, get a separate track for every participant, record your screen, and share with a link.",
  },
  "/use-cases": {
    name: "Use cases",
    title: "Use cases: Podcasts, interviews, demos, and meetings | Openside",
    description:
      "See how creators and teams use Openside for remote podcasts, video interviews, product demos, client calls, bug reports, team meetings, and testimonials.",
  },
  "/open-source": {
    name: "Open source",
    title: "Open-source recording studio you can self-host | Openside",
    description:
      "Openside is MIT licensed. Self-host it on your own LiveKit and Cloudflare R2, keep recordings on infrastructure you control, and audit every line of code.",
  },
  "/pricing": {
    name: "Pricing",
    title: "Pricing: Free demo, Pro at $8.99/mo, or self-host free | Openside",
    description:
      "Try Openside free, upgrade to Pro for managed 4K recording at $8.99 a month, or self-host it for free with unlimited recording on your own keys.",
  },
  "/privacy": {
    name: "Privacy Policy",
    title: "Privacy Policy | Openside",
    description: "How Openside collects, uses, and protects your data.",
  },
  "/terms": {
    name: "Terms of Service",
    title: "Terms of Service | Openside",
    description: "The terms for using the hosted Openside service.",
  },
};

/** "/pricing/" → "/pricing", so both spellings find the same page. */
const normalizePath = (pathname: string) =>
  pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;

export function getSeoMeta(pathname: string): SeoMeta | undefined {
  return SEO_PAGES[normalizePath(pathname)];
}

const ORGANIZATION_ID = `${SITE_URL}/#organization`;

// Schema.org data shared by every page: who publishes the site, and the site
// itself (Google uses its name as the site name in results).
const SITE_GRAPH = [
  {
    "@type": "Organization",
    "@id": ORGANIZATION_ID,
    name: "Openside",
    url: `${SITE_URL}/`,
    logo: `${SITE_URL}/apple-touch-icon.png`,
    sameAs: [
      "https://github.com/rinkitadhana/openside",
      "https://x.com/damngruz",
    ],
  },
  {
    "@type": "WebSite",
    "@id": `${SITE_URL}/#website`,
    name: "Openside",
    url: `${SITE_URL}/`,
    publisher: { "@id": ORGANIZATION_ID },
  },
];

// The product with its pricing, shown on the home page.
const SOFTWARE_APPLICATION = {
  "@type": "SoftwareApplication",
  name: "Openside",
  url: `${SITE_URL}/`,
  applicationCategory: "MultimediaApplication",
  operatingSystem: "Web",
  description:
    "Open-source, self-hostable recording studio for podcasts, interviews, and calls, with a built-in screen recorder.",
  publisher: { "@id": ORGANIZATION_ID },
  offers: [
    { "@type": "Offer", name: "Demo", price: "0", priceCurrency: "USD" },
    {
      "@type": "Offer",
      name: "Pro",
      price: "8.99",
      priceCurrency: "USD",
      priceSpecification: {
        "@type": "UnitPriceSpecification",
        price: "8.99",
        priceCurrency: "USD",
        billingDuration: "P1M",
      },
    },
    { "@type": "Offer", name: "Self-host", price: "0", priceCurrency: "USD" },
  ],
};

/**
 * Schema.org JSON-LD for a marketing page: the site and publisher everywhere,
 * the app and its pricing on the home page, and a breadcrumb on the rest.
 */
export function getStructuredData(pathname: string) {
  const path = normalizePath(pathname);
  const meta = SEO_PAGES[path];
  if (!meta) return undefined;

  const pageGraph =
    path === "/"
      ? [SOFTWARE_APPLICATION]
      : [
          {
            "@type": "BreadcrumbList",
            itemListElement: [
              {
                "@type": "ListItem",
                position: 1,
                name: "Home",
                item: `${SITE_URL}/`,
              },
              {
                "@type": "ListItem",
                position: 2,
                name: meta.name,
                item: `${SITE_URL}${path}`,
              },
            ],
          },
        ];

  return {
    "@context": "https://schema.org",
    "@graph": [...SITE_GRAPH, ...pageGraph],
  };
}
