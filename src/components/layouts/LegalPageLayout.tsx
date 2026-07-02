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
            <div className="prose prose-invert max-w-none text-muted-foreground">
                {children}
            </div>
        </main>
        <footer className="text-center py-6 text-sm text-muted-foreground border-t">
            <p>&copy; {new Date().getFullYear()} TaskWiseAI. All rights reserved.</p>
        </footer>
    </div>
  );
}
