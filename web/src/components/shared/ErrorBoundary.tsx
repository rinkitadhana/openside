import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

// Key used to ensure we only auto-reload once per error, so a genuinely broken
// render doesn't trap the user in an infinite reload loop.
const RELOAD_FLAG = "openside:error-reloaded";

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidMount() {
    // We rendered successfully, so any earlier error is resolved. Reset the
    // guard so a future transient error can auto-reload once again.
    if (!this.state.hasError) {
      sessionStorage.removeItem(RELOAD_FLAG);
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary] Uncaught render error:", error, info);

    // A transient error (failed chunk fetch, race on cold load, etc.) usually
    // resolves on a fresh load. Auto-reload once; if it errors again we show
    // the fallback instead of looping.
    const alreadyReloaded = sessionStorage.getItem(RELOAD_FLAG) === "1";
    if (!alreadyReloaded) {
      sessionStorage.setItem(RELOAD_FLAG, "1");
      window.location.reload();
    }
  }

  private handleReload = () => {
    sessionStorage.removeItem(RELOAD_FLAG);
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen w-full flex-col items-center justify-center gap-4 bg-background p-6 text-center">
          <h1 className="text-xl font-semibold text-foreground">
            Something went wrong
          </h1>
          <p className="max-w-md text-sm text-foreground/60">
            The app hit an unexpected error. Reloading usually fixes it.
          </p>
          <button
            type="button"
            onClick={this.handleReload}
            className="rounded-xl border border-border bg-secondary px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-primary-hover"
          >
            Reload
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
