const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

const isEnabled = (value: string | undefined, defaultValue = false) => {
  if (typeof value !== "string") {
    return defaultValue;
  }
  return TRUE_VALUES.has(value.trim().toLowerCase());
};

export const isWorkspaceSwitcherEnabled = () =>
  isEnabled(process.env.WORKSPACE_SWITCHER_ENABLED, false);

export const isWorkspaceMembershipGuardEnabled = () =>
  isEnabled(process.env.WORKSPACE_MEMBERSHIP_GUARD_ENABLED, false);

export const isWorkspaceInviteMembershipModeEnabled = () =>
  isEnabled(process.env.WORKSPACE_INVITE_MEMBERSHIP_MODE_ENABLED, false);

export const getWorkspaceFlagSnapshot = () => ({
  workspaceSwitcher: isWorkspaceSwitcherEnabled(),
  workspaceMembershipGuard: isWorkspaceMembershipGuardEnabled(),
  workspaceInviteMembershipMode: isWorkspaceInviteMembershipModeEnabled(),
});
