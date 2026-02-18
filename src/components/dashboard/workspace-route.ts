export const buildWorkspaceRoute = (
  pathname: string | null,
  nextWorkspaceId: string
) => {
  if (!pathname || !pathname.startsWith("/workspaces/")) {
    return pathname || "/meetings";
  }
  const segments = pathname.split("/");
  if (segments.length < 3 || !segments[2]) {
    return `/workspaces/${nextWorkspaceId}/board`;
  }
  segments[2] = nextWorkspaceId;
  return segments.join("/") || `/workspaces/${nextWorkspaceId}/board`;
};
