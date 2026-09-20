import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/components/common/Providers";
import { Toaster } from "@/components/ui/toaster";
import { PUBLIC_SITE_URL } from "@/lib/public-marketing";

const defaultTitle = "TaskwiseAI | Meeting Memory to Execution";
const defaultDescription =
  "Turn meeting transcripts into searchable memory, reviewed tasks, clear ownership, priorities, automations, and follow-through across your team.";

export const metadata: Metadata = {
  metadataBase: new URL(PUBLIC_SITE_URL),
  applicationName: "TaskwiseAI",
  title: {
    default: defaultTitle,
    template: "%s | TaskwiseAI",
  },
  description: defaultDescription,
  keywords: [
    "AI meeting assistant",
    "meeting notes to tasks",
    "meeting transcript chat",
    "AI task management",
    "meeting workflow automation",
    "Fathom tasks",
    "Fireflies tasks",
    "tl;dv tasks",
    "Otter action items",
  ],
  alternates: {
    canonical: "/",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  openGraph: {
    title: defaultTitle,
    description: defaultDescription,
    url: PUBLIC_SITE_URL,
    siteName: "TaskwiseAI",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: defaultTitle,
    description: defaultDescription,
  },
  category: "productivity",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="font-body antialiased">
        <Providers>
          {children}
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
