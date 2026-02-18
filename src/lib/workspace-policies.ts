export type InviteAcceptSwitchPolicy = "switch_if_no_active_workspace" | "always_switch";

// Run-1 decision: accepting an invite only auto-switches when the user has no active workspace.
export const INVITE_ACCEPT_SWITCH_POLICY: InviteAcceptSwitchPolicy =
  "switch_if_no_active_workspace";
