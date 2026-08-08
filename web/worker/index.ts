/// <reference types="@cloudflare/workers-types" />

// Matches join codes minted by generateJoinCode() in
// core/src/controllers/space-controller.ts: 5 chars from a fixed,
// confusable-character-free alphabet.
const ROOM_CODE_PATTERN = /^\/[ABCDEFGHJKMNPRTUWXY234579]{5}$/i;

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

interface Env {
  ASSETS: Fetcher;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const assetResponse = await env.ASSETS.fetch(request);

    if (!ROOM_CODE_PATTERN.test(url.pathname)) {
      return assetResponse;
    }

    const contentType = assetResponse.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) {
      return assetResponse;
    }

    const imageUrl = `${url.origin}${MEETING_OG_IMAGE_PATH}`;

    return new HTMLRewriter()
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
  },
} satisfies ExportedHandler<Env>;
