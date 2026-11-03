/// <reference types="@cloudflare/workers-types" />

import { SITE_URL, getSeoMeta, type SeoMeta } from "../src/lib/seo";

// Matches join codes minted by generateJoinCode() in
// core/src/controllers/space-controller.ts: 5 chars from a fixed,
// confusable-character-free alphabet.
const ROOM_CODE_PATTERN = /^\/[ABCDEFGHJKMNPRTUWXY234579]{5}$/i;

// The app's other routes (see src/App.tsx). Any other path that isn't a file,
// marketing page, or room link gets a real 404, so search engines don't index
// it as a copy of the site.
const APP_PATH_PATTERN =
  /^\/(?:dashboard(?:\/.*)?|share\/[^/]+|sso-callback|meeting-ended)\/?$/;

const MEETING_OG_TITLE = "Ready for the recording?";
const MEETING_OG_DESCRIPTION =
  "You've been invited to a recording on Openside. Join the call.";
const MEETING_OG_IMAGE_PATH = "/img/og-meeting.png";

class MetaContentRewriter implements HTMLRewriterElementContentHandlers {
  constructor(private readonly content: string) {}
  element(element: Element) {
    element.setAttribute("content", this.content);
  }
}

class TitleTextRewriter implements HTMLRewriterElementContentHandlers {
  constructor(private readonly newTitle: string) {}
  element(element: Element) {
    element.setInnerContent(this.newTitle);
  }
}

class AttributeRewriter implements HTMLRewriterElementContentHandlers {
  constructor(
    private readonly name: string,
    private readonly value: string
  ) {}
  element(element: Element) {
    element.setAttribute(this.name, this.value);
  }
}

// Gives each marketing page its own title, description, and canonical URL in
// the served HTML, so crawlers see them without running the app.
function rewriteMarketingHead(
  response: Response,
  pathname: string,
  seo: SeoMeta
): Response {
  const canonicalUrl = `${SITE_URL}${pathname === "/" ? "/" : pathname.replace(/\/+$/, "")}`;
  return new HTMLRewriter()
    .on("title", new TitleTextRewriter(seo.title))
    .on('meta[name="description"]', new MetaContentRewriter(seo.description))
    .on('link[rel="canonical"]', new AttributeRewriter("href", canonicalUrl))
    .on('meta[property="og:title"]', new MetaContentRewriter(seo.title))
    .on('meta[property="og:description"]', new MetaContentRewriter(seo.description))
    .on('meta[property="og:url"]', new MetaContentRewriter(canonicalUrl))
    .on('meta[name="twitter:title"]', new MetaContentRewriter(seo.title))
    .on('meta[name="twitter:description"]', new MetaContentRewriter(seo.description))
    .transform(response);
}

interface Env {
  ASSETS: Fetcher;
}

// Where scripts/prerender.mjs writes each marketing page's rendered HTML.
const PRERENDER_DIR = "/_pages/";

// Serves the prerendered HTML for a marketing page. Without a build (vite dev)
// the asset is missing and this falls back to the app shell.
function fetchMarketingPage(request: Request, url: URL, env: Env) {
  const path = url.pathname.replace(/\/+$/, "");
  const name = path === "" ? "home" : path.slice(1);
  return env.ASSETS.fetch(
    new Request(new URL(`${PRERENDER_DIR}${name}`, url), request)
  );
}

// Rooms, share links, and the dashboard belong to their users, so search
// engines are told not to list them. Link previews still use their OG tags.
function withNoindex(response: Response) {
  const marked = new Response(response.body, response);
  marked.headers.set("x-robots-tag", "noindex");
  return marked;
}

// A 404 that still boots the app, which sends the visitor on from there. The
// shell is fetched fresh so a conditional request can't turn it into a 304.
async function notFound(url: URL, env: Env) {
  const shell = await env.ASSETS.fetch(new URL("/", url));
  return new Response(shell.body, {
    status: 404,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "x-robots-tag": "noindex",
    },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // The prerendered pages are only reachable through their real paths.
    if (url.pathname.startsWith(PRERENDER_DIR)) {
      return notFound(url, env);
    }

    const seo = getSeoMeta(url.pathname);
    if (seo) {
      return rewriteMarketingHead(
        await fetchMarketingPage(request, url, env),
        url.pathname,
        seo
      );
    }

    const assetResponse = await env.ASSETS.fetch(request);

    const contentType = assetResponse.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) {
      return assetResponse;
    }

    if (APP_PATH_PATTERN.test(url.pathname)) {
      return withNoindex(assetResponse);
    }

    if (!ROOM_CODE_PATTERN.test(url.pathname)) {
      return notFound(url, env);
    }

    const imageUrl = `${url.origin}${MEETING_OG_IMAGE_PATH}`;

    const roomResponse = new HTMLRewriter()
      .on("title", new TitleTextRewriter(MEETING_OG_TITLE))
      .on('meta[property="og:title"]', new MetaContentRewriter(MEETING_OG_TITLE))
      .on('meta[name="twitter:title"]', new MetaContentRewriter(MEETING_OG_TITLE))
      .on(
        'meta[property="og:image:alt"]',
        new MetaContentRewriter(MEETING_OG_TITLE)
      )
      .on('meta[name="description"]', new MetaContentRewriter(MEETING_OG_DESCRIPTION))
      .on(
        'meta[property="og:description"]',
        new MetaContentRewriter(MEETING_OG_DESCRIPTION)
      )
      .on(
        'meta[name="twitter:description"]',
        new MetaContentRewriter(MEETING_OG_DESCRIPTION)
      )
      .on('meta[property="og:image"]', new MetaContentRewriter(imageUrl))
      .on('meta[name="twitter:image"]', new MetaContentRewriter(imageUrl))
      .on('meta[property="og:url"]', new MetaContentRewriter(url.toString()))
      .transform(assetResponse);
    return withNoindex(roomResponse);
  },
} satisfies ExportedHandler<Env>;
