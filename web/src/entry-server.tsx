// Build-time renderer for the marketing pages (see scripts/prerender.mjs).
// Mirrors the tree in main.tsx so the client can hydrate the HTML it produces.

import { StrictMode } from "react";
import { prerender } from "react-dom/static";
import { StaticRouter } from "react-router-dom";
import App from "./App";
import ErrorBoundary from "@/components/shared/ErrorBoundary";
import { AppProviders } from "@/components/shared/AppProviders";

export { SEO_PAGES } from "@/lib/seo";

/** Renders `url` to HTML, waiting for its lazily loaded page to resolve. */
export async function render(url: string): Promise<string> {
  const { prelude } = await prerender(
    <StrictMode>
      <ErrorBoundary>
        <AppProviders>
          <StaticRouter location={url}>
            <App />
          </StaticRouter>
        </AppProviders>
      </ErrorBoundary>
    </StrictMode>,
  );

  return new Response(prelude).text();
}
