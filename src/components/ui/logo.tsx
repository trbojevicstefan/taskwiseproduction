import { cn } from '@/lib/utils';
import Image from 'next/image';

interface LogoProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  isIconOnly?: boolean;
}

export function Logo({ size = 'md', className, isIconOnly = false }: LogoProps) {
  const sizeClasses = {
    sm: 'text-xl',
    md: 'text-2xl',
    lg: 'text-3xl',
  };

  const iconSizeMap = {
    sm: 32,
    md: 36,
    lg: 40,
  };

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className={cn('flex-shrink-0')}>
         <Image
            src="/logo.svg"
            alt="TaskWiseAI Logo"
            width={iconSizeMap[size]}
            height={iconSizeMap[size]}
            className="object-contain"
          />
      </div>
      {!isIconOnly && (
        <span className={cn(
          'font-headline font-bold', 
          sizeClasses[size], 
          'group-data-[collapsible=icon]:hidden',
          'bg-gradient-to-r from-orange-400 via-red-500 to-yellow-400 text-transparent bg-clip-text'
        )}>
          TaskWiseAI
        </span>
      )}
    </div>
  );
}
