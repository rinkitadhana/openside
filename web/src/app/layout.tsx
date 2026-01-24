import type { Metadata } from "next";
import "@/styles/globals.css";
import { ThemeProvider } from "@/components/shared/ThemeProvider";
import { QueryProvider } from "@/utils/QueryProvider";

export const metadata: Metadata = {
  title: "Asap",
  description: "Real-time collaboration platform",
  icons: {
    icon: [
      { url: "/icon/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/icon/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/icon/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: {
      url: "/icon/apple-touch-icon.png",
      sizes: "180x180",
      type: "image/png",
    },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem
          disableTransitionOnChange
        >
          <QueryProvider>{children}</QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
