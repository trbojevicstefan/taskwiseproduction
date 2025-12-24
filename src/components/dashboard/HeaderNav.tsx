
// src/components/dashboard/HeaderNav.tsx
"use client";

import { useAuth } from '@/contexts/AuthContext';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { LogOut, Settings, UserCircle, Sun, Moon, HelpCircle, ClipboardPaste, Copy, Building, UserPlus, Command, RefreshCw } from 'lucide-react';
import { useTheme } from 'next-themes';
import { SidebarTrigger } from '@/components/ui/sidebar'; 
import { useRouter } from 'next/navigation';
import { usePasteAction } from '@/contexts/PasteActionContext';
import { useUIState } from '@/contexts/UIStateContext';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useToast } from '@/hooks/use-toast';
import { useIsMobile } from '@/hooks/use-mobile'; // Import the hook

export default function HeaderNav() {
  const { user, logout, updateUserProfile } = useAuth();
  const { theme, setTheme } = useTheme();
  const router = useRouter();
  const { openPasteDialog } = usePasteAction();
  const { showCopyHint } = useUIState();
  const { toast } = useToast();
  const isMobile = useIsMobile(); // Use the hook


  const getInitials = (name: string | null | undefined) => {
    if (!name) return 'U';
    return name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
  };
  
  const handleResetOnboarding = async () => {
    if (!user) return;
    try {
        await updateUserProfile({ onboardingCompleted: false }, true); // Avoid global loader
        toast({
            title: "Onboarding Reset",
            description: "The onboarding wizard will show next. Reloading page...",
        });
        // Give toast time to show before reload
        setTimeout(() => {
            window.location.reload();
        }, 1500);
    } catch (error) {
        console.error("Failed to reset onboarding:", error);
        toast({
            title: "Error",
            description: "Could not reset the onboarding process.",
            variant: "destructive",
        });
    }
  };


  return (
    <div className="flex items-center gap-2 sm:gap-4">
        
        {/* Help Button - Hidden on Mobile */}
        <div className="hidden sm:flex">
            <TooltipProvider>
            <Tooltip open={showCopyHint}>
                <TooltipTrigger asChild>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                    <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Help"
                        className="h-9 w-9"
                    >
                        <HelpCircle className="h-5 w-5" />
                    </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="w-64" align="end">
                        <DropdownMenuLabel>Quick Help & Tips</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={() => toast({ title: 'How to Paste', description: 'Press Ctrl+V or Cmd+V anywhere to paste content.'})}>
                            <ClipboardPaste className="mr-2 h-4 w-4" />
                            <span>Paste Content (Ctrl+V)</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem>
                            <Copy className="mr-2 h-4 w-4" />
                            <span>Copy Selected (Ctrl+C)</span>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={handleResetOnboarding}>
                            <RefreshCw className="mr-2 h-4 w-4" />
                            <span>Reset Onboarding Wizard</span>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                            You can paste content from anywhere in the app to get started. Select tasks in Chat or Planning to copy them.
                        </DropdownMenuLabel>
                    </DropdownMenuContent>
                </DropdownMenu>
                </TooltipTrigger>
                <TooltipContent side="bottom" align="center" className="flex items-center gap-2 bg-primary text-primary-foreground">
                    <Command size={14} />
                    <p>+ C to copy selected</p>
                </TooltipContent>
            </Tooltip>
            </TooltipProvider>
        </div>

        {/* Theme Toggle - Hidden on Mobile */}
        <Button
            variant="ghost"
            size="icon"
            onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
            aria-label="Toggle theme"
            className="h-9 w-9 hidden sm:inline-flex"
        >
            <Sun className="h-5 w-5 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
            <Moon className="absolute h-5 w-5 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
        </Button>

        {user && (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="relative h-9 w-9 rounded-full">
                <Avatar className="h-9 w-9">
                <AvatarImage 
                    src={user.photoURL || `https://api.dicebear.com/8.x/initials/svg?seed=${user.displayName || 'User'}`} 
                    alt={user.displayName || 'User Avatar'}
                />
                <AvatarFallback>{getInitials(user.displayName)}</AvatarFallback>
                </Avatar>
            </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56" align="end" forceMount>
            <DropdownMenuLabel className="font-normal">
                <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium leading-none">{user.displayName || 'User'}</p>
                <p className="text-xs leading-none text-muted-foreground">
                    {user.email}
                </p>
                </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => router.push('/settings')}>
                <UserPlus className="mr-2 h-4 w-4" />
                <span>Add teammates</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => router.push('/settings')}>
                <Building className="mr-2 h-4 w-4" />
                <span>Workspace settings</span>
            </DropdownMenuItem>
            
            {/* Mobile-only menu items */}
            {isMobile && (
                <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
                        {theme === 'light' ? <Moon className="mr-2 h-4 w-4" /> : <Sun className="mr-2 h-4 w-4" />}
                        <span>Toggle Theme</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => toast({ title: 'How to Paste', description: 'Press and hold to paste content anywhere in the app.'})}>
                        <HelpCircle className="mr-2 h-4 w-4" />
                        <span>Help & Tips</span>
                    </DropdownMenuItem>
                </>
            )}

            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => router.push('/settings')}>
                <Settings className="mr-2 h-4 w-4" />
                <span>Settings</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => router.push('/settings')}>
                <UserCircle className="mr-2 h-4 w-4" />
                <span>Profile</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={logout}>
                <LogOut className="mr-2 h-4 w-4" />
                <span>Log out</span>
            </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
        )}
    </div>
  );
}
