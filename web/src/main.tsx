import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import ErrorBoundary from "@/components/shared/ErrorBoundary";
import { AppProviders } from "@/components/shared/AppProviders";
import { installMediaTracker } from "@/lib/mediaTracker";
import "@livekit/components-styles";
import "@/styles/globals.css";

// Track every camera/mic/screen track the app (and LiveKit) acquires so we can
// force-release the devices on leave. Must run before any getUserMedia call.
installMediaTracker();

const app = (
  <StrictMode>
    <ErrorBoundary>
      <AppProviders>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AppProviders>
    </ErrorBoundary>
  </StrictMode>
);

// Marketing pages arrive prerendered (scripts/prerender.mjs), so take over
// that HTML instead of redrawing it. Every other page gets an empty root.
const container = document.getElementById("root")!;
if (container.hasChildNodes()) {
  hydrateRoot(container, app);
} else {
  createRoot(container).render(app);
}
