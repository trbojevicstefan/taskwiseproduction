
import type { Metadata } from 'next';
import './globals.css';
import { Providers } from '@/components/common/Providers';
import { Toaster } from "@/components/ui/toaster";

export const metadata: Metadata = {
  title: 'TaskwiseAI | Autonomous Meeting Execution',
  description:
    'Turn meetings into actionable plans in seconds with autonomous task auditing, meeting planning, people discovery, and Slack-ready updates.',
  metadataBase: new URL('https://www.taskwise.ai'),
  openGraph: {
    title: 'TaskwiseAI | Autonomous Meeting Execution',
    description:
      'Turn meetings into actionable plans in seconds with autonomous task auditing, meeting planning, people discovery, and Slack-ready updates.',
    url: 'https://www.taskwise.ai',
    siteName: 'TaskwiseAI',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'TaskwiseAI | Autonomous Meeting Execution',
    description:
      'Turn meetings into actionable plans in seconds with autonomous task auditing, meeting planning, people discovery, and Slack-ready updates.',
  },
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
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
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
