import { apiError } from "@/lib/api-route";
import { getSessionUserId } from "@/lib/server-auth";

const trelloDisabled = () =>
  apiError(
    503,
    "integration_disabled",
    "Trello integration is currently disabled while legacy Firebase functions are retired."
  );

export async function POST() {
  const userId = await getSessionUserId();
  if (!userId) {
    return apiError(401, "unauthorized", "Unauthorized");
  }
  return trelloDisabled();
}
