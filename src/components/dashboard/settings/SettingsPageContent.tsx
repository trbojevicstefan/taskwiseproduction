// src/components/dashboard/settings/SettingsPageContent.tsx
"use client";

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Loader2, Power, PowerOff, RefreshCw, Copy, Check, Save, Video, Users, Building, Send, Image as ImageIcon, Link as LinkIcon, Settings as SettingsIcon, Settings2, ZoomIn, Bot, Slack, FileText, User, ToyBrick, Webhook, ClipboardCheck, Trash2, Download, Key } from 'lucide-react';
import { useIntegrations } from '@/contexts/IntegrationsContext';
import { useToast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { useUIState, type UIScale } from '@/contexts/UIStateContext';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import DashboardHeader from '../DashboardHeader';
import TaskCleanupSettingsCard from '@/components/dashboard/settings/TaskCleanupSettingsCard';
import SlackRemindersSettingsCard from '@/components/dashboard/settings/SlackRemindersSettingsCard';
import { isAdvancedSettingsEnabled } from '@/lib/simplification-flags';

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

const GOOGLE_INTEGRATION_LOCAL_CALLBACK_URL =
  "http://localhost:9002/api/auth/callback/google-integration";
const GOOGLE_INTEGRATION_PRODUCTION_CALLBACK_URL = "${NEXTAUTH_URL}/api/auth/callback/google-integration";

const resolveGoogleIntegrationOauthErrorMessage = (code: string, message?: string | null) => {
  if (code === "OAuthSignin") {
    return "Google OAuth could not start. Verify Google OAuth app settings for the integration client.";
  }
  if (code === "OAuthCallback") {
    return `Google OAuth callback failed. Ensure Google Cloud allows ${GOOGLE_INTEGRATION_LOCAL_CALLBACK_URL} locally and ${GOOGLE_INTEGRATION_PRODUCTION_CALLBACK_URL} in production.`;
  }
  if (code === "Configuration") {
    return "Google Workspace integration is not configured. Set GOOGLE_INTEGRATION_CLIENT_ID and GOOGLE_INTEGRATION_CLIENT_SECRET.";
  }
  if (code === "AccessDenied") {
    return "Google Workspace authorization was canceled or denied.";
  }
  if (code === "google-integration") {
    return "Google Workspace integration provider is unavailable. Verify OAuth configuration and callback URLs.";
  }
  return message || `Google Workspace connection failed (${code}).`;
};

type SlackChannel = {
  id: string;
  name: string;
};

type FathomConnectionSummary = {
  id: string;
  label: string;
  status: string;
  createdByUserId: string;
  updatedAt: string;
  isPreferred?: boolean;
  connectedByCurrentUser?: boolean;
  canManage?: boolean;
  webhook?: {
    webhookId?: string | null;
    webhookUrl?: string | null;
    managedWebhooks?: Array<Record<string, any>> | null;
  };
};

type WorkflowTrigger = "meeting.ingested" | "meeting.updated";
type WorkflowFilterOperator =
  | "equals"
  | "not_equals"
  | "contains"
  | "not_contains"
  | "in"
  | "not_in"
  | "exists"
  | "not_exists"
  | "greater_than"
  | "greater_than_or_equal"
  | "less_than"
  | "less_than_or_equal"
  | "contains_any"
  | "contains_all";

type WorkflowSummary = {
  id: string;
  name: string;
  description?: string | null;
  enabled: boolean;
  trigger: WorkflowTrigger;
  version: number;
  updatedAt: string | null;
  canManage?: boolean;
  autoDisabledAt?: string | null;
  autoDisabledReason?: string | null;
  autoDisabledFailureCount?: number | null;
};

type WorkflowDeliverySummary = {
  id: string;
  status: "queued" | "sending" | "sent" | "failed" | "disabled";
  eventType: string;
  attemptCount: number;
  maxAttempts: number;
  failedAt?: string | null;
  disabledAt?: string | null;
  updatedAt: string | null;
  lastError?: {
    message?: string;
  } | null;
  latestResponse?: {
    statusCode?: number | null;
  } | null;
};

type WorkflowDetail = WorkflowSummary & {
  filters: Array<{
    field: string;
    operator: WorkflowFilterOperator;
    value?: string | number | boolean | null | Array<string | number | boolean>;
    caseSensitive?: boolean;
  }>;
  fieldSelection: {
    mode: "all" | "subset";
    fields: string[];
  };
  transform: {
    runtime: "quickjs";
    script: string | null;
    timeoutMs: number;
  };
  destination: {
    type: "webhook";
    url: string;
    signingSecret?: string | null;
    headers?: Record<string, string> | null;
  };
};

type WorkflowPlaygroundMeetingSummary = {
  id: string;
  title: string;
  summary?: string | null;
  lastActivityAt?: string | null;
  matched: boolean;
};

type WorkflowPlaygroundPreviewResult = {
  consideredMeetingCount: number;
  matchedMeetingCount: number;
  meetings: WorkflowPlaygroundMeetingSummary[];
  selectedMeeting: WorkflowPlaygroundMeetingSummary | null;
  selectedPayload: unknown;
  selectedPayloadBytes: number | null;
  selectedPayloadTruncated: boolean;
  selectedPayloadError?: string | null;
  transformOutput: unknown;
  transformOutputBytes: number | null;
  transformOutputTruncated: boolean;
  transformOutputError?: {
    message?: string;
  } | null;
};

type McpApiKeySummary = {
  id: string;
  workspaceId: string;
  name: string;
  description?: string | null;
  keyPrefix: string;
  scopes: string[];
  status: "active" | "revoked";
  expiresAt?: string | null;
  lastUsedAt?: string | null;
  createdByUserId: string;
  revokedByUserId?: string | null;
  revokedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

type McpAuditLogSummary = {
  id: string;
  workspaceId: string;
  actorType: "api_key" | "user";
  actorUserId?: string | null;
  apiKeyId?: string | null;
  apiKeyName?: string | null;
  action: string;
  resourceType?: string | null;
  resourceId?: string | null;
  status: "success" | "error";
  message: string;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
};

const formatWorkflowTriggerLabel = (trigger: WorkflowTrigger) =>
  trigger === "meeting.updated" ? "Meeting Updated" : "Meeting Ingested";

const formatDateTimeValue = (value: string | null | undefined, emptyLabel = "Never") => {
  if (!value) {
    return emptyLabel;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }
  return date.toLocaleString();
};

const WORKFLOW_FILTER_OPERATOR_OPTIONS: Array<{
  value: WorkflowFilterOperator;
  label: string;
}> = [
  { value: "equals", label: "Equals" },
  { value: "not_equals", label: "Not Equals" },
  { value: "contains", label: "Contains" },
  { value: "not_contains", label: "Not Contains" },
  { value: "in", label: "In List" },
  { value: "not_in", label: "Not In List" },
  { value: "exists", label: "Exists" },
  { value: "not_exists", label: "Does Not Exist" },
  { value: "greater_than", label: "Greater Than" },
  { value: "greater_than_or_equal", label: "Greater Than Or Equal" },
  { value: "less_than", label: "Less Than" },
  { value: "less_than_or_equal", label: "Less Than Or Equal" },
  { value: "contains_any", label: "Contains Any" },
  { value: "contains_all", label: "Contains All" },
];

const WORKFLOW_FILTER_OPERATORS_WITHOUT_VALUE = new Set<WorkflowFilterOperator>([
  "exists",
  "not_exists",
]);

const WORKFLOW_FILTER_OPERATORS_WITH_ARRAY_VALUE = new Set<WorkflowFilterOperator>([
  "in",
  "not_in",
  "contains_any",
  "contains_all",
]);

const createDraftId = () =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

type WorkflowFilterDraft = {
  id: string;
  field: string;
  operator: WorkflowFilterOperator;
  value: string;
  caseSensitive: boolean;
};

type WorkflowFormState = {
  name: string;
  description: string;
  enabled: boolean;
  trigger: WorkflowTrigger;
  destinationUrl: string;
  destinationSigningSecret: string;
  destinationHeadersJson: string;
  fieldSelectionMode: "all" | "subset";
  fieldSelectionFields: string;
  transformScript: string;
  transformTimeoutMs: number;
  filters: WorkflowFilterDraft[];
};

const createEmptyWorkflowFilter = (): WorkflowFilterDraft => ({
  id: createDraftId(),
  field: "",
  operator: "contains",
  value: "",
  caseSensitive: false,
});

const createEmptyWorkflowFormState = (): WorkflowFormState => ({
  name: "",
  description: "",
  enabled: true,
  trigger: "meeting.ingested",
  destinationUrl: "",
  destinationSigningSecret: "",
  destinationHeadersJson: "{}",
  fieldSelectionMode: "all",
  fieldSelectionFields: "",
  transformScript: "",
  transformTimeoutMs: 1000,
  filters: [],
});

const parseScalarWorkflowValue = (input: string): string | number | boolean | null => {
  const value = input.trim();
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return value;
};

const serializeWorkflowFilterValue = (value: unknown): string => {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  if (value === null) return "null";
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return JSON.stringify(value);
  }
  return "";
};

const resolveWorkspaceFathomConnection = (
  connections: FathomConnectionSummary[],
  preferredConnectionId: string | null
) =>
  (preferredConnectionId
    ? connections.find((connection) => connection.id === preferredConnectionId)
    : null) ||
  connections.find((connection) => connection.isPreferred) ||
  connections.find((connection) => connection.status === "active") ||
  null;

type WorkspaceMember = {
  membershipId: string;
  userId: string;
  name: string;
  email: string | null;
  avatarUrl: string | null;
  role: "owner" | "admin" | "member";
  status: "active" | "invited" | "suspended" | "left";
  joinedAt: string | null;
  updatedAt: string | null;
  isCurrentUser: boolean;
  isLastOwner: boolean;
  canEditRole: boolean;
  canRemove: boolean;
};

type WorkspaceMemberPermissions = {
  canInvite: boolean;
  canReadMembers: boolean;
  canUpdateMembers: boolean;
  canRemoveMembers: boolean;
};

type WorkspaceAdminAccess = {
  tasks: boolean;
  people: boolean;
  projects: boolean;
  chatSessions: boolean;
  boards: boolean;
  integrations: boolean;
};

const DEFAULT_WORKSPACE_ADMIN_ACCESS: WorkspaceAdminAccess = {
  tasks: true,
  people: true,
  projects: true,
  chatSessions: true,
  boards: true,
  integrations: true,
};

type SettingsSection = "profile" | "workspace" | "integrations" | "preferences" | "advanced";

const SETTINGS_SECTIONS: Array<{ value: SettingsSection; label: string }> = [
  { value: "profile", label: "Profile" },
  { value: "workspace", label: "Workspace" },
  { value: "integrations", label: "Integrations" },
  { value: "preferences", label: "Preferences" },
  { value: "advanced", label: "Advanced" },
];

const normalizeSettingsSection = (
  value: string | null,
  canAccessAdvanced: boolean
): SettingsSection => {
  const section = SETTINGS_SECTIONS.find((item) => item.value === value)?.value || "profile";
  if (section === "advanced" && !canAccessAdvanced) {
    return "profile";
  }
  return section;
};

const IntegrationCard: React.FC<{
  icon: React.ElementType;
  title: string;
  description: string;
  isConnected: boolean;
  isLoading: boolean;
  onConnect: () => void;
  onConnectDisabled?: boolean;
  onDisconnect: () => void;
  onDisconnectDisabled?: boolean;
  extraActions?: React.ReactNode;
  settingsAction?: {
    onClick: () => void;
    disabled?: boolean;
    ariaLabel?: string;
  };
  statusNote?: string | null;
}> = ({
  icon: Icon,
  title,
  description,
  isConnected,
  isLoading,
  onConnect,
  onConnectDisabled = false,
  onDisconnect,
  onDisconnectDisabled = false,
  extraActions,
  settingsAction,
  statusNote,
}) => {
  return (
    <div className="flex items-center justify-between p-4 rounded-lg bg-card border border-border/50 hover:border-primary/50 transition-colors">
      <div className="flex items-center gap-4">
        <div className="p-2 bg-background rounded-lg">
            <Icon className="h-8 w-8" />
        </div>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="font-semibold text-foreground">{title}</h4>
            <Badge variant={isConnected ? "secondary" : "outline"} className="text-[11px]">
              {isConnected ? "Connected" : "Not connected"}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">{description}</p>
          {statusNote ? (
            <p className="mt-1 text-xs text-muted-foreground">{statusNote}</p>
          ) : null}
          <p className="mt-1 text-xs text-muted-foreground">
            Next action: {isConnected ? "View details or disconnect" : "Connect this integration"}
          </p>
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
          {settingsAction && (
            <Button
              variant="ghost"
              size="icon"
              aria-label={settingsAction.ariaLabel || `${title} settings`}
              onClick={settingsAction.onClick}
              disabled={settingsAction.disabled}
            >
              <Settings2 className="h-4 w-4" />
            </Button>
          )}
          <Button
            variant="secondary"
            size="sm"
            onClick={onDisconnect}
            disabled={onDisconnectDisabled}
          >
            <PowerOff className="mr-2 h-4 w-4 text-red-500" />
            Disconnect
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          {settingsAction && (
            <Button
              variant="ghost"
              size="icon"
              aria-label={settingsAction.ariaLabel || `${title} settings`}
              onClick={settingsAction.onClick}
              disabled={settingsAction.disabled ?? true}
            >
              <Settings2 className="h-4 w-4" />
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={onConnect} disabled={onConnectDisabled}>
            <Power className="mr-2 h-4 w-4 text-green-500" />
            Connect
          </Button>
        </div>
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
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"member" | "admin">("member");
  const [workspaceInviteLink, setWorkspaceInviteLink] = useState("");
  const [isCreatingWorkspaceInvite, setIsCreatingWorkspaceInvite] = useState(false);
  const [hasCopiedWorkspaceInvite, setHasCopiedWorkspaceInvite] = useState(false);
  const [workspaceMembers, setWorkspaceMembers] = useState<WorkspaceMember[]>([]);
  const [workspaceMemberPermissions, setWorkspaceMemberPermissions] =
    useState<WorkspaceMemberPermissions>({
      canInvite: false,
      canReadMembers: false,
      canUpdateMembers: false,
      canRemoveMembers: false,
    });
  const [workspaceAdminAccess, setWorkspaceAdminAccess] = useState<WorkspaceAdminAccess>(
    DEFAULT_WORKSPACE_ADMIN_ACCESS
  );
  const [isLoadingWorkspaceMembers, setIsLoadingWorkspaceMembers] = useState(false);
  const [pendingWorkspaceMemberId, setPendingWorkspaceMemberId] = useState<string | null>(null);
  const [hasCopied, setHasCopied] = useState(false);
  const [autoApproveCompleted, setAutoApproveCompleted] = useState(false);
  const [completionMatchThreshold, setCompletionMatchThreshold] = useState(60);
  const [slackAutomationEnabled, setSlackAutomationEnabled] = useState(false);
  const [slackAutomationChannelId, setSlackAutomationChannelId] = useState("");
  const [slackChannels, setSlackChannels] = useState<SlackChannel[]>([]);
  const [isLoadingSlackChannels, setIsLoadingSlackChannels] = useState(false);
  const [isExportingTranscripts, setIsExportingTranscripts] = useState(false);
  
  const [isAvatarDialogOpen, setIsAvatarDialogOpen] = useState(false);
  const [selectedAvatarUrl, setSelectedAvatarUrl] = useState('');
  const [customAvatarUrl, setCustomAvatarUrl] = useState('');
  const randomSeed = useMemo(() => user?.uid || Math.random().toString(36).substring(7), [user]);
  const activeWorkspaceId = user?.activeWorkspaceId || user?.workspace?.id || "";
  const activeWorkspaceMembership = useMemo(
    () =>
      (user?.workspaceMemberships || []).find(
        (membership) => membership.workspaceId === activeWorkspaceId && membership.status === "active"
      ) || null,
    [user?.workspaceMemberships, activeWorkspaceId]
  );
  const canManageWorkspaceMembers =
    activeWorkspaceMembership?.role === "owner" || activeWorkspaceMembership?.role === "admin";
  const canManageWorkspaceSettings = canManageWorkspaceMembers;
  const integrationsBlockedForAdmin =
    activeWorkspaceMembership?.role === "admin" &&
    !!user?.activeWorkspaceAdminAccess &&
    !user.activeWorkspaceAdminAccess.integrations;
  const workspaceSlack = user?.workspaceIntegrations?.slack;
  const workspaceGoogle = user?.workspaceIntegrations?.google;
  const workspaceFathom = user?.workspaceIntegrations?.fathom;
  const [isGoogleIntegrationProviderAvailable, setIsGoogleIntegrationProviderAvailable] =
    useState<boolean | null>(null);
  const formatIntegrationOwner = (email: string | null | undefined) =>
    email || "another workspace admin";
  const slackStatusNote =
    workspaceSlack?.connected && !workspaceSlack.connectedByCurrentUser
      ? `Connected in this workspace by ${formatIntegrationOwner(
          workspaceSlack.connectedByEmail
        )}.`
      : null;
  const slackConnectedViaWorkspaceOnly =
    !!workspaceSlack?.connected &&
    !workspaceSlack?.connectedByCurrentUser &&
    !user?.slackTeamId;
  const workspaceGoogleStatusNote =
    workspaceGoogle?.connected && !workspaceGoogle.connectedByCurrentUser
      ? `Connected in this workspace by ${formatIntegrationOwner(
          workspaceGoogle.connectedByEmail
        )}.`
      : null;
  const googleProviderStatusNote =
    isGoogleIntegrationProviderAvailable === false
      ? `Google integration is not configured. Allow ${GOOGLE_INTEGRATION_LOCAL_CALLBACK_URL} locally and ${GOOGLE_INTEGRATION_PRODUCTION_CALLBACK_URL} in production.`
      : null;
  const googleStatusNote = [workspaceGoogleStatusNote, googleProviderStatusNote]
    .filter(Boolean)
    .join(" ")
    .trim();
  const fathomStatusNote =
    workspaceFathom?.connected && !workspaceFathom.connectedByCurrentUser
      ? `Connected in this workspace by ${formatIntegrationOwner(
          workspaceFathom.connectedByEmail
        )}.`
      : null;
  const canManageWorkspaceIntegrations =
    user?.activeWorkspaceRole === "owner" ||
    (user?.activeWorkspaceRole === "admin" &&
      Boolean(user?.activeWorkspaceAdminAccess?.integrations));
  const activeWorkspaceRole =
    user?.activeWorkspaceRole || activeWorkspaceMembership?.role || null;
  const canAccessAdvancedSettings =
    isAdvancedSettingsEnabled() &&
    (activeWorkspaceRole === "owner" || activeWorkspaceRole === "admin");
  const integrationCallbackSection =
    searchParams.get("slack_success") ||
    searchParams.get("trello_success") ||
    searchParams.get("google_success") ||
    searchParams.get("fathom_success") ||
    searchParams.get("fathom_webhook") ||
    searchParams.get("error")
      ? "integrations"
      : null;
  const activeSettingsSection = normalizeSettingsSection(
    searchParams.get("section") || integrationCallbackSection,
    canAccessAdvancedSettings
  );
  const handleSettingsSectionChange = (section: string) => {
    const normalized = normalizeSettingsSection(section, canAccessAdvancedSettings);
    router.replace(`/settings?section=${normalized}`, { scroll: false });
  };
  const canManageFathomConnection = (connection: FathomConnectionSummary) =>
    connection.canManage ?? canManageWorkspaceIntegrations;
  const isWorkspaceFathomConnected = Boolean(workspaceFathom?.connected);
  const fathomDisconnectDisabled =
    Boolean(workspaceFathom?.connected) &&
    !workspaceFathom?.connectedByCurrentUser &&
    !canManageWorkspaceIntegrations;
  const workspaceInviteInputRef = useRef<HTMLInputElement>(null);
  const webhookUrlInputRef = useRef<HTMLInputElement>(null);
  const [isCreatingFathomWebhook, setIsCreatingFathomWebhook] = useState(false);
  const [isGoogleLogsOpen, setIsGoogleLogsOpen] = useState(false);
  const [isLoadingGoogleLogs, setIsLoadingGoogleLogs] = useState(false);
  const [googleLogs, setGoogleLogs] = useState<
    Array<{
      id?: string;
      level: string;
      event: string;
      message: string;
      metadata?: Record<string, unknown> | null;
      createdAt: string;
      userId?: string | null;
      actorUserId?: string | null;
    }>
  >([]);
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
  const [isFathomSettingsOpen, setIsFathomSettingsOpen] = useState(false);
  const [isMcpSettingsOpen, setIsMcpSettingsOpen] = useState(false);
  const [fathomConnections, setFathomConnections] = useState<FathomConnectionSummary[]>([]);
  const [isLoadingFathomConnections, setIsLoadingFathomConnections] = useState(false);
  const [fathomWebhooks, setFathomWebhooks] = useState<any[]>([]);
  const [fathomWebhookUrl, setFathomWebhookUrl] = useState("");
  const [isLoadingFathomWebhooks, setIsLoadingFathomWebhooks] = useState(false);
  const [isDeletingFathomWebhooks, setIsDeletingFathomWebhooks] = useState(false);
  const [pendingFathomConnectionId, setPendingFathomConnectionId] = useState<string | null>(null);
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [isLoadingWorkflows, setIsLoadingWorkflows] = useState(false);
  const [pendingWorkflowId, setPendingWorkflowId] = useState<string | null>(null);
  const [expandedWorkflowId, setExpandedWorkflowId] = useState<string | null>(null);
  const [workflowFailuresById, setWorkflowFailuresById] = useState<
    Record<string, WorkflowDeliverySummary[]>
  >({});
  const [loadingWorkflowFailuresId, setLoadingWorkflowFailuresId] = useState<string | null>(null);
  const [pendingReplayDeliveryId, setPendingReplayDeliveryId] = useState<string | null>(null);
  const [isWorkflowEditorOpen, setIsWorkflowEditorOpen] = useState(false);
  const [workflowEditorMode, setWorkflowEditorMode] = useState<"create" | "edit">("create");
  const [editingWorkflowId, setEditingWorkflowId] = useState<string | null>(null);
  const [isLoadingWorkflowEditor, setIsLoadingWorkflowEditor] = useState(false);
  const [isSavingWorkflowEditor, setIsSavingWorkflowEditor] = useState(false);
  const [workflowForm, setWorkflowForm] = useState<WorkflowFormState>(() =>
    createEmptyWorkflowFormState()
  );
  const [isRunningWorkflowPlayground, setIsRunningWorkflowPlayground] = useState(false);
  const [workflowPlaygroundPreview, setWorkflowPlaygroundPreview] =
    useState<WorkflowPlaygroundPreviewResult | null>(null);
  const [workflowPlaygroundMeetingId, setWorkflowPlaygroundMeetingId] =
    useState<string>("");
  const [isSendingWorkflowPlaygroundTest, setIsSendingWorkflowPlaygroundTest] =
    useState(false);
  const [workflowPlaygroundTestResult, setWorkflowPlaygroundTestResult] =
    useState<{
      responseOk: boolean;
      responseStatusCode: number | null;
      deliveryId: string | null;
      deliveryStatus: string | null;
      message: string;
    } | null>(null);
  const [mcpApiKeys, setMcpApiKeys] = useState<McpApiKeySummary[]>([]);
  const [isLoadingMcpApiKeys, setIsLoadingMcpApiKeys] = useState(false);
  const [pendingMcpApiKeyId, setPendingMcpApiKeyId] = useState<string | null>(null);
  const [mcpKeyName, setMcpKeyName] = useState("Default MCP Key");
  const [mcpKeyDescription, setMcpKeyDescription] = useState("");
  const [mcpKeyAllowRead, setMcpKeyAllowRead] = useState(true);
  const [mcpKeyAllowWrite, setMcpKeyAllowWrite] = useState(false);
  const [isCreatingMcpApiKey, setIsCreatingMcpApiKey] = useState(false);
  const [newMcpApiKeySecret, setNewMcpApiKeySecret] = useState<string | null>(null);
  const [hasCopiedMcpSecret, setHasCopiedMcpSecret] = useState(false);
  const [hasCopiedMcpEndpoint, setHasCopiedMcpEndpoint] = useState(false);
  const [mcpAuditLogs, setMcpAuditLogs] = useState<McpAuditLogSummary[]>([]);
  const [isLoadingMcpAuditLogs, setIsLoadingMcpAuditLogs] = useState(false);
  const hasHandledOauthRedirect = useRef(false);
  const activeFathomConnection = useMemo(() => {
    return resolveWorkspaceFathomConnection(
      fathomConnections,
      workspaceFathom?.activeConnectionId || null
    );
  }, [fathomConnections, workspaceFathom?.activeConnectionId]);
  const mcpEndpointUrl = useMemo(() => {
    if (!activeWorkspaceId) return "";
    if (typeof window === "undefined") return "";
    return `${window.location.origin}/api/workspaces/${encodeURIComponent(
      activeWorkspaceId
    )}/mcp`;
  }, [activeWorkspaceId]);
  const canManageWorkflow = (workflow: WorkflowSummary) =>
    workflow.canManage ?? canManageWorkspaceIntegrations;
  const workflowFormFromDetail = useCallback((workflow: WorkflowDetail): WorkflowFormState => {
    return {
      name: workflow.name || "",
      description: workflow.description || "",
      enabled: Boolean(workflow.enabled),
      trigger: workflow.trigger,
      destinationUrl: workflow.destination?.url || "",
      destinationSigningSecret: workflow.destination?.signingSecret || "",
      destinationHeadersJson: JSON.stringify(workflow.destination?.headers || {}, null, 2),
      fieldSelectionMode:
        workflow.fieldSelection?.mode === "subset" ? "subset" : "all",
      fieldSelectionFields:
        workflow.fieldSelection?.fields?.join("\n") || "",
      transformScript: workflow.transform?.script || "",
      transformTimeoutMs:
        typeof workflow.transform?.timeoutMs === "number"
          ? workflow.transform.timeoutMs
          : 1000,
      filters: Array.isArray(workflow.filters)
        ? workflow.filters.map((filter) => ({
            id: createDraftId(),
            field: String(filter?.field || ""),
            operator:
              filter?.operator &&
              WORKFLOW_FILTER_OPERATOR_OPTIONS.some(
                (candidate) => candidate.value === filter.operator
              )
                ? filter.operator
                : "contains",
            value: serializeWorkflowFilterValue(filter?.value),
            caseSensitive: Boolean(filter?.caseSensitive),
          }))
        : [],
    };
  }, []);

  useEffect(() => {
    // This function will run when the component mounts and when searchParams change.
    const handleRedirect = async () => {
      if (hasHandledOauthRedirect.current) {
        return;
      }
      const slackSuccess = searchParams.get('slack_success');
      const trelloSuccess = searchParams.get('trello_success');
      const googleSuccess = searchParams.get('google_success');
      const fathomSuccess = searchParams.get('fathom_success');
      const fathomWebhook = searchParams.get('fathom_webhook');
      const fathomWebhookError = searchParams.get('fathom_webhook_error');
      const error = searchParams.get('error');
      const message = searchParams.get('message');

      const hasOauthParams = Boolean(
        slackSuccess || trelloSuccess || googleSuccess || fathomSuccess || fathomWebhook || error
      );
      if (!hasOauthParams) {
        return;
      }

      hasHandledOauthRedirect.current = true;
      router.replace('/settings', { scroll: false });
      
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
            description:
              fathomWebhookError ||
              "Please add the webhook URL in Fathom to enable automatic imports.",
            variant: "destructive",
          });
        }
      }
      else if (error) {
        const normalizedError = error.trim();
        const googleOauthErrors = new Set([
          "OAuthSignin",
          "OAuthCallback",
          "Configuration",
          "AccessDenied",
          "google-integration",
        ]);
        if (googleOauthErrors.has(normalizedError)) {
          const googleErrorMessage = resolveGoogleIntegrationOauthErrorMessage(
            normalizedError,
            message
          );
          if (activeWorkspaceId) {
            void fetch(
              `/api/workspaces/${encodeURIComponent(activeWorkspaceId)}/google/logs`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  level: "error",
                  event: "oauth.connect.failed",
                  message: googleErrorMessage,
                  metadata: {
                    errorCode: normalizedError,
                    source: "settings.redirect",
                  },
                }),
              }
            );
          }
          toast({
            title: "Google Workspace Connection Failed",
            description: googleErrorMessage,
            variant: "destructive",
          });
        } else {
          toast({
              title: `Connection Failed: ${error}`,
              description: message || "Please try again or contact support.",
              variant: "destructive",
          });
        }
      }
      
      if (needsRefresh) {
        await refreshUserProfile(); // Refresh the main user object
        await triggerTokenFetch();  // Refresh the integration-specific tokens
      }
    };
    
    handleRedirect();

  }, [searchParams, router, toast, triggerTokenFetch, refreshUserProfile, activeWorkspaceId]);

  useEffect(() => {
    let active = true;
    const loadGoogleIntegrationProviderAvailability = async () => {
      try {
        const response = await fetch("/api/auth/providers", { cache: "no-store" });
        const payload = await response.json().catch(() => ({}));
        if (!active) return;
        setIsGoogleIntegrationProviderAvailable(Boolean(payload?.["google-integration"]));
      } catch {
        if (!active) return;
        setIsGoogleIntegrationProviderAvailable(false);
      }
    };

    void loadGoogleIntegrationProviderAvailability();
    return () => {
      active = false;
    };
  }, []);


  useEffect(() => {
    if (user) {
      setDisplayName(user.displayName || '');
      setSelectedAvatarUrl(user.photoURL || '');
      setWorkspaceName(user.workspace?.name || '');
      setAutoApproveCompleted(Boolean(user.autoApproveCompletedTasks));
      const thresholdValue =
        typeof user.completionMatchThreshold === "number"
          ? Math.round(user.completionMatchThreshold * 100)
          : 60;
      setCompletionMatchThreshold(thresholdValue);
      setSlackAutomationEnabled(Boolean(user.slackAutoShareEnabled));
      setSlackAutomationChannelId(user.slackAutoShareChannelId || "");
      setWorkspaceAdminAccess({
        ...DEFAULT_WORKSPACE_ADMIN_ACCESS,
        ...(user.activeWorkspaceAdminAccess || {}),
      });
    }
  }, [user]);

  const loadSlackChannels = useCallback(
    async (showErrorToast = true): Promise<SlackChannel[]> => {
      if (!isSlackConnected) {
        setSlackChannels([]);
        return [];
      }
      if (slackConnectedViaWorkspaceOnly) {
        setSlackChannels([]);
        return [];
      }
      setIsLoadingSlackChannels(true);
      try {
        const response = await fetch("/api/slack/channels");
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload?.error || "Could not load Slack channels.");
        }
        const channels = Array.isArray(payload?.channels)
          ? (payload.channels as SlackChannel[])
          : [];
        setSlackChannels(channels);
        return channels;
      } catch (error) {
        console.error("Failed to fetch Slack channels:", error);
        const message =
          error instanceof Error
            ? error.message
            : "Could not load Slack channels.";
        if (showErrorToast) {
          toast({
            title: "Channel Load Failed",
            description: message,
            variant: "destructive",
          });
        }
        return [];
      } finally {
        setIsLoadingSlackChannels(false);
      }
    },
    [isSlackConnected, slackConnectedViaWorkspaceOnly, toast]
  );

  useEffect(() => {
    if (!isSlackConnected) {
      setSlackChannels([]);
      return;
    }
    void loadSlackChannels(false);
  }, [isSlackConnected, loadSlackChannels]);

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
      await updateUserProfile({
        workspace: {
          name: workspaceName.trim(),
          settings: {
            adminAccess: workspaceAdminAccess,
          },
        } as any,
      });
      toast({
        title: 'Workspace Updated',
        description: 'Workspace settings and admin visibility controls were saved.',
      });
    } catch (error) {
      console.error("Failed to save workspace:", error);
      toast({ title: 'Error', description: 'Could not save workspace settings.', variant: 'destructive' });
    } finally {
      setIsSavingWorkspace(false);
    }
  };

  const loadWorkspaceMembers = useCallback(
    async (showErrorToast = true) => {
      if (!activeWorkspaceId) {
        setWorkspaceMembers([]);
        setWorkspaceMemberPermissions({
          canInvite: false,
          canReadMembers: false,
          canUpdateMembers: false,
          canRemoveMembers: false,
        });
        return;
      }

      setIsLoadingWorkspaceMembers(true);
      try {
        const response = await fetch(`/api/workspaces/${activeWorkspaceId}/members`, {
          cache: "no-store",
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload?.error || "Could not load workspace members.");
        }

        setWorkspaceMembers(Array.isArray(payload?.members) ? payload.members : []);
        setWorkspaceMemberPermissions({
          canInvite: Boolean(payload?.permissions?.canInvite),
          canReadMembers: Boolean(payload?.permissions?.canReadMembers),
          canUpdateMembers: Boolean(payload?.permissions?.canUpdateMembers),
          canRemoveMembers: Boolean(payload?.permissions?.canRemoveMembers),
        });
      } catch (error) {
        setWorkspaceMembers([]);
        setWorkspaceMemberPermissions({
          canInvite: false,
          canReadMembers: false,
          canUpdateMembers: false,
          canRemoveMembers: false,
        });
        if (showErrorToast) {
          toast({
            title: "Member Load Failed",
            description:
              error instanceof Error
                ? error.message
                : "Could not load workspace members.",
            variant: "destructive",
          });
        }
      } finally {
        setIsLoadingWorkspaceMembers(false);
      }
    },
    [activeWorkspaceId, toast]
  );

  useEffect(() => {
    if (!activeWorkspaceMembership) {
      setWorkspaceMembers([]);
      setWorkspaceMemberPermissions({
        canInvite: false,
        canReadMembers: false,
        canUpdateMembers: false,
        canRemoveMembers: false,
      });
      return;
    }
    void loadWorkspaceMembers(false);
  }, [activeWorkspaceMembership, loadWorkspaceMembers]);

  const handleCreateWorkspaceInvite = async () => {
    if (!activeWorkspaceId) {
      toast({
        title: "No Active Workspace",
        description: "Select an active workspace before inviting members.",
        variant: "destructive",
      });
      return;
    }

    setIsCreatingWorkspaceInvite(true);
    try {
      const response = await fetch(`/api/workspaces/${activeWorkspaceId}/members/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invitedEmail: inviteEmail.trim() || null,
          role: inviteRole,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Could not create invite link.");
      }

      const invitationUrl = payload?.invitation?.invitationUrl || "";
      if (!invitationUrl) {
        throw new Error("Invite link was not returned.");
      }

      setWorkspaceInviteLink(invitationUrl);
      toast({
        title: "Invitation Created",
        description: "Share this link to let someone join your workspace.",
      });
      setInviteEmail("");
    } catch (error) {
      console.error("Failed to create workspace invitation:", error);
      toast({
        title: "Invite Failed",
        description:
          error instanceof Error ? error.message : "Could not create invite link.",
        variant: "destructive",
      });
    } finally {
      setIsCreatingWorkspaceInvite(false);
    }
  };

  const handleWorkspaceMemberRoleChange = async (
    membershipId: string,
    nextRole: "owner" | "admin" | "member"
  ) => {
    if (!activeWorkspaceId) return;
    setPendingWorkspaceMemberId(membershipId);
    try {
      const response = await fetch(
        `/api/workspaces/${activeWorkspaceId}/members/${membershipId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role: nextRole }),
        }
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Could not update member role.");
      }
      await Promise.all([loadWorkspaceMembers(false), refreshUserProfile()]);
      toast({
        title: "Member Updated",
        description: "Workspace member role has been updated.",
      });
    } catch (error) {
      toast({
        title: "Update Failed",
        description:
          error instanceof Error ? error.message : "Could not update member role.",
        variant: "destructive",
      });
    } finally {
      setPendingWorkspaceMemberId(null);
    }
  };

  const handleRemoveWorkspaceMember = async (membershipId: string) => {
    if (!activeWorkspaceId) return;
    setPendingWorkspaceMemberId(membershipId);
    try {
      const response = await fetch(
        `/api/workspaces/${activeWorkspaceId}/members/${membershipId}`,
        {
          method: "DELETE",
        }
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Could not remove workspace member.");
      }
      await Promise.all([loadWorkspaceMembers(false), refreshUserProfile()]);
      toast({
        title: "Member Removed",
        description: "The member has been removed from this workspace.",
      });
    } catch (error) {
      toast({
        title: "Removal Failed",
        description:
          error instanceof Error
            ? error.message
            : "Could not remove workspace member.",
        variant: "destructive",
      });
    } finally {
      setPendingWorkspaceMemberId(null);
    }
  };

  const handleCopyWorkspaceInvite = async () => {
    const value = workspaceInviteInputRef.current?.value || workspaceInviteLink;
    if (!value) return;

    try {
      await navigator.clipboard.writeText(value);
      setHasCopiedWorkspaceInvite(true);
      setTimeout(() => setHasCopiedWorkspaceInvite(false), 2500);
      toast({ title: "Copied!", description: "Workspace invite link copied." });
    } catch (error) {
      console.error("Failed to copy workspace invite link:", error);
      toast({
        title: "Copy Failed",
        description: "Could not copy invite link.",
        variant: "destructive",
      });
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

  const handleCompletionThresholdCommit = async (values: number[]) => {
    const nextValue = values[0];
    if (typeof nextValue !== "number") return;
    setCompletionMatchThreshold(nextValue);
    try {
      await updateUserProfile({ completionMatchThreshold: nextValue / 100 }, true);
      toast({
        title: "Completion Threshold Updated",
        description: `Minimum match set to ${nextValue}%.`,
      });
    } catch (error) {
      console.error("Failed to update completion threshold:", error);
      const fallback =
        typeof user?.completionMatchThreshold === "number"
          ? Math.round(user.completionMatchThreshold * 100)
          : 60;
      setCompletionMatchThreshold(fallback);
      toast({
        title: "Update Failed",
        description: "Could not update completion threshold.",
        variant: "destructive",
      });
    }
  };

  const handleSlackAutomationToggle = async (value: boolean) => {
    if (value && !isSlackConnected) {
      toast({
        title: "Slack Not Connected",
        description: "Connect Slack first, then enable meeting auto-sharing.",
        variant: "destructive",
      });
      return;
    }

    const previousEnabled = slackAutomationEnabled;
    const previousChannelId = slackAutomationChannelId;
    setSlackAutomationEnabled(value);

    let nextChannelId = slackAutomationChannelId;
    if (value && !nextChannelId) {
      const channels =
        slackChannels.length > 0 ? slackChannels : await loadSlackChannels();
      if (!channels.length) {
        setSlackAutomationEnabled(previousEnabled);
        setSlackAutomationChannelId(previousChannelId);
        toast({
          title: "No Channels Available",
          description:
            "No Slack channels were found. Add or unarchive a channel, then try again.",
          variant: "destructive",
        });
        return;
      }
      nextChannelId = channels[0].id;
      setSlackAutomationChannelId(nextChannelId);
    }

    try {
      await updateUserProfile(
        {
          slackAutoShareEnabled: value,
          slackAutoShareChannelId: nextChannelId || null,
        },
        true
      );
      toast({
        title: "Slack Automation Updated",
        description: value
          ? "New processed meetings will post summaries and action items to Slack."
          : "Slack auto-sharing for meetings has been turned off.",
      });
    } catch (error) {
      console.error("Failed to update Slack automation setting:", error);
      setSlackAutomationEnabled(previousEnabled);
      setSlackAutomationChannelId(previousChannelId);
      toast({
        title: "Update Failed",
        description: "Could not update Slack automation.",
        variant: "destructive",
      });
    }
  };

  const handleSlackAutomationChannelChange = async (channelId: string) => {
    const previousChannelId = slackAutomationChannelId;
    setSlackAutomationChannelId(channelId);
    try {
      await updateUserProfile({ slackAutoShareChannelId: channelId }, true);
      toast({
        title: "Slack Channel Saved",
        description: slackAutomationEnabled
          ? "New processed meetings will be shared to the selected channel."
          : "Channel saved. Enable Slack automation to start auto-sharing.",
      });
    } catch (error) {
      console.error("Failed to update Slack automation channel:", error);
      setSlackAutomationChannelId(previousChannelId);
      toast({
        title: "Update Failed",
        description: "Could not save Slack channel selection.",
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
      } catch {
        document.execCommand('copy');
        setHasCopied(true);
        setTimeout(() => setHasCopied(false), 2500);
        toast({ title: "Selected!", description: "URL selected. Press Ctrl+C to copy." });
      }
  };

  const copyTextToClipboard = async (
    value: string,
    input: {
      successTitle: string;
      successDescription: string;
      fallbackDescription: string;
      onSuccess?: () => void;
    }
  ) => {
    try {
      await navigator.clipboard.writeText(value);
      if (input.onSuccess) input.onSuccess();
      toast({
        title: input.successTitle,
        description: input.successDescription,
      });
    } catch (error) {
      console.error("Clipboard copy failed:", error);
      toast({
        title: "Copy failed",
        description: input.fallbackDescription,
        variant: "destructive",
      });
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

  const loadGoogleLogs = async () => {
    if (!activeWorkspaceId) {
      setGoogleLogs([]);
      return;
    }
    setIsLoadingGoogleLogs(true);
    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(activeWorkspaceId)}/google/logs?limit=200`,
        { cache: "no-store" }
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to load logs.");
      }
      setGoogleLogs(Array.isArray(payload?.logs) ? payload.logs : []);
    } catch (error) {
      console.error("Failed to load Google logs:", error);
      toast({
        title: "Could not load Google logs",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoadingGoogleLogs(false);
    }
  };

  const handleOpenGoogleLogs = async () => {
    setIsGoogleLogsOpen(true);
    await loadGoogleLogs();
  };

  const handleOpenFathomLogs = async () => {
    setIsFathomLogsOpen(true);
    await loadFathomLogs();
  };

  const loadFathomConnections = useCallback(
    async (showErrorToast = true): Promise<FathomConnectionSummary[]> => {
      if (!activeWorkspaceId) {
        setFathomConnections([]);
        return [];
      }

      setIsLoadingFathomConnections(true);
      try {
        const response = await fetch(
          `/api/workspaces/${encodeURIComponent(activeWorkspaceId)}/fathom/connections`,
          { cache: "no-store" }
        );
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload?.error || "Failed to load Fathom connections.");
        }
        const connections = Array.isArray(payload?.connections)
          ? (payload.connections as FathomConnectionSummary[])
          : [];
        setFathomConnections(connections);
        return connections;
      } catch (error) {
        console.error("Failed to load Fathom connections:", error);
        if (showErrorToast) {
          toast({
            title: "Could not load Fathom connections",
            description: error instanceof Error ? error.message : "Please try again.",
            variant: "destructive",
          });
        }
        return [];
      } finally {
        setIsLoadingFathomConnections(false);
      }
    },
    [activeWorkspaceId, toast]
  );

  const loadFathomWebhooks = useCallback(async () => {
    if (!activeWorkspaceId) {
      setFathomWebhooks([]);
      setFathomWebhookUrl("");
      return;
    }
    setIsLoadingFathomWebhooks(true);
    try {
      const connections = await loadFathomConnections(false);
      const selectedConnection = resolveWorkspaceFathomConnection(
        connections,
        workspaceFathom?.activeConnectionId || null
      );

      if (!selectedConnection) {
        setFathomWebhooks([]);
        setFathomWebhookUrl("");
        return;
      }

      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(
          activeWorkspaceId
        )}/fathom/connections/${encodeURIComponent(selectedConnection.id)}/webhooks`
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to load webhooks.");
      }

      setFathomWebhooks(Array.isArray(payload?.webhooks) ? payload.webhooks : []);
      setFathomWebhookUrl(
        typeof payload?.webhookUrl === "string"
          ? payload.webhookUrl
          : selectedConnection.webhook?.webhookUrl || ""
      );
    } catch (error) {
      console.error("Failed to load Fathom webhooks:", error);
      toast({
        title: "Could not load webhooks",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
      setFathomWebhooks([]);
      setFathomWebhookUrl("");
    } finally {
      setIsLoadingFathomWebhooks(false);
    }
  }, [activeWorkspaceId, loadFathomConnections, toast, workspaceFathom?.activeConnectionId]);

  const loadWorkflows = useCallback(
    async (showErrorToast = true): Promise<WorkflowSummary[]> => {
      if (!activeWorkspaceId) {
        setWorkflows([]);
        setWorkflowFailuresById({});
        setExpandedWorkflowId(null);
        return [];
      }
      setIsLoadingWorkflows(true);
      try {
        const response = await fetch(
          `/api/workspaces/${encodeURIComponent(activeWorkspaceId)}/automation/workflows`,
          { cache: "no-store" }
        );
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload?.error || "Failed to load workflows.");
        }
        const nextWorkflows = Array.isArray(payload?.workflows)
          ? (payload.workflows as WorkflowSummary[])
          : [];
        setWorkflows(nextWorkflows);
        setWorkflowFailuresById((previous) => {
          const next: Record<string, WorkflowDeliverySummary[]> = {};
          nextWorkflows.forEach((workflow) => {
            if (previous[workflow.id]) {
              next[workflow.id] = previous[workflow.id];
            }
          });
          return next;
        });
        setExpandedWorkflowId((current) =>
          current && !nextWorkflows.some((workflow) => workflow.id === current) ? null : current
        );
        return nextWorkflows;
      } catch (error) {
        console.error("Failed to load automation workflows:", error);
        if (showErrorToast) {
          toast({
            title: "Could not load workflows",
            description: error instanceof Error ? error.message : "Please try again.",
            variant: "destructive",
          });
        }
        return [];
      } finally {
        setIsLoadingWorkflows(false);
      }
    },
    [activeWorkspaceId, toast]
  );

  const loadMcpApiKeys = useCallback(
    async (showErrorToast = true): Promise<McpApiKeySummary[]> => {
      if (!activeWorkspaceId) {
        setMcpApiKeys([]);
        return [];
      }

      setIsLoadingMcpApiKeys(true);
      try {
        const response = await fetch(
          `/api/workspaces/${encodeURIComponent(activeWorkspaceId)}/mcp/keys`,
          {
            cache: "no-store",
          }
        );
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload?.error || "Failed to load MCP API keys.");
        }
        const keys = Array.isArray(payload?.keys) ? (payload.keys as McpApiKeySummary[]) : [];
        setMcpApiKeys(keys);
        return keys;
      } catch (error) {
        console.error("Failed to load MCP API keys:", error);
        if (showErrorToast) {
          toast({
            title: "Could not load MCP keys",
            description: error instanceof Error ? error.message : "Please try again.",
            variant: "destructive",
          });
        }
        setMcpApiKeys([]);
        return [];
      } finally {
        setIsLoadingMcpApiKeys(false);
      }
    },
    [activeWorkspaceId, toast]
  );

  const loadMcpAuditLogs = useCallback(
    async (showErrorToast = true): Promise<McpAuditLogSummary[]> => {
      if (!activeWorkspaceId) {
        setMcpAuditLogs([]);
        return [];
      }

      setIsLoadingMcpAuditLogs(true);
      try {
        const response = await fetch(
          `/api/workspaces/${encodeURIComponent(activeWorkspaceId)}/mcp/audit-logs?limit=20`,
          {
            cache: "no-store",
          }
        );
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload?.error || "Failed to load MCP audit logs.");
        }
        const logs = Array.isArray(payload?.logs) ? (payload.logs as McpAuditLogSummary[]) : [];
        setMcpAuditLogs(logs);
        return logs;
      } catch (error) {
        console.error("Failed to load MCP audit logs:", error);
        if (showErrorToast) {
          toast({
            title: "Could not load MCP logs",
            description: error instanceof Error ? error.message : "Please try again.",
            variant: "destructive",
          });
        }
        setMcpAuditLogs([]);
        return [];
      } finally {
        setIsLoadingMcpAuditLogs(false);
      }
    },
    [activeWorkspaceId, toast]
  );

  const loadWorkflowFailures = useCallback(
    async (
      workflowId: string,
      showErrorToast = true
    ): Promise<WorkflowDeliverySummary[]> => {
      if (!activeWorkspaceId) {
        return [];
      }
      setLoadingWorkflowFailuresId(workflowId);
      try {
        const response = await fetch(
          `/api/workspaces/${encodeURIComponent(
            activeWorkspaceId
          )}/automation/workflows/${encodeURIComponent(
            workflowId
          )}/deliveries?status=failed&limit=10`,
          { cache: "no-store" }
        );
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload?.error || "Failed to load failed deliveries.");
        }
        const deliveries = Array.isArray(payload?.deliveries)
          ? (payload.deliveries as WorkflowDeliverySummary[])
          : [];
        setWorkflowFailuresById((current) => ({
          ...current,
          [workflowId]: deliveries,
        }));
        return deliveries;
      } catch (error) {
        console.error("Failed to load workflow failures:", error);
        if (showErrorToast) {
          toast({
            title: "Could not load failed deliveries",
            description: error instanceof Error ? error.message : "Please try again.",
            variant: "destructive",
          });
        }
        return [];
      } finally {
        setLoadingWorkflowFailuresId((current) => (current === workflowId ? null : current));
      }
    },
    [activeWorkspaceId, toast]
  );

  const handleOpenMcpSettings = async () => {
    setIsMcpSettingsOpen(true);
    setNewMcpApiKeySecret(null);
    await Promise.all([loadMcpApiKeys(), loadMcpAuditLogs()]);
  };

  const handleCreateMcpApiKey = async () => {
    if (!activeWorkspaceId) {
      return;
    }
    if (!canManageWorkspaceIntegrations) {
      toast({
        title: "Permission required",
        description: "Only workspace integration admins can create MCP keys.",
        variant: "destructive",
      });
      return;
    }

    const name = mcpKeyName.trim();
    if (!name) {
      toast({
        title: "Missing key name",
        description: "Enter a name so your team can identify this key later.",
        variant: "destructive",
      });
      return;
    }

    const scopes: string[] = [];
    if (mcpKeyAllowRead) scopes.push("mcp:read");
    if (mcpKeyAllowWrite) scopes.push("mcp:write");
    if (!scopes.length) {
      toast({
        title: "Select at least one scope",
        description: "Enable read and/or write access for this MCP key.",
        variant: "destructive",
      });
      return;
    }

    setIsCreatingMcpApiKey(true);
    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(activeWorkspaceId)}/mcp/keys`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            description: mcpKeyDescription.trim() || null,
            scopes,
          }),
        }
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to create MCP key.");
      }

      const apiKey = typeof payload?.apiKey === "string" ? payload.apiKey : "";
      if (!apiKey) {
        throw new Error("Key was created, but secret token was not returned.");
      }

      setNewMcpApiKeySecret(apiKey);
      setHasCopiedMcpSecret(false);
      setMcpKeyName("Default MCP Key");
      setMcpKeyDescription("");
      setMcpKeyAllowRead(true);
      setMcpKeyAllowWrite(false);

      await Promise.all([loadMcpApiKeys(false), loadMcpAuditLogs(false)]);
      toast({
        title: "MCP key created",
        description: "Copy the secret now. You won't be able to view it again.",
      });
    } catch (error) {
      console.error("Failed to create MCP key:", error);
      toast({
        title: "Could not create key",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsCreatingMcpApiKey(false);
    }
  };

  const handleRevokeMcpApiKey = async (key: McpApiKeySummary) => {
    if (!activeWorkspaceId) return;
    if (!canManageWorkspaceIntegrations) {
      toast({
        title: "Permission required",
        description: "Only workspace integration admins can revoke MCP keys.",
        variant: "destructive",
      });
      return;
    }
    if (key.status === "revoked") return;

    const confirmed = window.confirm(`Revoke MCP key "${key.name}"?`);
    if (!confirmed) return;

    setPendingMcpApiKeyId(key.id);
    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(activeWorkspaceId)}/mcp/keys/${encodeURIComponent(
          key.id
        )}`,
        { method: "DELETE" }
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to revoke MCP key.");
      }
      await Promise.all([loadMcpApiKeys(false), loadMcpAuditLogs(false)]);
      toast({
        title: "MCP key revoked",
        description: `${key.name} can no longer access the MCP endpoint.`,
      });
    } catch (error) {
      console.error("Failed to revoke MCP key:", error);
      toast({
        title: "Could not revoke key",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setPendingMcpApiKeyId(null);
    }
  };

  const handleCopyMcpEndpoint = async () => {
    if (!mcpEndpointUrl) return;
    await copyTextToClipboard(mcpEndpointUrl, {
      successTitle: "Endpoint copied",
      successDescription: "MCP endpoint URL copied to clipboard.",
      fallbackDescription: "Copy the endpoint URL manually.",
      onSuccess: () => {
        setHasCopiedMcpEndpoint(true);
        setTimeout(() => setHasCopiedMcpEndpoint(false), 2500);
      },
    });
  };

  const handleCopyMcpSecret = async () => {
    if (!newMcpApiKeySecret) return;
    await copyTextToClipboard(newMcpApiKeySecret, {
      successTitle: "Secret copied",
      successDescription: "MCP key secret copied to clipboard.",
      fallbackDescription: "Copy the key secret manually.",
      onSuccess: () => {
        setHasCopiedMcpSecret(true);
        setTimeout(() => setHasCopiedMcpSecret(false), 2500);
      },
    });
  };

  useEffect(() => {
    if (!isWorkspaceFathomConnected || !activeWorkspaceId) {
      setFathomConnections([]);
      setFathomWebhooks([]);
      setFathomWebhookUrl("");
      setWorkflows([]);
      setWorkflowFailuresById({});
      setExpandedWorkflowId(null);
      return;
    }
    void loadFathomConnections(false);
  }, [activeWorkspaceId, isWorkspaceFathomConnected, loadFathomConnections]);

  useEffect(() => {
    if (!activeWorkspaceId) {
      setMcpApiKeys([]);
      setMcpAuditLogs([]);
      setNewMcpApiKeySecret(null);
      return;
    }
    if (isMcpSettingsOpen) {
      void loadMcpApiKeys(false);
      void loadMcpAuditLogs(false);
    }
  }, [activeWorkspaceId, isMcpSettingsOpen, loadMcpApiKeys, loadMcpAuditLogs]);

  const handleOpenFathomSettings = async () => {
    setIsFathomSettingsOpen(true);
    await Promise.all([loadFathomWebhooks(), loadWorkflows()]);
  };

  const handleWorkflowEditorOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && isSavingWorkflowEditor) {
      return;
    }
    setIsWorkflowEditorOpen(nextOpen);
    if (!nextOpen) {
      setEditingWorkflowId(null);
      setWorkflowEditorMode("create");
      setIsLoadingWorkflowEditor(false);
      setWorkflowForm(createEmptyWorkflowFormState());
      setWorkflowPlaygroundPreview(null);
      setWorkflowPlaygroundMeetingId("");
      setWorkflowPlaygroundTestResult(null);
    }
  };

  const handleOpenCreateWorkflowEditor = () => {
    if (!canManageWorkspaceIntegrations) {
      toast({
        title: "Permission required",
        description: "Only workspace integration admins can create workflows.",
        variant: "destructive",
      });
      return;
    }
    setWorkflowEditorMode("create");
    setEditingWorkflowId(null);
    setWorkflowForm(createEmptyWorkflowFormState());
    setIsLoadingWorkflowEditor(false);
    setWorkflowPlaygroundPreview(null);
    setWorkflowPlaygroundMeetingId("");
    setWorkflowPlaygroundTestResult(null);
    setIsWorkflowEditorOpen(true);
  };

  const handleOpenEditWorkflowEditor = async (workflow: WorkflowSummary) => {
    if (!activeWorkspaceId) {
      return;
    }
    if (!canManageWorkflow(workflow)) {
      toast({
        title: "Permission required",
        description: "Only workspace integration admins can edit workflows.",
        variant: "destructive",
      });
      return;
    }

    setWorkflowEditorMode("edit");
    setEditingWorkflowId(workflow.id);
    setIsLoadingWorkflowEditor(true);
    setWorkflowPlaygroundPreview(null);
    setWorkflowPlaygroundMeetingId("");
    setWorkflowPlaygroundTestResult(null);
    setIsWorkflowEditorOpen(true);
    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(
          activeWorkspaceId
        )}/automation/workflows/${encodeURIComponent(workflow.id)}`,
        { cache: "no-store" }
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to load workflow details.");
      }
      const detail = payload?.workflow as WorkflowDetail | undefined;
      if (!detail?.id) {
        throw new Error("Workflow details were not returned.");
      }
      setWorkflowForm(workflowFormFromDetail(detail));
    } catch (error) {
      console.error("Failed to load workflow details:", error);
      toast({
        title: "Workflow Load Failed",
        description: error instanceof Error ? error.message : "Could not load workflow details.",
        variant: "destructive",
      });
      setIsWorkflowEditorOpen(false);
      setEditingWorkflowId(null);
      setWorkflowEditorMode("create");
      setWorkflowForm(createEmptyWorkflowFormState());
    } finally {
      setIsLoadingWorkflowEditor(false);
    }
  };

  const handleWorkflowFilterChange = (
    filterId: string,
    patch: Partial<WorkflowFilterDraft>
  ) => {
    setWorkflowForm((current) => ({
      ...current,
      filters: current.filters.map((filter) =>
        filter.id === filterId ? { ...filter, ...patch } : filter
      ),
    }));
  };

  const handleAddWorkflowFilter = () => {
    setWorkflowForm((current) => ({
      ...current,
      filters: [...current.filters, createEmptyWorkflowFilter()],
    }));
  };

  const handleRemoveWorkflowFilter = (filterId: string) => {
    setWorkflowForm((current) => ({
      ...current,
      filters: current.filters.filter((filter) => filter.id !== filterId),
    }));
  };

  const buildWorkflowPayloadFromForm = useCallback(() => {
    const name = workflowForm.name.trim();
    if (!name) {
      throw new Error("Workflow name is required.");
    }

    const destinationUrl = workflowForm.destinationUrl.trim();
    if (!destinationUrl) {
      throw new Error("Destination webhook URL is required.");
    }

    const headersInput = workflowForm.destinationHeadersJson.trim();
    let destinationHeaders: Record<string, string> = {};
    if (headersInput) {
      let parsedHeaders: unknown;
      try {
        parsedHeaders = JSON.parse(headersInput);
      } catch {
        throw new Error("Destination headers must be valid JSON.");
      }
      if (
        typeof parsedHeaders !== "object" ||
        parsedHeaders === null ||
        Array.isArray(parsedHeaders)
      ) {
        throw new Error("Destination headers must be a JSON object.");
      }
      destinationHeaders = Object.entries(parsedHeaders as Record<string, unknown>).reduce<
        Record<string, string>
      >((acc, [key, value]) => {
        const normalizedKey = String(key || "").trim();
        if (!normalizedKey) return acc;
        if (value === null || value === undefined) return acc;
        acc[normalizedKey] = typeof value === "string" ? value : String(value);
        return acc;
      }, {});
    }

    const parsedFilters = workflowForm.filters.map((filter, index) => {
      const field = filter.field.trim();
      if (!field) {
        throw new Error(`Filter ${index + 1} requires a field.`);
      }

      const operator = filter.operator;
      const requiresNoValue = WORKFLOW_FILTER_OPERATORS_WITHOUT_VALUE.has(operator);
      const expectsArrayValue = WORKFLOW_FILTER_OPERATORS_WITH_ARRAY_VALUE.has(operator);
      if (requiresNoValue) {
        return {
          field,
          operator,
          ...(filter.caseSensitive ? { caseSensitive: true } : {}),
        };
      }

      const rawValue = filter.value.trim();
      if (!rawValue) {
        throw new Error(`Filter ${index + 1} requires a value.`);
      }

      let parsedValue:
        | string
        | number
        | boolean
        | null
        | Array<string | number | boolean>;

      if (expectsArrayValue) {
        if (rawValue.startsWith("[")) {
          let parsedArray: unknown;
          try {
            parsedArray = JSON.parse(rawValue);
          } catch {
            throw new Error(
              `Filter ${index + 1} expects an array. Use JSON like ["alpha","beta"].`
            );
          }
          if (
            !Array.isArray(parsedArray) ||
            parsedArray.some(
              (value) =>
                typeof value !== "string" &&
                typeof value !== "number" &&
                typeof value !== "boolean"
            )
          ) {
            throw new Error(
              `Filter ${index + 1} array values must be string, number, or boolean.`
            );
          }
          parsedValue = parsedArray as Array<string | number | boolean>;
        } else {
          const values = rawValue
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean)
            .map((value) => parseScalarWorkflowValue(value))
            .filter((value): value is string | number | boolean => value !== null);
          if (!values.length) {
            throw new Error(`Filter ${index + 1} list value cannot be empty.`);
          }
          parsedValue = values;
        }
      } else {
        parsedValue = parseScalarWorkflowValue(rawValue);
      }

      return {
        field,
        operator,
        value: parsedValue,
        ...(filter.caseSensitive ? { caseSensitive: true } : {}),
      };
    });

    const fieldSelectionFields =
      workflowForm.fieldSelectionMode === "subset"
        ? workflowForm.fieldSelectionFields
            .split(/\r?\n|,/)
            .map((field) => field.trim())
            .filter(Boolean)
        : [];

    if (workflowForm.fieldSelectionMode === "subset" && fieldSelectionFields.length === 0) {
      throw new Error("Add at least one field when selection mode is subset.");
    }

    const timeoutMs = Number.parseInt(String(workflowForm.transformTimeoutMs || 1000), 10);
    const safeTimeoutMs = Number.isFinite(timeoutMs)
      ? Math.min(10_000, Math.max(100, timeoutMs))
      : 1000;

    return {
      name,
      description: workflowForm.description.trim() || null,
      enabled: workflowForm.enabled,
      trigger: workflowForm.trigger,
      filters: parsedFilters,
      fieldSelection: {
        mode: workflowForm.fieldSelectionMode,
        fields: fieldSelectionFields,
      },
      transform: {
        runtime: "quickjs" as const,
        script: workflowForm.transformScript.trim() || null,
        timeoutMs: safeTimeoutMs,
      },
      destination: {
        type: "webhook" as const,
        url: destinationUrl,
        signingSecret: workflowForm.destinationSigningSecret.trim() || null,
        headers: destinationHeaders,
      },
    };
  }, [workflowForm]);

  const handleRunWorkflowPlayground = async (input: { previewMeetingId?: string } = {}) => {
    if (!activeWorkspaceId) {
      return;
    }

    const previewMeetingId = input.previewMeetingId || workflowPlaygroundMeetingId || null;
    setIsRunningWorkflowPlayground(true);
    setWorkflowPlaygroundTestResult(null);
    try {
      const payload = buildWorkflowPayloadFromForm();
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(
          activeWorkspaceId
        )}/automation/workflows/playground/preview`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workflow: {
              trigger: payload.trigger,
              filters: payload.filters,
              fieldSelection: payload.fieldSelection,
              transform: payload.transform,
            },
            previewMeetingId,
            meetingLimit: 12,
          }),
        }
      );
      const responsePayload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(responsePayload?.error || "Failed to run workflow playground.");
      }

      const preview = responsePayload as WorkflowPlaygroundPreviewResult;
      setWorkflowPlaygroundPreview(preview);
      setWorkflowPlaygroundMeetingId(preview.selectedMeeting?.id || "");
    } catch (error) {
      console.error("Failed to run workflow playground:", error);
      setWorkflowPlaygroundPreview(null);
      toast({
        title: "Playground Failed",
        description: error instanceof Error ? error.message : "Could not run workflow preview.",
        variant: "destructive",
      });
    } finally {
      setIsRunningWorkflowPlayground(false);
    }
  };

  const handleWorkflowPlaygroundMeetingChange = async (meetingId: string) => {
    setWorkflowPlaygroundMeetingId(meetingId);
    await handleRunWorkflowPlayground({ previewMeetingId: meetingId });
  };

  const handleSendWorkflowPlaygroundTestDelivery = async () => {
    if (!activeWorkspaceId || !editingWorkflowId) {
      return;
    }

    setIsSendingWorkflowPlaygroundTest(true);
    try {
      const payload = buildWorkflowPayloadFromForm();
      const previewPayload =
        workflowPlaygroundPreview?.transformOutput ??
        workflowPlaygroundPreview?.selectedPayload ??
        null;
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(
          activeWorkspaceId
        )}/automation/workflows/${encodeURIComponent(editingWorkflowId)}/test`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            eventType: payload.trigger,
            payload: previewPayload,
          }),
        }
      );
      const responsePayload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(responsePayload?.error || "Failed to send test delivery.");
      }
      setWorkflowPlaygroundTestResult({
        responseOk: Boolean(responsePayload?.responseOk),
        responseStatusCode:
          typeof responsePayload?.responseStatusCode === "number"
            ? responsePayload.responseStatusCode
            : null,
        deliveryId: responsePayload?.delivery?.id || null,
        deliveryStatus: responsePayload?.delivery?.status || null,
        message: responsePayload?.responseOk
          ? "Test delivery completed successfully."
          : "Test delivery failed. Check response status and destination logs.",
      });
      toast({
        title: "Test Delivery Sent",
        description: responsePayload?.responseOk
          ? "Destination acknowledged test delivery."
          : "Destination returned a non-success response.",
      });
    } catch (error) {
      console.error("Failed to send workflow playground test delivery:", error);
      setWorkflowPlaygroundTestResult({
        responseOk: false,
        responseStatusCode: null,
        deliveryId: null,
        deliveryStatus: null,
        message: error instanceof Error ? error.message : "Could not send test delivery.",
      });
      toast({
        title: "Test Delivery Failed",
        description: error instanceof Error ? error.message : "Could not send test delivery.",
        variant: "destructive",
      });
    } finally {
      setIsSendingWorkflowPlaygroundTest(false);
    }
  };

  const handleSaveWorkflowEditor = async () => {
    if (!activeWorkspaceId) {
      return;
    }

    setIsSavingWorkflowEditor(true);
    try {
      const payload = buildWorkflowPayloadFromForm();
      const isEditMode = workflowEditorMode === "edit" && Boolean(editingWorkflowId);
      const endpoint = isEditMode
        ? `/api/workspaces/${encodeURIComponent(
            activeWorkspaceId
          )}/automation/workflows/${encodeURIComponent(editingWorkflowId || "")}`
        : `/api/workspaces/${encodeURIComponent(activeWorkspaceId)}/automation/workflows`;
      const response = await fetch(endpoint, {
        method: isEditMode ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const responsePayload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(responsePayload?.error || "Failed to save workflow.");
      }

      const savedWorkflow = responsePayload?.workflow as WorkflowSummary | undefined;
      await loadWorkflows(false);
      if (savedWorkflow?.id && expandedWorkflowId === savedWorkflow.id) {
        await loadWorkflowFailures(savedWorkflow.id, false);
      }

      toast({
        title: isEditMode ? "Workflow Updated" : "Workflow Created",
        description: `${payload.name} was ${isEditMode ? "updated" : "created"} successfully.`,
      });
      setIsWorkflowEditorOpen(false);
      setEditingWorkflowId(null);
      setWorkflowEditorMode("create");
      setWorkflowForm(createEmptyWorkflowFormState());
      setWorkflowPlaygroundPreview(null);
      setWorkflowPlaygroundMeetingId("");
      setWorkflowPlaygroundTestResult(null);
    } catch (error) {
      console.error("Failed to save workflow:", error);
      toast({
        title: "Workflow Save Failed",
        description: error instanceof Error ? error.message : "Could not save workflow.",
        variant: "destructive",
      });
    } finally {
      setIsSavingWorkflowEditor(false);
    }
  };

  const handleToggleWorkflowEnabled = async (workflow: WorkflowSummary) => {
    if (!activeWorkspaceId) {
      return;
    }
    if (!canManageWorkflow(workflow)) {
      toast({
        title: "Permission required",
        description: "Only workspace integration admins can update workflows.",
        variant: "destructive",
      });
      return;
    }

    const nextEnabled = !workflow.enabled;
    setPendingWorkflowId(workflow.id);
    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(
          activeWorkspaceId
        )}/automation/workflows/${encodeURIComponent(workflow.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: nextEnabled }),
        }
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to update workflow.");
      }

      const updatedWorkflow = payload?.workflow as WorkflowSummary | undefined;
      if (updatedWorkflow?.id) {
        setWorkflows((current) =>
          current.map((item) => (item.id === updatedWorkflow.id ? updatedWorkflow : item))
        );
      }
      toast({
        title: nextEnabled ? "Workflow Enabled" : "Workflow Disabled",
        description: `${workflow.name} is now ${nextEnabled ? "active" : "paused"}.`,
      });
    } catch (error) {
      console.error("Failed to update workflow status:", error);
      toast({
        title: "Workflow Update Failed",
        description: error instanceof Error ? error.message : "Could not update workflow.",
        variant: "destructive",
      });
    } finally {
      setPendingWorkflowId((current) => (current === workflow.id ? null : current));
    }
  };

  const handleToggleWorkflowFailures = async (workflow: WorkflowSummary) => {
    if (expandedWorkflowId === workflow.id) {
      setExpandedWorkflowId(null);
      return;
    }
    setExpandedWorkflowId(workflow.id);
    if (!workflowFailuresById[workflow.id]) {
      await loadWorkflowFailures(workflow.id);
    }
  };

  const handleReplayWorkflowDelivery = async (
    workflow: WorkflowSummary,
    delivery: WorkflowDeliverySummary
  ) => {
    if (!activeWorkspaceId) {
      return;
    }
    if (!canManageWorkflow(workflow)) {
      toast({
        title: "Permission required",
        description: "Only workspace integration admins can replay deliveries.",
        variant: "destructive",
      });
      return;
    }
    setPendingReplayDeliveryId(delivery.id);
    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(
          activeWorkspaceId
        )}/automation/workflows/${encodeURIComponent(
          workflow.id
        )}/deliveries/${encodeURIComponent(delivery.id)}/replay`,
        {
          method: "POST",
        }
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to replay delivery.");
      }
      toast({
        title: "Delivery Replayed",
        description: "A replay delivery was queued for this workflow.",
      });
      await Promise.all([
        loadWorkflowFailures(workflow.id, false),
        loadWorkflows(false),
      ]);
    } catch (error) {
      console.error("Failed to replay workflow delivery:", error);
      toast({
        title: "Replay Failed",
        description: error instanceof Error ? error.message : "Could not replay delivery.",
        variant: "destructive",
      });
    } finally {
      setPendingReplayDeliveryId((current) => (current === delivery.id ? null : current));
    }
  };

  const handleSelectFathomConnection = async (connection: FathomConnectionSummary) => {
    if (!activeWorkspaceId) {
      return;
    }
    if (!canManageFathomConnection(connection)) {
      toast({
        title: "Permission required",
        description: "Only workspace integration admins can switch the active connection.",
        variant: "destructive",
      });
      return;
    }
    setPendingFathomConnectionId(connection.id);
    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(
          activeWorkspaceId
        )}/fathom/connections/${encodeURIComponent(connection.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ setPreferred: true }),
        }
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to set active connection.");
      }
      toast({
        title: "Active Connection Updated",
        description: `${connection.label} is now the workspace connection used for Fathom actions.`,
      });
      await refreshUserProfile();
      await triggerTokenFetch();
      await loadFathomConnections(false);
      await loadFathomWebhooks();
    } catch (error) {
      console.error("Failed to set preferred Fathom connection:", error);
      toast({
        title: "Update Failed",
        description: error instanceof Error ? error.message : "Could not set active connection.",
        variant: "destructive",
      });
    } finally {
      setPendingFathomConnectionId(null);
    }
  };

  const handleRenameFathomConnection = async (connection: FathomConnectionSummary) => {
    if (!activeWorkspaceId) {
      return;
    }
    if (!canManageFathomConnection(connection)) {
      toast({
        title: "Permission required",
        description: "Only workspace integration admins can rename this connection.",
        variant: "destructive",
      });
      return;
    }
    const nextLabel = window.prompt("Rename Fathom connection", connection.label)?.trim();
    if (!nextLabel || nextLabel === connection.label) {
      return;
    }

    setPendingFathomConnectionId(connection.id);
    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(
          activeWorkspaceId
        )}/fathom/connections/${encodeURIComponent(connection.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ label: nextLabel }),
        }
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to rename connection.");
      }
      toast({
        title: "Connection Renamed",
        description: `Updated to "${nextLabel}".`,
      });
      await refreshUserProfile();
      await loadFathomConnections(false);
      await loadFathomWebhooks();
    } catch (error) {
      console.error("Failed to rename Fathom connection:", error);
      toast({
        title: "Rename Failed",
        description: error instanceof Error ? error.message : "Could not rename connection.",
        variant: "destructive",
      });
    } finally {
      setPendingFathomConnectionId(null);
    }
  };

  const handleReconnectFathomConnection = (connection: FathomConnectionSummary) => {
    if (!canManageFathomConnection(connection)) {
      toast({
        title: "Permission required",
        description: "Only workspace integration admins can reconnect this connection.",
        variant: "destructive",
      });
      return;
    }
    connectFathom({ connectionId: connection.id, label: connection.label });
  };

  const handleDisconnectFathomConnection = async (connection: FathomConnectionSummary) => {
    if (!activeWorkspaceId) {
      return;
    }
    if (!canManageFathomConnection(connection)) {
      toast({
        title: "Permission required",
        description: "Only workspace integration admins can disconnect this connection.",
        variant: "destructive",
      });
      return;
    }
    const confirmed = window.confirm(
      `Disconnect "${connection.label}" from this workspace? This revokes its Fathom webhooks.`
    );
    if (!confirmed) {
      return;
    }

    setPendingFathomConnectionId(connection.id);
    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(
          activeWorkspaceId
        )}/fathom/connections/${encodeURIComponent(connection.id)}`,
        {
          method: "DELETE",
        }
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to disconnect connection.");
      }
      toast({
        title: "Connection Disconnected",
        description: `${connection.label} was disconnected.`,
      });
      await refreshUserProfile();
      await triggerTokenFetch();
      await loadFathomConnections(false);
      await loadFathomWebhooks();
    } catch (error) {
      console.error("Failed to disconnect Fathom connection:", error);
      toast({
        title: "Disconnect Failed",
        description: error instanceof Error ? error.message : "Could not disconnect connection.",
        variant: "destructive",
      });
    } finally {
      setPendingFathomConnectionId(null);
    }
  };

  const handleDeleteFathomWebhook = async (webhookId: string) => {
    if (!webhookId) return;
    if (!activeWorkspaceId || !activeFathomConnection) {
      toast({
        title: "No Active Connection",
        description: "Select an active Fathom connection before deleting webhooks.",
        variant: "destructive",
      });
      return;
    }
    setIsDeletingFathomWebhooks(true);
    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(
          activeWorkspaceId
        )}/fathom/connections/${encodeURIComponent(activeFathomConnection.id)}/webhooks`,
        {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [webhookId] }),
        }
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to delete webhook.");
      }
      await loadFathomWebhooks();
      toast({ title: "Webhook Deleted", description: "Fathom webhook removed." });
    } catch (error) {
      console.error("Failed to delete Fathom webhook:", error);
      toast({
        title: "Delete Failed",
        description: error instanceof Error ? error.message : "Could not delete webhook.",
        variant: "destructive",
      });
    } finally {
      setIsDeletingFathomWebhooks(false);
    }
  };

  const handleDeleteAllFathomWebhooks = async () => {
    if (!fathomWebhooks.length) return;
    if (!activeWorkspaceId || !activeFathomConnection) {
      toast({
        title: "No Active Connection",
        description: "Select an active Fathom connection before deleting webhooks.",
        variant: "destructive",
      });
      return;
    }
    setIsDeletingFathomWebhooks(true);
    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(
          activeWorkspaceId
        )}/fathom/connections/${encodeURIComponent(activeFathomConnection.id)}/webhooks`,
        {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deleteAll: true }),
        }
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to delete webhooks.");
      }
      await loadFathomWebhooks();
      toast({
        title: "Webhooks Deleted",
        description: "All Fathom webhooks were removed.",
      });
    } catch (error) {
      console.error("Failed to delete Fathom webhooks:", error);
      toast({
        title: "Delete Failed",
        description: error instanceof Error ? error.message : "Could not delete webhooks.",
        variant: "destructive",
      });
    } finally {
      setIsDeletingFathomWebhooks(false);
    }
  };

  const handleRecreateFathomWebhook = async () => {
    if (!isWorkspaceFathomConnected) {
      toast({
        title: "Fathom Not Connected",
        description: "Connect Fathom before creating a webhook.",
        variant: "destructive",
      });
      return;
    }
    if (!activeWorkspaceId || !activeFathomConnection) {
      toast({
        title: "No Active Connection",
        description: "Select an active Fathom connection before creating a webhook.",
        variant: "destructive",
      });
      return;
    }
    setIsCreatingFathomWebhook(true);
    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(
          activeWorkspaceId
        )}/fathom/connections/${encodeURIComponent(activeFathomConnection.id)}/webhooks`,
        { method: "POST" }
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "Failed to create webhook.");
      }
      const payload = await response.json();
      toast({
        title: "Webhook Ready",
        description: `Status: ${payload.status || "created"}`,
      });
      await loadFathomConnections(false);
      await loadFathomWebhooks();
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

  const handleIntegrationSettingsComingSoon = (name: string) => {
    toast({
      title: `${name} Settings`,
      description: "Settings will be available soon.",
    });
  };


  const handleExportAllTranscripts = async () => {
    if (isExportingTranscripts) return;

    setIsExportingTranscripts(true);
    try {
      const response = await fetch('/api/meetings/export-transcripts', {
        method: 'GET',
      });

      if (!response.ok) {
        throw new Error(`Failed to export transcripts (${response.status})`);
      }

      const blob = await response.blob();
      const contentDisposition = response.headers.get('Content-Disposition') || '';
      const filenameMatch = contentDisposition.match(/filename="([^"]+)"/i);
      const filename = filenameMatch?.[1] || `taskwise-transcripts-${new Date().toISOString().slice(0, 10)}.md`;

      const downloadUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = downloadUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(downloadUrl);

      toast({
        title: 'Transcripts exported',
        description: 'Downloaded transcripts for all stored meetings in this workspace.',
      });
    } catch (error) {
      console.error('Failed to export transcripts:', error);
      toast({
        title: 'Export failed',
        description: 'Could not export meeting transcripts right now. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsExportingTranscripts(false);
    }
  };
  
  const webhookUrl = fathomWebhookUrl || activeFathomConnection?.webhook?.webhookUrl || "";


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
          description="Manage your profile, workspace, integrations, and preferences."
        />
        <div className="flex-grow p-4 sm:p-6 lg:p-8 space-y-8 overflow-auto">
            <div className="max-w-5xl mx-auto">
                <Tabs value={activeSettingsSection} onValueChange={handleSettingsSectionChange}>
                  <TabsList className="grid h-auto w-full grid-cols-2 gap-1 md:grid-cols-5">
                    {SETTINGS_SECTIONS.filter(
                      (section) => section.value !== "advanced" || canAccessAdvancedSettings
                    ).map((section) => (
                      <TabsTrigger key={section.value} value={section.value}>
                        {section.label}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>

                <Card className={cn("shadow-lg rounded-xl mt-6", activeSettingsSection !== "profile" && "hidden")}>
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

                <Card className={cn("shadow-lg rounded-xl mt-8", activeSettingsSection !== "workspace" && "hidden")}>
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
                        disabled={isSavingWorkspace || authLoading || !canManageWorkspaceSettings}
                      />
                    </div>
                    <div className="rounded-lg border border-border/60 bg-muted/20 p-4 space-y-3">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <Users className="h-4 w-4 text-primary" />
                        Workspace Invitations
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Create an invite link and assign a default role.
                      </p>
                      <div className="grid grid-cols-1 md:grid-cols-[1fr_180px_auto] gap-2 items-end">
                        <div>
                          <Label htmlFor="workspaceInviteEmail">
                            Invite Email (optional)
                          </Label>
                          <Input
                            id="workspaceInviteEmail"
                            type="email"
                            placeholder="name@company.com"
                            value={inviteEmail}
                            onChange={(e) => setInviteEmail(e.target.value)}
                            disabled={isCreatingWorkspaceInvite || authLoading}
                            className="mt-1"
                          />
                        </div>
                        <div>
                          <Label htmlFor="workspaceInviteRole">Role</Label>
                          <Select
                            value={inviteRole}
                            onValueChange={(value) =>
                              setInviteRole(value as "member" | "admin")
                            }
                            disabled={isCreatingWorkspaceInvite || authLoading}
                          >
                            <SelectTrigger id="workspaceInviteRole" className="mt-1">
                              <SelectValue placeholder="Select role" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="member">Member</SelectItem>
                              <SelectItem value="admin">Admin</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={handleCreateWorkspaceInvite}
                          disabled={
                            isCreatingWorkspaceInvite || authLoading || !canManageWorkspaceMembers
                          }
                        >
                          {isCreatingWorkspaceInvite ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <Send className="mr-2 h-4 w-4" />
                          )}
                          Create Invite Link
                        </Button>
                      </div>
                      {!canManageWorkspaceMembers && (
                        <p className="text-xs text-muted-foreground">
                          Admin or owner access is required to invite members.
                        </p>
                      )}
                      {workspaceInviteLink ? (
                        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2 items-end">
                          <div>
                            <Label htmlFor="workspaceInviteLink">Invite Link</Label>
                            <Input
                              ref={workspaceInviteInputRef}
                              id="workspaceInviteLink"
                              value={workspaceInviteLink}
                              readOnly
                              className="mt-1"
                            />
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={handleCopyWorkspaceInvite}
                          >
                            {hasCopiedWorkspaceInvite ? (
                              <Check className="mr-2 h-4 w-4 text-green-500" />
                            ) : (
                              <Copy className="mr-2 h-4 w-4" />
                            )}
                            {hasCopiedWorkspaceInvite ? "Copied!" : "Copy Link"}
                          </Button>
                        </div>
                      ) : null}
                    </div>

                    <div className="rounded-lg border border-border/60 bg-muted/20 p-4 space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 text-sm font-medium">
                          <Users className="h-4 w-4 text-primary" />
                          Workspace Members
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => void loadWorkspaceMembers()}
                          disabled={!canManageWorkspaceMembers || isLoadingWorkspaceMembers}
                        >
                          {isLoadingWorkspaceMembers ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <RefreshCw className="mr-2 h-4 w-4" />
                          )}
                          Refresh
                        </Button>
                      </div>

                      {!canManageWorkspaceMembers ? (
                        <p className="text-xs text-muted-foreground">
                          Admin or owner access is required to view and manage members.
                        </p>
                      ) : workspaceMembers.length === 0 ? (
                        <p className="text-xs text-muted-foreground">
                          No members found in this workspace.
                        </p>
                      ) : (
                        <div className="space-y-2">
                          {workspaceMembers.map((member) => {
                            const disableActions =
                              pendingWorkspaceMemberId === member.membershipId ||
                              (member.role === "owner" && member.isLastOwner);
                            const roleOptions =
                              activeWorkspaceMembership?.role === "owner"
                                ? (["member", "admin", "owner"] as const)
                                : (["member", "admin"] as const);

                            return (
                              <div
                                key={member.membershipId}
                                className="rounded-md border bg-background/60 p-3"
                              >
                                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                                  <div className="min-w-0">
                                    <p className="text-sm font-medium truncate">
                                      {member.name}
                                      {member.isCurrentUser ? " (You)" : ""}
                                    </p>
                                    <p className="text-xs text-muted-foreground truncate">
                                      {member.email || member.userId}
                                    </p>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <Badge variant="outline" className="capitalize">
                                      {member.status}
                                    </Badge>
                                    {member.canEditRole &&
                                    workspaceMemberPermissions.canUpdateMembers ? (
                                      <Select
                                        value={member.role}
                                        onValueChange={(value) =>
                                          void handleWorkspaceMemberRoleChange(
                                            member.membershipId,
                                            value as "owner" | "admin" | "member"
                                          )
                                        }
                                        disabled={disableActions}
                                      >
                                        <SelectTrigger className="w-[120px]">
                                          <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                          {roleOptions.map((roleOption) => (
                                            <SelectItem key={roleOption} value={roleOption}>
                                              <span className="capitalize">{roleOption}</span>
                                            </SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>
                                    ) : (
                                      <Badge className="capitalize">{member.role}</Badge>
                                    )}
                                    {member.canRemove && workspaceMemberPermissions.canRemoveMembers && (
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={() =>
                                          void handleRemoveWorkspaceMember(member.membershipId)
                                        }
                                        disabled={disableActions}
                                      >
                                        Remove
                                      </Button>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    <div className="rounded-lg border border-border/60 bg-muted/20 p-4 space-y-3">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <SettingsIcon className="h-4 w-4 text-primary" />
                        Admin Visibility Controls
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Configure what admins can view inside this workspace.
                      </p>
                      {!canManageWorkspaceSettings ? (
                        <p className="text-xs text-muted-foreground">
                          Admin or owner access is required to update these controls.
                        </p>
                      ) : null}
                      <div className="space-y-3">
                        {[
                          {
                            key: "tasks" as const,
                            label: "Tasks",
                            description: "Task list, planning, and task-level activity.",
                          },
                          {
                            key: "people" as const,
                            label: "People",
                            description: "People directory, person profiles, and assigned items.",
                          },
                          {
                            key: "projects" as const,
                            label: "Projects",
                            description: "Project list and project-linked planning views.",
                          },
                          {
                            key: "chatSessions" as const,
                            label: "Chat Records",
                            description: "Workspace chat sessions and generated records.",
                          },
                          {
                            key: "boards" as const,
                            label: "Boards",
                            description: "Board layouts, columns, and board item visibility.",
                          },
                          {
                            key: "integrations" as const,
                            label: "Integrations",
                            description: "Workspace-shared integration status and controls.",
                          },
                        ].map((control) => (
                          <div
                            key={control.key}
                            className="flex items-center justify-between gap-4 rounded-md border bg-background/60 p-3"
                          >
                            <div className="space-y-1">
                              <p className="text-sm font-medium">{control.label}</p>
                              <p className="text-xs text-muted-foreground">
                                {control.description}
                              </p>
                            </div>
                            <Switch
                              checked={workspaceAdminAccess[control.key]}
                              onCheckedChange={(checked) =>
                                setWorkspaceAdminAccess((current) => ({
                                  ...current,
                                  [control.key]: checked,
                                }))
                              }
                              disabled={!canManageWorkspaceSettings || isSavingWorkspace || authLoading}
                              aria-label={`Admins can view ${control.label}`}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  </CardContent>
                  <CardFooter>
                    <Button
                      onClick={handleWorkspaceSave}
                      disabled={isSavingWorkspace || authLoading || !canManageWorkspaceSettings}
                    >
                      {isSavingWorkspace ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4"/>}
                      Save Workspace
                    </Button>
                  </CardFooter>
                </Card>

                <Card className={cn("shadow-lg rounded-xl mt-8", activeSettingsSection !== "preferences" && "hidden")}>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-3 font-headline text-xl">
                      <ClipboardCheck className="text-sky-400 drop-shadow-[0_2px_4px_rgba(56,189,248,0.5)]" />
                      Meeting Automation
                    </CardTitle>
                    <CardDescription>Control automated completion review and Slack sharing for meetings.</CardDescription>
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
                    <div className="mt-6 space-y-3">
                      <div className="flex items-center justify-between gap-4">
                        <div className="space-y-1">
                          <Label className="text-sm font-medium">Completion match threshold</Label>
                          <p className="text-xs text-muted-foreground">
                            Minimum wording overlap required to suggest a completion.
                          </p>
                        </div>
                        <span className="text-sm font-semibold text-foreground">
                          {completionMatchThreshold}%
                        </span>
                      </div>
                      <Slider
                        min={40}
                        max={95}
                        step={5}
                        value={[completionMatchThreshold]}
                        onValueChange={([value]) => setCompletionMatchThreshold(value)}
                        onValueCommit={handleCompletionThresholdCommit}
                        aria-label="Completion match threshold"
                      />
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>40%</span>
                        <span>95%</span>
                      </div>
                    </div>

                    <div className="mt-8 border-t border-border/60 pt-6 space-y-4">
                      <div className="flex items-center justify-between gap-6">
                        <div className="space-y-1">
                          <Label className="text-sm font-medium">Auto-share meetings to Slack</Label>
                          <p className="text-xs text-muted-foreground">
                            Automatically send each newly processed meeting summary and action items.
                          </p>
                        </div>
                        <Switch
                          checked={slackAutomationEnabled}
                          onCheckedChange={handleSlackAutomationToggle}
                          aria-label="Auto-share new meetings to Slack"
                          disabled={!isSlackConnected || slackConnectedViaWorkspaceOnly}
                        />
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-3">
                          <Label htmlFor="slack-automation-channel" className="text-sm font-medium">
                            Slack Channel
                          </Label>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void loadSlackChannels()}
                            disabled={
                              !isSlackConnected || isLoadingSlackChannels || slackConnectedViaWorkspaceOnly
                            }
                          >
                            {isLoadingSlackChannels ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                              <RefreshCw className="mr-2 h-4 w-4" />
                            )}
                            Refresh
                          </Button>
                        </div>
                        <Select
                          value={slackAutomationChannelId || ""}
                          onValueChange={handleSlackAutomationChannelChange}
                          disabled={
                            !isSlackConnected ||
                            slackConnectedViaWorkspaceOnly ||
                            isLoadingSlackChannels ||
                            slackChannels.length === 0
                          }
                        >
                          <SelectTrigger id="slack-automation-channel">
                            <SelectValue
                              placeholder={
                                !isSlackConnected
                                  ? "Connect Slack to choose a channel"
                                  : isLoadingSlackChannels
                                    ? "Loading channels..."
                                    : "Select a channel"
                              }
                            />
                          </SelectTrigger>
                          <SelectContent>
                            {slackChannels.map((channel: any) => (
                              <SelectItem key={channel.id} value={channel.id}>
                                # {channel.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {!isSlackConnected && (
                          <p className="text-xs text-muted-foreground">
                            Connect Slack in the Integrations section first.
                          </p>
                        )}
                        {slackConnectedViaWorkspaceOnly && (
                          <p className="text-xs text-muted-foreground">
                            Slack automation channel settings are managed by the admin who connected Slack.
                          </p>
                        )}
                        {isSlackConnected &&
                          !isLoadingSlackChannels &&
                          slackChannels.length === 0 && (
                            <p className="text-xs text-muted-foreground">
                              No channels were found in your Slack workspace.
                            </p>
                          )}
                      </div>
                    </div>

                    <div className="mt-8 border-t border-border/60 pt-6 space-y-3">
                      <div className="space-y-1">
                        <Label className="text-sm font-medium">Export all meeting transcripts</Label>
                        <p className="text-xs text-muted-foreground">
                          Download every stored meeting transcript in this workspace as a single Markdown file.
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        onClick={() => void handleExportAllTranscripts()}
                        disabled={isExportingTranscripts}
                      >
                        {isExportingTranscripts ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Download className="mr-2 h-4 w-4" />
                        )}
                        Export All Transcripts
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                {/* Task Cleanup Settings */}
                <TaskCleanupSettingsCard
                  className={cn("mt-8", activeSettingsSection !== "preferences" && "hidden")}
                />

                {/* Slack Reminders Settings */}
                <SlackRemindersSettingsCard
                  className={cn("mt-8", activeSettingsSection !== "preferences" && "hidden")}
                />

                 {/* Integrations Settings */}
                <Card className={cn("shadow-lg rounded-xl mt-8", activeSettingsSection !== "integrations" && "hidden")}>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-3 font-headline text-xl">
                        <LinkIcon className="text-purple-400 drop-shadow-[0_2px_4px_rgba(168,85,247,0.5)]" />
                        Integrations
                    </CardTitle>
                    <CardDescription>Connect TaskWiseAI with your favorite services.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                        {integrationsBlockedForAdmin ? (
                          <div className="rounded-md border border-border/60 bg-muted/20 p-4 text-sm text-muted-foreground">
                            Workspace policy currently hides integrations for admins in this workspace.
                          </div>
                        ) : (
                          <>
                        <IntegrationCard 
                            icon={Bot}
                            title="Google Workspace"
                            description="Connect Meet, Calendar, and Drive for meeting ingestion."
                            statusNote={googleStatusNote || null}
                            isConnected={isGoogleTasksConnected}
                            isLoading={isLoadingGoogleConnection}
                            onConnect={connectGoogleTasks}
                            onConnectDisabled={isGoogleIntegrationProviderAvailable === false}
                            onDisconnect={disconnectGoogleTasks}
                            settingsAction={{
                              onClick: () => handleIntegrationSettingsComingSoon("Google Workspace"),
                              disabled: !isGoogleTasksConnected,
                            }}
                            extraActions={isGoogleTasksConnected ? (
                              <Button variant="outline" size="sm" onClick={handleOpenGoogleLogs}>
                                <FileText className="mr-2 h-4 w-4" />
                                Logs
                              </Button>
                            ) : null}
                        />
                        <IntegrationCard 
                            icon={ToyBrick}
                            title="Trello"
                            description="Create Trello cards from your tasks."
                            isConnected={isTrelloConnected}
                            isLoading={isLoadingTrelloConnection}
                            onConnect={connectTrello}
                            onDisconnect={disconnectTrello}
                            settingsAction={{
                              onClick: () => handleIntegrationSettingsComingSoon("Trello"),
                              disabled: !isTrelloConnected,
                            }}
                        />
                        <IntegrationCard 
                            icon={Slack}
                            title="Slack"
                            description="Post meeting summaries and tasks to channels."
                            statusNote={slackStatusNote}
                            isConnected={isSlackConnected}
                            isLoading={isLoadingSlackConnection}
                            onConnect={connectSlack}
                            onDisconnect={disconnectSlack}
                            settingsAction={{
                              onClick: () => handleIntegrationSettingsComingSoon("Slack"),
                              disabled: !isSlackConnected,
                            }}
                        />
                        <IntegrationCard 
                            icon={Video}
                            title="Fathom"
                            description="Sync meetings and transcripts from Fathom."
                            statusNote={fathomStatusNote}
                            isConnected={isFathomConnected}
                            isLoading={isLoadingFathomConnection}
                            onConnect={connectFathom}
                            onDisconnect={disconnectFathom}
                            settingsAction={{
                              onClick: handleOpenFathomSettings,
                              disabled: !isFathomConnected,
                            }}
                            onDisconnectDisabled={fathomDisconnectDisabled}
                            extraActions={isFathomConnected ? (
                              <Button variant="outline" size="sm" onClick={handleOpenFathomLogs}>
                                <FileText className="mr-2 h-4 w-4" />
                                Logs
                              </Button>
                            ) : null}
                        />
                          </>
                        )}
                  </CardContent>
                </Card>

                <Card className={cn("shadow-lg rounded-xl mt-8", activeSettingsSection !== "advanced" && "hidden")}>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-3 font-headline text-xl">
                      <Settings2 className="text-slate-400 drop-shadow-[0_2px_4px_rgba(148,163,184,0.5)]" />
                      Advanced
                    </CardTitle>
                    <CardDescription>
                      Operator controls for automations, API access, delivery replay, and troubleshooting.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-200">
                      Advanced settings can affect external delivery behavior, scoped API access, and automation output.
                    </div>
                    <div className="rounded-lg border border-border/50 bg-background/60 p-4">
                      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div className="space-y-1">
                          <p className="text-sm font-semibold flex items-center gap-2">
                            <Webhook className="h-4 w-4 text-primary" />
                            Workflow Builder
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Build outbound automation workflows for meeting events.
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            Add filters, transform payloads, send test deliveries, and replay failures.
                          </p>
                          {!isWorkspaceFathomConnected ? (
                            <p className="text-[11px] text-muted-foreground">
                              Connect Fathom to start receiving live workflow trigger events.
                            </p>
                          ) : null}
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void handleOpenFathomSettings()}
                          disabled={!activeWorkspaceId || isLoadingWorkflows || isLoadingFathomWebhooks}
                        >
                          {isLoadingWorkflows || isLoadingFathomWebhooks ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <Settings2 className="mr-2 h-4 w-4" />
                          )}
                          Open Workflow Builder
                        </Button>
                      </div>
                    </div>
                    <div className="rounded-lg border border-border/50 bg-background/60 p-4">
                      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div className="space-y-1">
                          <p className="text-sm font-semibold flex items-center gap-2">
                            <Key className="h-4 w-4 text-primary" />
                            MCP API
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Connect external AI clients to TaskWise using secure MCP keys.
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            Manage read/write scopes, generate keys, and review recent MCP activity.
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void handleOpenMcpSettings()}
                          disabled={!activeWorkspaceId}
                        >
                          <Settings2 className="mr-2 h-4 w-4" />
                          Open MCP Setup
                        </Button>
                      </div>
                    </div>
                    <div className="rounded-lg border border-border/50 bg-background/60 p-4">
                      <div className="space-y-1">
                        <p className="text-sm font-semibold">Runbooks</p>
                        <p className="text-xs text-muted-foreground">
                          Use the advanced docs for key rotation, rollback, replay, and worker recovery procedures.
                        </p>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button variant="outline" size="sm" asChild>
                          <a href="/docs/mcp">MCP Docs</a>
                        </Button>
                        <Button variant="outline" size="sm" asChild>
                          <a href="/docs">Docs Home</a>
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Appearance Settings */}
                <Card className={cn("shadow-lg rounded-xl mt-8", activeSettingsSection !== "preferences" && "hidden")}>
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
                <Card className={cn("shadow-lg rounded-xl border-destructive/50 mt-8", activeSettingsSection !== "profile" && "hidden")}>
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

      <Dialog open={isGoogleLogsOpen} onOpenChange={setIsGoogleLogsOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Google Workspace Logs</DialogTitle>
            <DialogDescription>
              Recent OAuth, token refresh, and revoke events for this workspace.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              Showing {googleLogs.length} entries
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={loadGoogleLogs}
              disabled={isLoadingGoogleLogs}
            >
              {isLoadingGoogleLogs ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Refresh
            </Button>
          </div>
          <div className="max-h-[420px] overflow-y-auto space-y-3">
            {isLoadingGoogleLogs && (
              <div className="text-sm text-muted-foreground">Loading logs...</div>
            )}
            {!isLoadingGoogleLogs && googleLogs.length === 0 && (
              <div className="text-sm text-muted-foreground">No logs yet.</div>
            )}
            {googleLogs.map((log: any) => (
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
            <Button variant="outline" onClick={() => setIsGoogleLogsOpen(false)}>
              Close
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
            {fathomLogs.map((log: any) => (
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

      <Dialog open={isFathomSettingsOpen} onOpenChange={setIsFathomSettingsOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Fathom Integration Settings</DialogTitle>
            <DialogDescription>
              Manage webhooks and automation for your Fathom workspace.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h4 className="text-sm font-semibold">Connections</h4>
                  <p className="text-xs text-muted-foreground">
                    Switch the active connection and manage each Fathom account.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void loadFathomConnections()}
                    disabled={isLoadingFathomConnections}
                  >
                    {isLoadingFathomConnections ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="mr-2 h-4 w-4" />
                    )}
                    Refresh
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => connectFathom()}
                    disabled={!canManageWorkspaceIntegrations}
                  >
                    <Send className="mr-2 h-4 w-4" />
                    Connect Another
                  </Button>
                </div>
              </div>
              <div className="max-h-[240px] space-y-2 overflow-y-auto">
                {isLoadingFathomConnections && fathomConnections.length === 0 ? (
                  <div className="text-sm text-muted-foreground">Loading connections...</div>
                ) : fathomConnections.length === 0 ? (
                  <div className="text-sm text-muted-foreground">
                    No Fathom connections yet. Connect your first account.
                  </div>
                ) : (
                  fathomConnections.map((connection) => {
                    const isPending = pendingFathomConnectionId === connection.id;
                    const isActive =
                      connection.id === workspaceFathom?.activeConnectionId || connection.isPreferred;
                    return (
                      <div
                        key={connection.id}
                        className="rounded-md border bg-background/60 p-3 space-y-2"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold truncate">{connection.label}</p>
                            <div className="flex flex-wrap items-center gap-2 mt-1">
                              <Badge variant={isActive ? "secondary" : "outline"}>
                                {isActive ? "Active" : "Inactive"}
                              </Badge>
                              <Badge variant="outline" className="capitalize">
                                {connection.status}
                              </Badge>
                              {connection.connectedByCurrentUser ? (
                                <Badge variant="outline">Connected by you</Badge>
                              ) : null}
                            </div>
                          </div>
                          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void handleSelectFathomConnection(connection)}
                            disabled={isActive || isPending || !canManageFathomConnection(connection)}
                          >
                            Use This
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void handleRenameFathomConnection(connection)}
                            disabled={isPending || !canManageFathomConnection(connection)}
                          >
                            Rename
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleReconnectFathomConnection(connection)}
                            disabled={isPending || !canManageFathomConnection(connection)}
                          >
                            Reconnect
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void handleDisconnectFathomConnection(connection)}
                            disabled={isPending || !canManageFathomConnection(connection)}
                          >
                            <Trash2 className="mr-2 h-4 w-4 text-red-500" />
                            Disconnect
                          </Button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Webhook className="h-5 w-5 text-green-400" />
                    <span className="text-sm font-semibold">Webhook URL</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {activeFathomConnection
                      ? `Managing webhook delivery for ${activeFathomConnection.label}.`
                      : "Choose an active connection to manage its webhook."}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={loadFathomWebhooks}
                  disabled={isLoadingFathomWebhooks || isLoadingFathomConnections}
                >
                  {isLoadingFathomWebhooks ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-2 h-4 w-4" />
                  )}
                  Refresh
                </Button>
              </div>
              <div className="flex flex-col sm:flex-row items-center gap-2">
                <Input
                  ref={webhookUrlInputRef}
                  id="fathom-webhook-url"
                  type="text"
                  readOnly
                  value={
                    webhookUrl ||
                    (activeFathomConnection
                      ? "Create a webhook to generate a workspace callback URL."
                      : "Connect Fathom to generate a webhook URL.")
                  }
                  className="flex-1 bg-background/70"
                />
                {webhookUrl ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleSelectAndCopy}
                    className="w-full sm:w-auto"
                  >
                    {hasCopied ? (
                      <Check className="mr-2 h-4 w-4 text-green-500" />
                    ) : (
                      <Copy className="mr-2 h-4 w-4" />
                    )}
                    {hasCopied ? "Copied!" : "Copy URL"}
                  </Button>
                ) : activeFathomConnection ? (
                  <Button
                    onClick={handleRecreateFathomWebhook}
                    className="w-full sm:w-auto"
                    disabled={
                      isCreatingFathomWebhook || !canManageFathomConnection(activeFathomConnection)
                    }
                  >
                    {isCreatingFathomWebhook ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="mr-2 h-4 w-4" />
                    )}
                    Create Webhook
                  </Button>
                ) : (
                  <Button
                    onClick={() => connectFathom()}
                    className="w-full sm:w-auto"
                  >
                    <Send className="mr-2 h-4 w-4" />
                    Connect Fathom
                  </Button>
                )}
              </div>
              {isWorkspaceFathomConnected && activeFathomConnection && (
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRecreateFathomWebhook}
                    disabled={
                      isCreatingFathomWebhook || !canManageFathomConnection(activeFathomConnection)
                    }
                  >
                    {isCreatingFathomWebhook ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Creating...
                      </>
                    ) : (
                      <>
                        <RefreshCw className="mr-2 h-4 w-4" />
                        Create Webhook
                      </>
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleDeleteAllFathomWebhooks}
                    disabled={
                      isDeletingFathomWebhooks ||
                      !fathomWebhooks.length ||
                      !canManageFathomConnection(activeFathomConnection)
                    }
                  >
                    <Trash2 className="mr-2 h-4 w-4 text-red-500" />
                    Delete All
                  </Button>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                TaskWiseAI will create a webhook that includes transcripts,
                summaries, and action items. Use the URL above when creating
                manual webhooks in Fathom.
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold">
                  {activeFathomConnection
                    ? `Webhooks for ${activeFathomConnection.label}`
                    : "Active Webhooks"}
                </h4>
                <span className="text-xs text-muted-foreground">
                  {fathomWebhooks.length} webhook(s)
                </span>
              </div>
              <div className="max-h-[320px] overflow-y-auto space-y-3">
                {isLoadingFathomWebhooks && (
                  <div className="text-sm text-muted-foreground">
                    Loading webhooks...
                  </div>
                )}
                {!isLoadingFathomWebhooks && fathomWebhooks.length === 0 && (
                  <div className="text-sm text-muted-foreground">
                    No webhooks found yet.
                  </div>
                )}
                {fathomWebhooks.map((webhook: any) => {
                  const webhookId = String(
                    webhook?.id ||
                      webhook?.webhook_id ||
                      webhook?.webhookId ||
                      ""
                  );
                  const webhookUrl =
                    webhook?.url ||
                    webhook?.webhook_url ||
                    webhook?.destination_url ||
                    "";
                  const createdAt =
                    webhook?.created_at ||
                    webhook?.createdAt ||
                    webhook?.created ||
                    null;
                  return (
                    <div
                      key={webhookId || webhookUrl}
                      className="rounded-lg border bg-background/60 p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold truncate">
                            {webhookId || "Webhook"}
                          </p>
                          <p className="text-xs text-muted-foreground truncate">
                            {webhookUrl || "No URL provided"}
                          </p>
                          <div className="flex flex-wrap gap-2 mt-2 text-xs text-muted-foreground">
                            {webhook?.include_transcript && (
                              <Badge variant="outline">Transcript</Badge>
                            )}
                            {webhook?.include_summary && (
                              <Badge variant="outline">Summary</Badge>
                            )}
                            {webhook?.include_action_items && (
                              <Badge variant="outline">Action Items</Badge>
                            )}
                            {createdAt && (
                              <Badge variant="secondary">
                                {new Date(createdAt).toLocaleString()}
                              </Badge>
                            )}
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDeleteFathomWebhook(webhookId)}
                          disabled={
                            isDeletingFathomWebhooks ||
                            !webhookId ||
                            !activeFathomConnection ||
                            !canManageFathomConnection(activeFathomConnection)
                          }
                        >
                          <Trash2 className="h-4 w-4 text-red-500" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <ClipboardCheck className="h-5 w-5 text-blue-400" />
                    <span className="text-sm font-semibold">Automation Workflows</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Toggle workflow delivery and replay recent failed webhook attempts.
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void loadWorkflows()}
                  disabled={isLoadingWorkflows}
                >
                  {isLoadingWorkflows ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-2 h-4 w-4" />
                  )}
                  Refresh
                </Button>
                <Button
                  size="sm"
                  onClick={handleOpenCreateWorkflowEditor}
                  disabled={!canManageWorkspaceIntegrations}
                >
                  <Save className="mr-2 h-4 w-4" />
                  Create Workflow
                </Button>
              </div>
              <div className="max-h-[360px] overflow-y-auto space-y-3">
                {isLoadingWorkflows && workflows.length === 0 ? (
                  <div className="text-sm text-muted-foreground">Loading workflows...</div>
                ) : workflows.length === 0 ? (
                  <div className="text-sm text-muted-foreground">
                    No workflows configured yet.
                  </div>
                ) : (
                  workflows.map((workflow) => {
                    const canManageCurrentWorkflow = canManageWorkflow(workflow);
                    const isPendingWorkflow = pendingWorkflowId === workflow.id;
                    const isExpanded = expandedWorkflowId === workflow.id;
                    const failedDeliveries = workflowFailuresById[workflow.id] || [];
                    const isLoadingFailures = loadingWorkflowFailuresId === workflow.id;

                    return (
                      <div
                        key={workflow.id}
                        className="rounded-md border bg-background/60 p-3 space-y-2"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0 space-y-1">
                            <p className="text-sm font-semibold truncate">{workflow.name}</p>
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant={workflow.enabled ? "secondary" : "outline"}>
                                {workflow.enabled ? "Enabled" : "Paused"}
                              </Badge>
                              <Badge variant="outline">
                                {formatWorkflowTriggerLabel(workflow.trigger)}
                              </Badge>
                              <Badge variant="outline">v{workflow.version}</Badge>
                            </div>
                            {workflow.updatedAt ? (
                              <p className="text-xs text-muted-foreground">
                                Updated {new Date(workflow.updatedAt).toLocaleString()}
                              </p>
                            ) : null}
                            {workflow.autoDisabledAt ? (
                              <p className="text-xs text-amber-700 dark:text-amber-300">
                                Auto-disabled:{" "}
                                {workflow.autoDisabledReason || "repeated delivery failures"}
                                {typeof workflow.autoDisabledFailureCount === "number"
                                  ? ` (${workflow.autoDisabledFailureCount} failures)`
                                  : ""}
                              </p>
                            ) : null}
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => void handleOpenEditWorkflowEditor(workflow)}
                              disabled={!canManageCurrentWorkflow}
                            >
                              Edit
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => void handleToggleWorkflowEnabled(workflow)}
                              disabled={!canManageCurrentWorkflow || isPendingWorkflow}
                            >
                              {isPendingWorkflow ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              ) : workflow.enabled ? (
                                <PowerOff className="mr-2 h-4 w-4 text-red-500" />
                              ) : (
                                <Power className="mr-2 h-4 w-4 text-green-500" />
                              )}
                              {workflow.enabled ? "Disable" : "Enable"}
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => void handleToggleWorkflowFailures(workflow)}
                            >
                              {isExpanded ? "Hide Failures" : "View Failures"}
                            </Button>
                          </div>
                        </div>

                        {isExpanded ? (
                          <div className="rounded-md border bg-muted/20 p-3 space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-xs text-muted-foreground">
                                Showing up to 10 recent failed deliveries.
                              </p>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => void loadWorkflowFailures(workflow.id)}
                                disabled={isLoadingFailures}
                              >
                                {isLoadingFailures ? (
                                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                ) : (
                                  <RefreshCw className="mr-2 h-4 w-4" />
                                )}
                                Refresh Failures
                              </Button>
                            </div>
                            {isLoadingFailures && failedDeliveries.length === 0 ? (
                              <p className="text-sm text-muted-foreground">Loading failures...</p>
                            ) : failedDeliveries.length === 0 ? (
                              <p className="text-sm text-muted-foreground">
                                No failed deliveries found.
                              </p>
                            ) : (
                              failedDeliveries.map((delivery) => {
                                const isReplaying = pendingReplayDeliveryId === delivery.id;
                                return (
                                  <div
                                    key={delivery.id}
                                    className="rounded-md border bg-background/70 p-3 space-y-2"
                                  >
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <Badge variant="outline" className="uppercase text-[10px]">
                                          {delivery.status}
                                        </Badge>
                                        <Badge variant="outline">
                                          Attempts {delivery.attemptCount}/{delivery.maxAttempts}
                                        </Badge>
                                        {delivery.latestResponse?.statusCode ? (
                                          <Badge variant="outline">
                                            HTTP {delivery.latestResponse.statusCode}
                                          </Badge>
                                        ) : null}
                                      </div>
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() =>
                                          void handleReplayWorkflowDelivery(workflow, delivery)
                                        }
                                        disabled={!canManageCurrentWorkflow || isReplaying}
                                      >
                                        {isReplaying ? (
                                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        ) : (
                                          <Send className="mr-2 h-4 w-4" />
                                        )}
                                        Replay
                                      </Button>
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                      {delivery.failedAt
                                        ? `Failed ${new Date(delivery.failedAt).toLocaleString()}`
                                        : delivery.updatedAt
                                          ? `Updated ${new Date(delivery.updatedAt).toLocaleString()}`
                                          : "Failure time unavailable"}
                                      {" | "}
                                      Event {delivery.eventType}
                                    </p>
                                    {delivery.lastError?.message ? (
                                      <p className="text-xs text-red-600">
                                        {delivery.lastError.message}
                                      </p>
                                    ) : null}
                                  </div>
                                );
                              })
                            )}
                          </div>
                        ) : null}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsFathomSettingsOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isMcpSettingsOpen}
        onOpenChange={(nextOpen) => {
          setIsMcpSettingsOpen(nextOpen);
          if (!nextOpen) {
            setNewMcpApiKeySecret(null);
            setHasCopiedMcpSecret(false);
            setHasCopiedMcpEndpoint(false);
          }
        }}
      >
        <DialogContent className="sm:max-w-4xl max-h-[92vh] overflow-hidden">
          <DialogHeader>
            <DialogTitle>MCP API Setup</DialogTitle>
            <DialogDescription>
              Connect external AI clients to this workspace with scoped MCP keys and audit logs.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[70vh] overflow-y-auto pr-1 space-y-5">
            <div className="rounded-lg border bg-muted/20 p-4 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="space-y-1">
                  <h4 className="text-sm font-semibold">Get Started</h4>
                  <p className="text-xs text-muted-foreground">
                    1) Copy endpoint, 2) create a scoped key, 3) connect your MCP client.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => window.open("/docs/mcp", "_blank", "noopener,noreferrer")}
                  >
                    <LinkIcon className="mr-2 h-4 w-4" />
                    Full MCP Docs
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      void Promise.all([loadMcpApiKeys(), loadMcpAuditLogs()]);
                    }}
                    disabled={isLoadingMcpApiKeys || isLoadingMcpAuditLogs}
                  >
                    {isLoadingMcpApiKeys || isLoadingMcpAuditLogs ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="mr-2 h-4 w-4" />
                    )}
                    Refresh
                  </Button>
                </div>
              </div>

              <div className="space-y-1">
                <Label htmlFor="mcp-endpoint-url">MCP Endpoint</Label>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <Input
                    id="mcp-endpoint-url"
                    readOnly
                    value={mcpEndpointUrl || "Select a workspace to generate your MCP endpoint."}
                    className="font-mono text-xs"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void handleCopyMcpEndpoint()}
                    disabled={!mcpEndpointUrl}
                    className="w-full sm:w-auto"
                  >
                    {hasCopiedMcpEndpoint ? (
                      <Check className="mr-2 h-4 w-4 text-green-500" />
                    ) : (
                      <Copy className="mr-2 h-4 w-4" />
                    )}
                    {hasCopiedMcpEndpoint ? "Copied!" : "Copy"}
                  </Button>
                </div>
              </div>

              <div className="space-y-1">
                <Label>MCP Auth Header</Label>
                <pre className="rounded-md border bg-background px-3 py-2 text-xs text-foreground whitespace-pre-wrap">
{`Authorization: Bearer <YOUR_MCP_KEY>`}
                </pre>
                <p className="text-xs text-muted-foreground">
                  Alternate headers supported: <code>x-taskwise-mcp-key</code>,{" "}
                  <code>x-mcp-api-key</code>, <code>x-api-key</code>.
                </p>
              </div>
            </div>

            <div className="rounded-lg border bg-muted/20 p-4 space-y-4">
              <div className="space-y-1">
                <h4 className="text-sm font-semibold">Generate MCP Key</h4>
                <p className="text-xs text-muted-foreground">
                  Start with <code>mcp:read</code>. Enable <code>mcp:write</code> only for clients
                  that must edit tasks.
                </p>
              </div>
              {!canManageWorkspaceIntegrations ? (
                <div className="rounded-md border border-border/70 bg-background/70 px-3 py-2 text-xs text-muted-foreground">
                  Only workspace integration admins can create or revoke MCP keys.
                </div>
              ) : null}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="mcp-key-name">Key Name</Label>
                  <Input
                    id="mcp-key-name"
                    value={mcpKeyName}
                    onChange={(event) => setMcpKeyName(event.target.value)}
                    placeholder="Support assistant"
                    disabled={!canManageWorkspaceIntegrations}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="mcp-key-description">Description (optional)</Label>
                  <Input
                    id="mcp-key-description"
                    value={mcpKeyDescription}
                    onChange={(event) => setMcpKeyDescription(event.target.value)}
                    placeholder="Used by our support bot in production"
                    disabled={!canManageWorkspaceIntegrations}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="rounded-md border bg-background/70 px-3 py-2 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">
                      <code>mcp:read</code> scope
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Required for listing tools and reading meetings, people, and action items.
                    </p>
                  </div>
                  <Switch
                    checked={mcpKeyAllowRead}
                    onCheckedChange={setMcpKeyAllowRead}
                    disabled={!canManageWorkspaceIntegrations}
                    aria-label="Toggle mcp read scope"
                  />
                </div>
                <div className="rounded-md border bg-background/70 px-3 py-2 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">
                      <code>mcp:write</code> scope
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Allows safe task edits: status, assignee, due date, notes, and title.
                    </p>
                  </div>
                  <Switch
                    checked={mcpKeyAllowWrite}
                    onCheckedChange={setMcpKeyAllowWrite}
                    disabled={!canManageWorkspaceIntegrations}
                    aria-label="Toggle mcp write scope"
                  />
                </div>
              </div>

              <div className="flex justify-end">
                <Button
                  onClick={() => void handleCreateMcpApiKey()}
                  disabled={!canManageWorkspaceIntegrations || isCreatingMcpApiKey}
                >
                  {isCreatingMcpApiKey ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Key className="mr-2 h-4 w-4" />
                  )}
                  Generate Key
                </Button>
              </div>

              {newMcpApiKeySecret ? (
                <div className="rounded-md border border-amber-500/40 bg-amber-50/40 dark:bg-amber-950/20 p-3 space-y-2">
                  <div className="space-y-1">
                    <p className="text-sm font-semibold">Copy Your Secret Now</p>
                    <p className="text-xs text-muted-foreground">
                      This secret is shown only once. Save it in your MCP client or secret manager.
                    </p>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <Input
                      readOnly
                      value={newMcpApiKeySecret}
                      className="font-mono text-xs"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void handleCopyMcpSecret()}
                      className="w-full sm:w-auto"
                    >
                      {hasCopiedMcpSecret ? (
                        <Check className="mr-2 h-4 w-4 text-green-500" />
                      ) : (
                        <Copy className="mr-2 h-4 w-4" />
                      )}
                      {hasCopiedMcpSecret ? "Copied!" : "Copy Secret"}
                    </Button>
                  </div>
                </div>
              ) : null}

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <h5 className="text-sm font-semibold">Active Keys</h5>
                  <span className="text-xs text-muted-foreground">{mcpApiKeys.length} key(s)</span>
                </div>
                <div className="max-h-[260px] overflow-y-auto space-y-2">
                  {isLoadingMcpApiKeys && mcpApiKeys.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Loading MCP keys...</p>
                  ) : mcpApiKeys.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No keys yet. Generate your first key above.
                    </p>
                  ) : (
                    mcpApiKeys.map((key) => {
                      const isRevoked = key.status === "revoked";
                      const isPending = pendingMcpApiKeyId === key.id;
                      return (
                        <div
                          key={key.id}
                          className="rounded-md border bg-background/70 p-3 space-y-2"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold truncate">{key.name}</p>
                              <p className="text-xs text-muted-foreground truncate">
                                Prefix {key.keyPrefix}
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge variant={isRevoked ? "outline" : "secondary"}>
                                {isRevoked ? "Revoked" : "Active"}
                              </Badge>
                              {!isRevoked ? (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => void handleRevokeMcpApiKey(key)}
                                  disabled={!canManageWorkspaceIntegrations || isPending}
                                >
                                  {isPending ? (
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                  ) : (
                                    <Trash2 className="mr-2 h-4 w-4 text-red-500" />
                                  )}
                                  Revoke
                                </Button>
                              ) : null}
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            {key.scopes.map((scope) => (
                              <Badge key={`${key.id}-${scope}`} variant="outline">
                                {scope}
                              </Badge>
                            ))}
                          </div>
                          {key.description ? (
                            <p className="text-xs text-muted-foreground">{key.description}</p>
                          ) : null}
                          <p className="text-xs text-muted-foreground">
                            Created {formatDateTimeValue(key.createdAt)}
                            {" | "}Last used {formatDateTimeValue(key.lastUsedAt)}
                            {" | "}Expires {formatDateTimeValue(key.expiresAt, "No expiry")}
                          </p>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>

            <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
              <h4 className="text-sm font-semibold">Key Rotation Runbook</h4>
              <p className="text-xs text-muted-foreground">
                Rotate keys without downtime using a short overlap window.
              </p>
              <ol className="list-decimal pl-4 space-y-1 text-xs text-muted-foreground">
                <li>Create a new key with the same scopes as the current production key.</li>
                <li>Update your MCP client secret and verify read/write calls succeed.</li>
                <li>Monitor Recent MCP Activity for successful calls on the new key.</li>
                <li>Revoke the old key immediately after confirmation.</li>
              </ol>
            </div>

            <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
              <h4 className="text-sm font-semibold">
                Safe Write Tools (<code>mcp:write</code>)
              </h4>
              <p className="text-xs text-muted-foreground">
                Read tools are exposed under <code>people.*</code> and <code>action_items.*</code>.
                Write access is limited to these five task updates:
              </p>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">action_items.update_status</Badge>
                <Badge variant="outline">action_items.update_assignee</Badge>
                <Badge variant="outline">action_items.update_due_date</Badge>
                <Badge variant="outline">action_items.update_notes</Badge>
                <Badge variant="outline">action_items.update_title</Badge>
              </div>
            </div>

            <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="space-y-1">
                  <h4 className="text-sm font-semibold">Recent MCP Activity</h4>
                  <p className="text-xs text-muted-foreground">
                    Every key create/revoke and write tool call is logged for this workspace.
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void loadMcpAuditLogs()}
                  disabled={isLoadingMcpAuditLogs}
                >
                  {isLoadingMcpAuditLogs ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-2 h-4 w-4" />
                  )}
                  Refresh
                </Button>
              </div>
              <div className="max-h-[260px] overflow-y-auto space-y-2">
                {isLoadingMcpAuditLogs && mcpAuditLogs.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Loading MCP activity...</p>
                ) : mcpAuditLogs.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No MCP audit events yet.
                  </p>
                ) : (
                  mcpAuditLogs.map((log) => (
                    <div key={log.id} className="rounded-md border bg-background/70 p-3 space-y-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge
                            variant={log.status === "success" ? "secondary" : "destructive"}
                            className="uppercase text-[10px]"
                          >
                            {log.status}
                          </Badge>
                          <Badge variant="outline">{log.action}</Badge>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {formatDateTimeValue(log.createdAt)}
                        </span>
                      </div>
                      <p className="text-sm text-foreground">{log.message}</p>
                      <p className="text-xs text-muted-foreground">
                        Actor:{" "}
                        {log.actorType === "api_key"
                          ? log.apiKeyName || log.apiKeyId || "API key"
                          : log.actorUserId || "Workspace user"}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsMcpSettingsOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isWorkflowEditorOpen} onOpenChange={handleWorkflowEditorOpenChange}>
        <DialogContent className="sm:max-w-3xl max-h-[92vh] overflow-hidden">
          <DialogHeader>
            <DialogTitle>
              {workflowEditorMode === "edit" ? "Edit Workflow" : "Create Workflow"}
            </DialogTitle>
            <DialogDescription>
              Configure trigger filters, payload selection, transform script, and webhook destination.
            </DialogDescription>
          </DialogHeader>
          {isLoadingWorkflowEditor ? (
            <div className="py-10 flex items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading workflow details...
            </div>
          ) : (
            <div className="max-h-[66vh] overflow-y-auto pr-1 space-y-5">
              <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
                <h4 className="text-sm font-semibold">Basics</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="space-y-1 md:col-span-2">
                    <Label htmlFor="workflow-name">Workflow Name</Label>
                    <Input
                      id="workflow-name"
                      value={workflowForm.name}
                      onChange={(event) =>
                        setWorkflowForm((current) => ({
                          ...current,
                          name: event.target.value,
                        }))
                      }
                      placeholder="Meeting follow-up webhook"
                    />
                  </div>
                  <div className="space-y-1 md:col-span-2">
                    <Label htmlFor="workflow-description">Description</Label>
                    <Textarea
                      id="workflow-description"
                      rows={2}
                      value={workflowForm.description}
                      onChange={(event) =>
                        setWorkflowForm((current) => ({
                          ...current,
                          description: event.target.value,
                        }))
                      }
                      placeholder="Optional notes for workspace operators."
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="workflow-trigger">Trigger</Label>
                    <Select
                      value={workflowForm.trigger}
                      onValueChange={(value) =>
                        setWorkflowForm((current) => ({
                          ...current,
                          trigger: value as WorkflowTrigger,
                        }))
                      }
                    >
                      <SelectTrigger id="workflow-trigger">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="meeting.ingested">Meeting Ingested</SelectItem>
                        <SelectItem value="meeting.updated">Meeting Updated</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="workflow-enabled">Enabled</Label>
                    <div className="h-10 px-3 rounded-md border bg-background/70 flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">
                        {workflowForm.enabled ? "Active" : "Paused"}
                      </span>
                      <Switch
                        id="workflow-enabled"
                        checked={workflowForm.enabled}
                        onCheckedChange={(checked) =>
                          setWorkflowForm((current) => ({
                            ...current,
                            enabled: checked,
                          }))
                        }
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
                <h4 className="text-sm font-semibold">Destination</h4>
                <div className="space-y-1">
                  <Label htmlFor="workflow-destination-url">Webhook URL</Label>
                  <Input
                    id="workflow-destination-url"
                    value={workflowForm.destinationUrl}
                    onChange={(event) =>
                      setWorkflowForm((current) => ({
                        ...current,
                        destinationUrl: event.target.value,
                      }))
                    }
                    placeholder="https://example.com/webhooks/taskwise"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="workflow-destination-secret">Signing Secret (optional)</Label>
                  <Input
                    id="workflow-destination-secret"
                    type="password"
                    value={workflowForm.destinationSigningSecret}
                    onChange={(event) =>
                      setWorkflowForm((current) => ({
                        ...current,
                        destinationSigningSecret: event.target.value,
                      }))
                    }
                    placeholder="Provide a shared secret for signature verification"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="workflow-destination-headers">Headers JSON</Label>
                  <Textarea
                    id="workflow-destination-headers"
                    rows={4}
                    value={workflowForm.destinationHeadersJson}
                    onChange={(event) =>
                      setWorkflowForm((current) => ({
                        ...current,
                        destinationHeadersJson: event.target.value,
                      }))
                    }
                    placeholder='{"x-taskwise-env":"prod"}'
                    className="font-mono text-xs"
                  />
                </div>
              </div>

              <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-sm font-semibold">Filters</h4>
                  <Button variant="outline" size="sm" onClick={handleAddWorkflowFilter}>
                    Add Filter
                  </Button>
                </div>
                {workflowForm.filters.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No filters configured. This workflow will run for every matching trigger event.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {workflowForm.filters.map((filter, index) => {
                      const requiresNoValue = WORKFLOW_FILTER_OPERATORS_WITHOUT_VALUE.has(
                        filter.operator
                      );
                      return (
                        <div
                          key={filter.id}
                          className="rounded-md border bg-background/70 p-3 space-y-2"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-medium text-muted-foreground">
                              Filter {index + 1}
                            </span>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleRemoveWorkflowFilter(filter.id)}
                            >
                              Remove
                            </Button>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                            <div className="space-y-1">
                              <Label>Field</Label>
                              <Input
                                value={filter.field}
                                onChange={(event) =>
                                  handleWorkflowFilterChange(filter.id, {
                                    field: event.target.value,
                                  })
                                }
                                placeholder="meeting.summary"
                              />
                            </div>
                            <div className="space-y-1">
                              <Label>Operator</Label>
                              <Select
                                value={filter.operator}
                                onValueChange={(value) =>
                                  handleWorkflowFilterChange(filter.id, {
                                    operator: value as WorkflowFilterOperator,
                                  })
                                }
                              >
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {WORKFLOW_FILTER_OPERATOR_OPTIONS.map((option) => (
                                    <SelectItem key={option.value} value={option.value}>
                                      {option.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-1">
                              <Label>Value</Label>
                              <Input
                                value={filter.value}
                                onChange={(event) =>
                                  handleWorkflowFilterChange(filter.id, {
                                    value: event.target.value,
                                  })
                                }
                                placeholder={
                                  WORKFLOW_FILTER_OPERATORS_WITH_ARRAY_VALUE.has(filter.operator)
                                    ? "alpha,beta or [\"alpha\",\"beta\"]"
                                    : "Value"
                                }
                                disabled={requiresNoValue}
                              />
                            </div>
                          </div>
                          <div className="flex items-center justify-between rounded-md border bg-muted/20 px-3 py-2">
                            <span className="text-xs text-muted-foreground">
                              Case sensitive string matching
                            </span>
                            <Switch
                              checked={filter.caseSensitive}
                              onCheckedChange={(checked) =>
                                handleWorkflowFilterChange(filter.id, {
                                  caseSensitive: checked,
                                })
                              }
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
                <h4 className="text-sm font-semibold">Field Selection</h4>
                <div className="space-y-1">
                  <Label htmlFor="workflow-fields-mode">Payload Mode</Label>
                  <Select
                    value={workflowForm.fieldSelectionMode}
                    onValueChange={(value) =>
                      setWorkflowForm((current) => ({
                        ...current,
                        fieldSelectionMode: value as "all" | "subset",
                      }))
                    }
                  >
                    <SelectTrigger id="workflow-fields-mode">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All fields</SelectItem>
                      <SelectItem value="subset">Selected fields only</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {workflowForm.fieldSelectionMode === "subset" ? (
                  <div className="space-y-1">
                    <Label htmlFor="workflow-fields-list">Fields</Label>
                    <Textarea
                      id="workflow-fields-list"
                      rows={4}
                      value={workflowForm.fieldSelectionFields}
                      onChange={(event) =>
                        setWorkflowForm((current) => ({
                          ...current,
                          fieldSelectionFields: event.target.value,
                        }))
                      }
                      placeholder={"meeting.title\nmeeting.summary\nactionItems"}
                      className="font-mono text-xs"
                    />
                  </div>
                ) : null}
              </div>

              <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
                <h4 className="text-sm font-semibold">Transform</h4>
                <div className="grid grid-cols-1 md:grid-cols-[1fr_180px] gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="workflow-transform-script">QuickJS Script (optional)</Label>
                    <Textarea
                      id="workflow-transform-script"
                      rows={6}
                      value={workflowForm.transformScript}
                      onChange={(event) =>
                        setWorkflowForm((current) => ({
                          ...current,
                          transformScript: event.target.value,
                        }))
                      }
                      placeholder={"// input is the workflow payload\n// return transformed JSON"}
                      className="font-mono text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="workflow-transform-timeout">Timeout (ms)</Label>
                    <Input
                      id="workflow-transform-timeout"
                      type="number"
                      min={100}
                      max={10000}
                      value={workflowForm.transformTimeoutMs}
                      onChange={(event) =>
                        setWorkflowForm((current) => {
                          const parsed = Number.parseInt(event.target.value || "", 10);
                          return {
                            ...current,
                            transformTimeoutMs: Number.isFinite(parsed) ? parsed : 1000,
                          };
                        })
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      Allowed range: 100 to 10000 ms.
                    </p>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="space-y-1">
                    <h4 className="text-sm font-semibold">Playground</h4>
                    <p className="text-xs text-muted-foreground">
                      Preview matched meetings, selected payload, transform output, and test delivery.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void handleRunWorkflowPlayground()}
                      disabled={isRunningWorkflowPlayground || isSavingWorkflowEditor}
                    >
                      {isRunningWorkflowPlayground ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="mr-2 h-4 w-4" />
                      )}
                      Run Preview
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void handleSendWorkflowPlaygroundTestDelivery()}
                      disabled={
                        isSendingWorkflowPlaygroundTest ||
                        workflowEditorMode !== "edit" ||
                        !editingWorkflowId
                      }
                    >
                      {isSendingWorkflowPlaygroundTest ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="mr-2 h-4 w-4" />
                      )}
                      Send Test
                    </Button>
                  </div>
                </div>

                {workflowEditorMode !== "edit" ? (
                  <p className="text-xs text-muted-foreground">
                    Save this workflow first to run delivery tests against the configured destination.
                  </p>
                ) : null}

                {workflowPlaygroundPreview ? (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">
                        Meetings {workflowPlaygroundPreview.consideredMeetingCount}
                      </Badge>
                      <Badge variant="secondary">
                        Matched {workflowPlaygroundPreview.matchedMeetingCount}
                      </Badge>
                    </div>

                    {workflowPlaygroundPreview.meetings.length > 0 ? (
                      <div className="space-y-1">
                        <Label htmlFor="workflow-playground-meeting">
                          Preview Meeting
                        </Label>
                        <Select
                          value={
                            workflowPlaygroundMeetingId ||
                            workflowPlaygroundPreview.selectedMeeting?.id ||
                            ""
                          }
                          onValueChange={(value) =>
                            void handleWorkflowPlaygroundMeetingChange(value)
                          }
                          disabled={isRunningWorkflowPlayground}
                        >
                          <SelectTrigger id="workflow-playground-meeting">
                            <SelectValue placeholder="Select a meeting" />
                          </SelectTrigger>
                          <SelectContent>
                            {workflowPlaygroundPreview.meetings.map((meeting) => (
                              <SelectItem key={meeting.id} value={meeting.id}>
                                {meeting.matched ? "[Match] " : ""}{meeting.title}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ) : null}

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label>Selected Payload</Label>
                        <pre className="rounded-md border bg-background px-3 py-2 text-xs max-h-[240px] overflow-auto whitespace-pre-wrap">
                          {workflowPlaygroundPreview.selectedPayload
                            ? JSON.stringify(workflowPlaygroundPreview.selectedPayload, null, 2)
                            : workflowPlaygroundPreview.selectedPayloadError ||
                              "No payload preview available."}
                        </pre>
                        <p className="text-[11px] text-muted-foreground">
                          {workflowPlaygroundPreview.selectedPayloadBytes
                            ? `${workflowPlaygroundPreview.selectedPayloadBytes} bytes`
                            : "Size unavailable"}
                          {workflowPlaygroundPreview.selectedPayloadTruncated
                            ? " (truncated)"
                            : ""}
                        </p>
                      </div>

                      <div className="space-y-1">
                        <Label>Transform Output</Label>
                        <pre className="rounded-md border bg-background px-3 py-2 text-xs max-h-[240px] overflow-auto whitespace-pre-wrap">
                          {workflowPlaygroundPreview.transformOutput
                            ? JSON.stringify(workflowPlaygroundPreview.transformOutput, null, 2)
                            : workflowPlaygroundPreview.transformOutputError?.message ||
                              "No transform output preview available."}
                        </pre>
                        <p className="text-[11px] text-muted-foreground">
                          {workflowPlaygroundPreview.transformOutputBytes
                            ? `${workflowPlaygroundPreview.transformOutputBytes} bytes`
                            : "Size unavailable"}
                          {workflowPlaygroundPreview.transformOutputTruncated
                            ? " (truncated)"
                            : ""}
                        </p>
                      </div>
                    </div>

                    {workflowPlaygroundTestResult ? (
                      <div className="rounded-md border bg-background/70 p-3 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge
                            variant={
                              workflowPlaygroundTestResult.responseOk ? "secondary" : "outline"
                            }
                          >
                            {workflowPlaygroundTestResult.responseOk ? "Success" : "Failed"}
                          </Badge>
                          {typeof workflowPlaygroundTestResult.responseStatusCode === "number" ? (
                            <Badge variant="outline">
                              HTTP {workflowPlaygroundTestResult.responseStatusCode}
                            </Badge>
                          ) : null}
                          {workflowPlaygroundTestResult.deliveryStatus ? (
                            <Badge variant="outline">
                              Delivery {workflowPlaygroundTestResult.deliveryStatus}
                            </Badge>
                          ) : null}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {workflowPlaygroundTestResult.message}
                        </p>
                        {workflowPlaygroundTestResult.deliveryId ? (
                          <p className="text-[11px] text-muted-foreground">
                            Delivery ID: {workflowPlaygroundTestResult.deliveryId}
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Run preview to inspect matching meetings and payload output.
                  </p>
                )}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => handleWorkflowEditorOpenChange(false)}
              disabled={isSavingWorkflowEditor}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void handleSaveWorkflowEditor()}
              disabled={isSavingWorkflowEditor || isLoadingWorkflowEditor}
            >
              {isSavingWorkflowEditor ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              {workflowEditorMode === "edit" ? "Save Workflow" : "Create Workflow"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
