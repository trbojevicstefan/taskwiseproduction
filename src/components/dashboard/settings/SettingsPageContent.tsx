// src/components/dashboard/settings/SettingsPageContent.tsx
"use client";

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Loader2, Power, PowerOff, RefreshCw, Copy, Check, Save, Video, Users, Building, Send, Image as ImageIcon, Link as LinkIcon, Settings as SettingsIcon, ZoomIn, Bot, Slack, FileText, MessageSquare, User, Info as InfoIcon, ToyBrick, Webhook, ClipboardCheck } from 'lucide-react';
import { useIntegrations } from '@/contexts/IntegrationsContext';
import { useToast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { useUIState, type UIScale } from '@/contexts/UIStateContext';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { Logo } from '@/components/ui/logo';
import Image from 'next/image';
import DashboardHeader from '../DashboardHeader';

const AVATAR_STYLES = [
  'adventurer', 'adventurer-neutral', 'avataaars', 'big-ears', 'big-smile', 
  'bottts', 'croodles', 'fun-emoji', 'icons', 'identicon', 'initials', 
  'lorelei', 'micah', 'miniavs', 'open-peeps', 'personas', 'pixel-art', 
  'shapes', 'thumbs'
];

const scaleLabels: { [key in UIScale]: string } = {
  small: 'Small',
  medium: 'Medium',
  large: 'Large',
  'very-large': 'Very Large',
};
const scaleValues: UIScale[] = ['small', 'medium', 'large', 'very-large'];

const IntegrationCard: React.FC<{
  icon: React.ElementType;
  title: string;
  description: string;
  isConnected: boolean;
  isLoading: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  extraActions?: React.ReactNode;
}> = ({
  icon: Icon,
  title,
  description,
  isConnected,
  isLoading,
  onConnect,
  onDisconnect,
  extraActions,
}) => {
  return (
    <div className="flex items-center justify-between p-4 rounded-lg bg-card border border-border/50 hover:border-primary/50 transition-colors">
      <div className="flex items-center gap-4">
        <div className="p-2 bg-background rounded-lg">
            <Icon className="h-8 w-8" />
        </div>
        <div>
          <h4 className="font-semibold text-foreground">{title}</h4>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      {isLoading ? (
        <Button variant="outline" size="sm" disabled>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Checking...
        </Button>
      ) : isConnected ? (
        <div className="flex items-center gap-2">
          {extraActions}
          <Button variant="secondary" size="sm" onClick={onDisconnect}>
            <PowerOff className="mr-2 h-4 w-4 text-red-500" />
            Disconnect
          </Button>
        </div>
      ) : (
        <Button variant="outline" size="sm" onClick={onConnect}>
          <Power className="mr-2 h-4 w-4 text-green-500" />
          Connect
        </Button>
      )}
    </div>
  );
};


export default function SettingsPageContent() {
  const { user, loading: authLoading, updateUserProfile, refreshUserProfile } = useAuth();
  const { uiScale, setUiScale } = useUIState();
  const {
    isGoogleTasksConnected,
    isLoadingGoogleConnection,
    connectGoogleTasks,
    disconnectGoogleTasks,
    isTrelloConnected,
    isLoadingTrelloConnection,
    connectTrello,
    disconnectTrello,
    isSlackConnected,
    isLoadingSlackConnection,
    connectSlack,
    disconnectSlack,
    isFathomConnected,
    isLoadingFathomConnection,
    connectFathom,
    disconnectFathom,
    triggerTokenFetch, 
  } = useIntegrations();
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const router = useRouter();


  const [displayName, setDisplayName] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [workspaceName, setWorkspaceName] = useState('');
  const [isSavingWorkspace, setIsSavingWorkspace] = useState(false);
  const [hasCopied, setHasCopied] = useState(false);
  const [autoApproveCompleted, setAutoApproveCompleted] = useState(false);
  
  const [isAvatarDialogOpen, setIsAvatarDialogOpen] = useState(false);
  const [selectedAvatarUrl, setSelectedAvatarUrl] = useState('');
  const [customAvatarUrl, setCustomAvatarUrl] = useState('');
  const randomSeed = useMemo(() => user?.uid || Math.random().toString(36).substring(7), [user]);
  const webhookUrlInputRef = useRef<HTMLInputElement>(null);
  const [isCreatingFathomWebhook, setIsCreatingFathomWebhook] = useState(false);
  const [isFathomLogsOpen, setIsFathomLogsOpen] = useState(false);
  const [fathomLogs, setFathomLogs] = useState<Array<{
    id?: string;
    level: string;
    event: string;
    message: string;
    metadata?: Record<string, unknown> | null;
    createdAt: string;
  }>>([]);
  const [isLoadingFathomLogs, setIsLoadingFathomLogs] = useState(false);

  useEffect(() => {
    // This function will run when the component mounts and when searchParams change.
    const handleRedirect = async () => {
      const slackSuccess = searchParams.get('slack_success');
      const trelloSuccess = searchParams.get('trello_success');
      const googleSuccess = searchParams.get('google_success');
      const fathomSuccess = searchParams.get('fathom_success');
      const fathomWebhook = searchParams.get('fathom_webhook');
      const error = searchParams.get('error');
      const message = searchParams.get('message');
      
      let needsRefresh = false;

      if (slackSuccess === 'true') {
        toast({
            title: "Slack Connected!",
            description: "You can now share tasks and summaries to Slack.",
        });
        needsRefresh = true;
      } else if (trelloSuccess === 'true') {
        toast({
            title: "Trello Connected!",
            description: "You can now create Trello cards from your tasks.",
        });
        needsRefresh = true;
      } else if (googleSuccess === 'true') {
         toast({
            title: "Google Workspace Connected!",
            description: "Meeting ingestion and task syncing are now active.",
        });
        needsRefresh = true;
      } else if (fathomSuccess === 'true') {
        toast({
            title: "Fathom Connected!",
            description: "New Fathom meetings will sync into TaskWiseAI.",
        });
        needsRefresh = true;
        if (fathomWebhook === 'failed') {
          toast({
            title: "Fathom Webhook Not Created",
            description: "Please add the webhook URL in Fathom to enable automatic imports.",
            variant: "destructive",
          });
        }
      }
      else if (error) {
        toast({
            title: `Connection Failed: ${error}`,
            description: message || "Please try again or contact support.",
            variant: "destructive",
        });
      }
      
      if (needsRefresh) {
        await refreshUserProfile(); // Refresh the main user object
        await triggerTokenFetch();  // Refresh the integration-specific tokens
      }

      // Clean the URL if any of our params were present
      if(slackSuccess || trelloSuccess || googleSuccess || fathomSuccess || fathomWebhook || error) {
        router.replace('/settings', { scroll: false });
      }
    };
    
    handleRedirect();

  }, [searchParams, router, toast, triggerTokenFetch, refreshUserProfile]);


  useEffect(() => {
    if (user) {
      setDisplayName(user.displayName || '');
      setSelectedAvatarUrl(user.photoURL || '');
      setWorkspaceName(user.workspace?.name || '');
      setAutoApproveCompleted(Boolean(user.autoApproveCompletedTasks));
    }
  }, [user]);

  const handleProfileSave = async () => {
    if (!displayName.trim()) {
      toast({ title: 'Invalid Name', description: 'Display name cannot be empty.', variant: 'destructive' });
      return;
    }
    
    setIsSaving(true);
    try {
      await updateUserProfile({ displayName: displayName.trim() });
      toast({ title: 'Profile Updated', description: 'Your personal information has been saved.' });
    } catch (error) {
      console.error("Failed to save profile:", error);
      toast({ title: 'Error', description: 'Could not save your profile changes.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleWorkspaceSave = async () => {
    if (!workspaceName.trim()) {
      toast({ title: 'Invalid Workspace Name', description: 'Workspace name cannot be empty.', variant: 'destructive' });
      return;
    }
    setIsSavingWorkspace(true);
    try {
      await updateUserProfile({ workspace: { name: workspaceName.trim() } });
      toast({ title: 'Workspace Updated', description: 'Your workspace name has been saved.' });
    } catch (error) {
      console.error("Failed to save workspace:", error);
      toast({ title: 'Error', description: 'Could not save workspace settings.', variant: 'destructive' });
    } finally {
      setIsSavingWorkspace(false);
    }
  };

  const handleAutoApproveToggle = async (value: boolean) => {
    setAutoApproveCompleted(value);
    try {
      await updateUserProfile({ autoApproveCompletedTasks: value }, true);
      toast({
        title: "Completion Review Updated",
        description: value
          ? "Completed items will be auto-approved."
          : "Completed items will require manual review.",
      });
    } catch (error) {
      console.error("Failed to update completion review setting:", error);
      setAutoApproveCompleted(Boolean(user?.autoApproveCompletedTasks));
      toast({
        title: "Update Failed",
        description: "Could not update completion review preference.",
        variant: "destructive",
      });
    }
  };
  
  const handleSelectAndCopy = () => {
      if (!webhookUrlInputRef.current) return;
      webhookUrlInputRef.current.select();
      
      try {
        navigator.clipboard.writeText(webhookUrlInputRef.current.value).then(() => {
          setHasCopied(true);
          setTimeout(() => setHasCopied(false), 2500);
          toast({ title: "Copied!", description: "Webhook URL copied to clipboard." });
        }).catch(() => {
          document.execCommand('copy');
          setHasCopied(true);
          setTimeout(() => setHasCopied(false), 2500);
          toast({ title: "Selected!", description: "URL selected. Press Ctrl+C to copy." });
        });
      } catch (err) {
        document.execCommand('copy');
        setHasCopied(true);
        setTimeout(() => setHasCopied(false), 2500);
        toast({ title: "Selected!", description: "URL selected. Press Ctrl+C to copy." });
      }
  };

  const loadFathomLogs = async () => {
    setIsLoadingFathomLogs(true);
    try {
      const response = await fetch("/api/fathom/logs");
      const payload = await response.json().catch(() => []);
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to load logs.");
      }
      setFathomLogs(Array.isArray(payload) ? payload : []);
    } catch (error) {
      console.error("Failed to load Fathom logs:", error);
      toast({
        title: "Could not load logs",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoadingFathomLogs(false);
    }
  };

  const handleOpenFathomLogs = async () => {
    setIsFathomLogsOpen(true);
    await loadFathomLogs();
  };

  const handleRecreateFathomWebhook = async () => {
    if (!user?.fathomConnected) {
      toast({
        title: "Fathom Not Connected",
        description: "Connect Fathom before creating a webhook.",
        variant: "destructive",
      });
      return;
    }
    setIsCreatingFathomWebhook(true);
    try {
      const response = await fetch("/api/fathom/webhook/setup", { method: "POST" });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "Failed to create webhook.");
      }
      const payload = await response.json();
      toast({
        title: "Webhook Ready",
        description: `Status: ${payload.status || "created"}`,
      });
      await refreshUserProfile();
      await triggerTokenFetch();
    } catch (error) {
      console.error("Failed to create Fathom webhook:", error);
      toast({
        title: "Webhook Failed",
        description: error instanceof Error ? error.message : "Could not create webhook.",
        variant: "destructive",
      });
    } finally {
      setIsCreatingFathomWebhook(false);
    }
  };

  const getInitials = (name: string | null | undefined) => {
    if (!name) return 'U';
    return name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
  };
  
  const appBaseUrl =
    typeof window !== "undefined" ? window.location.origin : "";
  const webhookUrl = user?.fathomWebhookToken
    ? `${appBaseUrl}/api/fathom/webhook?token=${user.fathomWebhookToken}`
    : "";


  const handleSaveAvatar = async () => {
    if (!selectedAvatarUrl) {
        toast({ title: "No Avatar Selected", variant: "destructive"});
        return;
    }
    setIsSaving(true);
    try {
        await updateUserProfile({ photoURL: selectedAvatarUrl });
        toast({ title: "Avatar Updated!"});
        setIsAvatarDialogOpen(false);
    } catch (error) {
        console.error("Failed to save avatar:", error);
        toast({ title: 'Error', description: 'Could not save your new avatar.', variant: 'destructive' });
    } finally {
        setIsSaving(false);
    }
  };

  return (
    <>
      <div className="flex flex-col h-full">
        <DashboardHeader
          pageIcon={SettingsIcon}
          pageTitle={<h1 className="text-2xl font-bold font-headline">Settings</h1>}
        />
        <div className="flex-grow p-4 sm:p-6 lg:p-8 space-y-8 overflow-auto">
            <div className="max-w-5xl mx-auto">
                <Card className="shadow-lg rounded-xl">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-3 font-headline text-xl">
                            <User className="text-blue-400 drop-shadow-[0_2px_4px_rgba(59,130,246,0.5)]" />
                            My Profile
                        </CardTitle>
                        <CardDescription>Update your personal information.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        <div className="flex items-center space-x-6">
                            <Avatar className="h-20 w-20">
                              <AvatarImage src={user?.photoURL || `https://api.dicebear.com/8.x/initials/svg?seed=${user?.displayName || user?.email}`} alt={user?.displayName || "User Avatar"} data-ai-hint="profile user"/>
                              <AvatarFallback className="text-2xl">{getInitials(user?.displayName)}</AvatarFallback>
                            </Avatar>
                            <div className="space-y-2">
                                <Button variant="outline" size="sm" onClick={() => setIsAvatarDialogOpen(true)}>Change Avatar</Button>
                                <p className="text-xs text-muted-foreground">Update your profile picture.</p>
                            </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                              <Label htmlFor="displayName">Display Name</Label>
                              <Input id="displayName" value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="mt-1" disabled={isSaving || authLoading} />
                            </div>
                            <div>
                              <Label htmlFor="email">Email Address</Label>
                              <Input id="email" type="email" defaultValue={user?.email || ''} disabled className="mt-1 bg-muted/50 cursor-not-allowed" />
                            </div>
                        </div>
                    </CardContent>
                    <CardFooter>
                        <Button onClick={handleProfileSave} disabled={isSaving || authLoading}>
                            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4"/>}
                            Save Profile
                        </Button>
                    </CardFooter>
                </Card>

                <Card className="shadow-lg rounded-xl mt-8">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-3 font-headline text-xl">
                      <Building className="text-emerald-400 drop-shadow-[0_2px_4px_rgba(16,185,129,0.5)]" />
                      Workspace
                    </CardTitle>
                    <CardDescription>Manage your workspace name and identity.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <Label htmlFor="workspaceName">Workspace Name</Label>
                      <Input
                        id="workspaceName"
                        value={workspaceName}
                        onChange={(e) => setWorkspaceName(e.target.value)}
                        className="mt-1"
                        disabled={isSavingWorkspace || authLoading}
                      />
                    </div>
                  </CardContent>
                  <CardFooter>
                    <Button onClick={handleWorkspaceSave} disabled={isSavingWorkspace || authLoading}>
                      {isSavingWorkspace ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4"/>}
                      Save Workspace
                    </Button>
                  </CardFooter>
                </Card>

                <Card className="shadow-lg rounded-xl mt-8">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-3 font-headline text-xl">
                      <ClipboardCheck className="text-sky-400 drop-shadow-[0_2px_4px_rgba(56,189,248,0.5)]" />
                      Meeting Automation
                    </CardTitle>
                    <CardDescription>Control how TaskWiseAI handles completed items.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center justify-between gap-6">
                      <div className="space-y-1">
                        <Label className="text-sm font-medium">Auto-approve completed tasks</Label>
                        <p className="text-xs text-muted-foreground">
                          If enabled, TaskWiseAI will mark detected completed tasks as done automatically.
                        </p>
                      </div>
                      <Switch
                        checked={autoApproveCompleted}
                        onCheckedChange={handleAutoApproveToggle}
                        aria-label="Auto-approve completed tasks"
                      />
                    </div>
                  </CardContent>
                </Card>

                 {/* Integrations Settings */}
                <Card className="shadow-lg rounded-xl mt-8">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-3 font-headline text-xl">
                        <LinkIcon className="text-purple-400 drop-shadow-[0_2px_4px_rgba(168,85,247,0.5)]" />
                        Integrations
                    </CardTitle>
                    <CardDescription>Connect TaskWiseAI with your favorite services.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                      <IntegrationCard 
                            icon={Bot}
                            title="Google Workspace"
                            description="Connect Meet, Calendar, and Drive for meeting ingestion."
                            isConnected={isGoogleTasksConnected}
                            isLoading={isLoadingGoogleConnection}
                            onConnect={connectGoogleTasks}
                            onDisconnect={disconnectGoogleTasks}
                        />
                        <IntegrationCard 
                            icon={ToyBrick}
                            title="Trello"
                            description="Create Trello cards from your tasks."
                            isConnected={isTrelloConnected}
                            isLoading={isLoadingTrelloConnection}
                            onConnect={connectTrello}
                            onDisconnect={disconnectTrello}
                        />
                        <IntegrationCard 
                            icon={Slack}
                            title="Slack"
                            description="Post meeting summaries and tasks to channels."
                            isConnected={isSlackConnected}
                            isLoading={isLoadingSlackConnection}
                            onConnect={connectSlack}
                            onDisconnect={disconnectSlack}
                        />
                        <IntegrationCard 
                            icon={Video}
                            title="Fathom"
                            description="Sync meetings and transcripts from Fathom."
                            isConnected={isFathomConnected}
                            isLoading={isLoadingFathomConnection}
                            onConnect={connectFathom}
                            onDisconnect={disconnectFathom}
                            extraActions={isFathomConnected ? (
                              <Button variant="outline" size="sm" onClick={handleOpenFathomLogs}>
                                <FileText className="mr-2 h-4 w-4" />
                                Logs
                              </Button>
                            ) : null}
                        />
                        <div className="p-4 rounded-lg bg-card border border-border/50">
                            <div className="flex items-center gap-4">
                                <div className="p-2 bg-background rounded-lg"><Webhook className="h-8 w-8 text-green-400" /></div>
                                <div>
                                    <h4 className="font-semibold text-foreground">Fathom Webhook</h4>
                                    <p className="text-sm text-muted-foreground">Receive finished Fathom recordings and auto-create meetings.</p>
                                </div>
                            </div>
                            <div className="mt-4 flex flex-col sm:flex-row items-center gap-2">
                                <Input
                                    ref={webhookUrlInputRef}
                                    id="webhook-url"
                                    type="text"
                                    readOnly
                                    value={webhookUrl || 'Connect Fathom to create your webhook URL.'}
                                    className="flex-1 bg-muted/50"
                                />
                                {user?.fathomWebhookToken ? (
                                    <Button variant="ghost" size="sm" onClick={handleSelectAndCopy} className="w-full sm:w-auto">
                                        {hasCopied ? <Check className="mr-2 h-4 w-4 text-green-500"/> : <Copy className="mr-2 h-4 w-4"/>}
                                        {hasCopied ? "Copied!" : "Copy URL"}
                                    </Button>
                                ) : (
                                    <Button onClick={connectFathom} className="w-full sm:w-auto">
                                        <Send className="mr-2 h-4 w-4"/>
                                        Connect Fathom
                                    </Button>
                                )}
                            </div>
                            {user?.fathomConnected && user?.fathomWebhookToken && (
                                <div className="mt-3">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={handleRecreateFathomWebhook}
                                        disabled={isCreatingFathomWebhook}
                                    >
                                        {isCreatingFathomWebhook ? (
                                            <>
                                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                Creating...
                                            </>
                                        ) : (
                                            <>
                                                <RefreshCw className="mr-2 h-4 w-4" />
                                                Recreate Webhook
                                            </>
                                        )}
                                    </Button>
                                </div>
                            )}
                            {user?.fathomWebhookToken && (
                                <div className="mt-4 flex items-start gap-3 p-3 bg-background rounded-lg border border-border/30">
                                    <InfoIcon className="h-5 w-5 mt-0.5 text-muted-foreground flex-shrink-0" />
                                    <p className="text-xs text-muted-foreground">
                                        In Fathom, create a webhook for the "new meeting content ready" event and paste this URL. TaskWiseAI will automatically create a meeting with tasks and a linked plan.
                                    </p>
                                </div>
                            )}
                        </div>
                  </CardContent>
                </Card>

                {/* Appearance Settings */}
                <Card className="shadow-lg rounded-xl mt-8">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-3 font-headline text-xl">
                      <ImageIcon className="text-orange-400 drop-shadow-[0_2px_4px_rgba(251,146,60,0.5)]" />
                      Appearance
                    </CardTitle>
                    <CardDescription>Customize the look and feel of the application.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      <Label>UI Scale</Label>
                      <div className="flex items-center gap-4">
                        <ZoomIn size={16} />
                        <Slider
                          min={0}
                          max={scaleValues.length - 1}
                          step={1}
                          value={[scaleValues.indexOf(uiScale)]}
                          onValueChange={([value]) => setUiScale(scaleValues[value])}
                        />
                        <ZoomIn size={24} />
                      </div>
                      <div className="text-center text-sm text-muted-foreground">{scaleLabels[uiScale]}</div>
                    </div>
                  </CardContent>
                </Card>

                {/* Account Settings */}
                <Card className="shadow-lg rounded-xl border-destructive/50 mt-8">
                  <CardHeader>
                    <CardTitle className="font-headline text-xl text-destructive flex items-center gap-3">
                      <Building className="drop-shadow-[0_2px_4px_rgba(239,68,68,0.5)]" />
                      Account Actions
                    </CardTitle>
                    <CardDescription>Manage your account settings.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                      <Button variant="outline">Change Password</Button>
                      <Button variant="destructive" className="w-full sm:w-auto">Delete Account</Button>
                      <p className="text-xs text-muted-foreground">
                          Deleting your account is permanent and cannot be undone. All your data will be removed.
                      </p>
                  </CardContent>
                </Card>
            </div>
        </div>
      </div>

      <Dialog open={isAvatarDialogOpen} onOpenChange={setIsAvatarDialogOpen}>
        <DialogContent className="sm:max-w-[625px]">
            <DialogHeader>
                <DialogTitle>Change Avatar</DialogTitle>
                <DialogDescription>
                    Select a generated avatar or provide your own image URL.
                </DialogDescription>
            </DialogHeader>
            <div className="grid gap-6 py-4">
                <div className="flex items-center gap-4">
                    <Avatar className="h-20 w-20">
                      <AvatarImage src={selectedAvatarUrl} alt="Selected Avatar" />
                      <AvatarFallback className="text-3xl">{getInitials(displayName)}</AvatarFallback>
                    </Avatar>
                    <div className="grid gap-2 flex-1">
                        <Label htmlFor="custom-url">Custom Image URL</Label>
                        <Input
                            id="custom-url"
                            placeholder="https://example.com/avatar.png"
                            value={customAvatarUrl}
                            onChange={(e) => {
                                setCustomAvatarUrl(e.target.value);
                                setSelectedAvatarUrl(e.target.value);
                            }}
                        />
                    </div>
                </div>

                <div className="space-y-2">
                    <Label>Or choose a style</Label>
                    <div className="h-64 pr-4 overflow-y-auto">
                      <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 gap-4">
                          {AVATAR_STYLES.map(style => {
                            const avatarUrl = `https://api.dicebear.com/8.x/${style}/svg?seed=${randomSeed}`;
                            return (
                                <button
                                    key={style}
                                    className="p-2 rounded-lg border-2 data-[state=checked]:border-primary hover:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
                                    data-state={selectedAvatarUrl === avatarUrl ? 'checked' : 'unchecked'}
                                    onClick={() => {
                                        setSelectedAvatarUrl(avatarUrl);
                                        setCustomAvatarUrl('');
                                    }}
                                >
                                    <img src={avatarUrl} alt={`${style} avatar`} className="w-full h-full rounded-md bg-muted" />
                                </button>
                            );
                          })}
                      </div>
                    </div>
                </div>
            </div>
            <DialogFooter>
                <DialogClose asChild>
                    <Button type="button" variant="outline">
                        Cancel
                    </Button>
                </DialogClose>
                <Button type="submit" onClick={handleSaveAvatar} disabled={isSaving}>
                  {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin"/>}
                  Save Avatar
                </Button>
            </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isFathomLogsOpen} onOpenChange={setIsFathomLogsOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Fathom Integration Logs</DialogTitle>
            <DialogDescription>
              Recent webhook, sync, and OAuth events for this workspace.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              Showing {fathomLogs.length} entries
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={loadFathomLogs}
              disabled={isLoadingFathomLogs}
            >
              {isLoadingFathomLogs ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Refresh
            </Button>
          </div>
          <div className="max-h-[420px] overflow-y-auto space-y-3">
            {isLoadingFathomLogs && (
              <div className="text-sm text-muted-foreground">Loading logs...</div>
            )}
            {!isLoadingFathomLogs && fathomLogs.length === 0 && (
              <div className="text-sm text-muted-foreground">No logs yet.</div>
            )}
            {fathomLogs.map((log) => (
              <div
                key={log.id || `${log.event}-${log.createdAt}`}
                className="rounded-lg border bg-muted/30 p-3"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="uppercase text-[10px]">
                      {log.level}
                    </Badge>
                    <span className="text-xs font-semibold text-foreground">
                      {log.event}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {log.createdAt
                      ? new Date(log.createdAt).toLocaleString()
                      : "Unknown time"}
                  </span>
                </div>
                <p className="text-sm text-foreground mt-2">{log.message}</p>
                {log.metadata && (
                  <pre className="mt-2 rounded-md bg-background px-3 py-2 text-xs text-muted-foreground whitespace-pre-wrap">
                    {JSON.stringify(log.metadata, null, 2)}
                  </pre>
                )}
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsFathomLogsOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
