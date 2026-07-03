// src/components/layouts/LegalPageLayout.tsx
import type { ReactNode } from 'react';
import Link from 'next/link';
import { Logo } from '@/components/ui/logo';

interface LegalPageLayoutProps {
  children: ReactNode;
  title: string;
}

export default function LegalPageLayout({ children, title }: LegalPageLayoutProps) {
  return (
    <div className="bg-background min-h-screen text-foreground">
        <header className="py-4 px-4 sm:px-6 lg:px-8 border-b">
            <Link href="/">
                <Logo size="md" />
            </Link>
        </header>
        <main className="max-w-3xl mx-auto py-8 sm:py-12 px-4 sm:px-6 lg:px-8">
            <h1 className="text-3xl sm:text-4xl font-bold font-headline mb-6">{title}</h1>
            <div className="text-muted-foreground [&_h2]:mt-8 [&_h2]:mb-3 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-foreground [&_p]:mb-4 [&_p]:leading-7 [&_ul]:mb-4 [&_ul]:list-disc [&_ul]:pl-6 [&_li]:mb-2 [&_li]:leading-7 [&_strong]:font-semibold [&_strong]:text-foreground">
                {children}
            </div>
        </main>
        <footer className="text-center py-6 text-sm text-muted-foreground border-t">
            <p>&copy; {new Date().getFullYear()} TaskWiseAI. All rights reserved.</p>
        </footer>
    </div>
  );
}
