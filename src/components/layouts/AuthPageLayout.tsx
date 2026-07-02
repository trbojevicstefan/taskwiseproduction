// src/components/layouts/AuthPageLayout.tsx
import type { ReactNode } from 'react';
import { Logo } from '@/components/ui/logo';
import { CheckCircle2 } from 'lucide-react';

interface AuthPageLayoutProps {
  children: ReactNode;
  title: string;
  description?: string;
}

const brandGradient =
  "bg-[radial-gradient(1200px_600px_at_10%_10%,rgba(255,86,48,0.25),transparent_60%),radial-gradient(1200px_600px_at_90%_20%,rgba(255,175,0,0.25),transparent_60%),radial-gradient(1200px_600px_at_50%_90%,rgba(255,0,128,0.25),transparent_60%)]";


const AuthFeature: React.FC<{ children: ReactNode }> = ({ children }) => (
    <li className="flex items-start gap-3">
        <CheckCircle2 className="h-5 w-5 mt-1 text-primary flex-shrink-0"/>
        <span className="text-white/80">{children}</span>
    </li>
)

export default function AuthPageLayout({ children, title, description }: AuthPageLayoutProps) {
  return (
    <div className={`relative flex flex-col items-center justify-center min-h-screen bg-[#0B0B0F] p-4 sm:p-6 lg:p-8 ${brandGradient}`}>
        <div className="w-full max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-2 items-center gap-12">
            
            {/* Left Side: Brand Info */}
            <div className="hidden md:flex flex-col justify-center space-y-6 text-left">
                 <Logo size="lg" />
                 <h1 className="text-4xl font-bold text-white leading-tight">
                    Turn Conversations into Actionable Plans.
                 </h1>
                 <p className="text-lg text-white/70">
                    TaskWiseAI is the intelligent partner that helps you extract, organize, and execute tasks from your ideas and discussions.
                 </p>
                 <ul className="space-y-4 pt-4">
                    <AuthFeature>Extract tasks from any text with our advanced AI.</AuthFeature>
                    <AuthFeature>Visualize your projects with interactive mind maps.</AuthFeature>
                    <AuthFeature>Collaborate with your team and integrate with your favorite tools.</AuthFeature>
                 </ul>
            </div>

            {/* Right Side: Auth Form */}
            <div className="w-full max-w-md mx-auto">
                <div className="mb-8 text-center md:hidden"> {/* Show on mobile only */}
                    <Logo size="lg" className="justify-center mb-4" />
                </div>
                {children}
            </div>
        </div>
    </div>
  );
}
