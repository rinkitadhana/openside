import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
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

createRoot(document.getElementById("root")!).render(
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
