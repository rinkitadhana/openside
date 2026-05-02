import { ClerkProvider } from "@clerk/clerk-react";
import { ThemeProvider } from "@/components/shared/ThemeProvider";
import ClerkTokenSync from "@/components/shared/ClerkTokenSync";
import { QueryProvider } from "@/utils/QueryProvider";
import { Toaster } from "react-hot-toast";

const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

export function AppProviders({ children }: { children: React.ReactNode }) {
  if (!clerkPublishableKey) {
    return (
      <div className="min-h-screen w-full bg-background text-foreground flex items-center justify-center p-6">
        <div className="max-w-2xl w-full border border-primary-border rounded-xl p-6 bg-secondary">
          <h1 className="text-xl font-semibold mb-3">Clerk setup required</h1>
          <p className="text-sm text-secondary-text mb-3">
            Add your Clerk publishable key to <code>shift/.env</code> and
            restart the dev server.
          </p>
          <pre className="text-xs bg-call-primary border border-call-border rounded-lg p-3 overflow-auto">
{`VITE_CLERK_PUBLISHABLE_KEY=pk_test_xxxxx
VITE_API_URL=http://localhost:4000/api
VITE_API_SOCKET_URL=http://localhost:4000`}
          </pre>
        </div>
      </div>
    );
  }

  return (
    <ClerkProvider publishableKey={clerkPublishableKey} afterSignOutUrl="/auth">
      <ThemeProvider
        attribute="class"
        defaultTheme="light"
        enableSystem
        disableTransitionOnChange
      >
        <QueryProvider>
          <ClerkTokenSync />
          {children}
          <Toaster
            position="top-center"
            toastOptions={{
              className:
                "border border-call-border bg-background text-foreground shadow-lg",
              duration: 4000,
            }}
          />
        </QueryProvider>
      </ThemeProvider>
    </ClerkProvider>
  );
}
