import { ObjectId } from "mongodb";
import type { Db } from "mongodb";

export type PersonClassificationType = "teammate" | "client" | "unknown";

export type PersonClassification = {
  personType: PersonClassificationType;
  reason: string;
};

export const SLACK_TEAMMATE_REASON = "Synced from your Slack workspace";

// Common free/consumer email providers — these domains never count as a
// company/internal domain for classification purposes.
export const FREE_EMAIL_DOMAINS: Set<string> = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "gmx.com",
  "mail.com",
  "yandex.com",
  "zoho.com",
  "msn.com",
  "qq.com",
  "163.com",
  "126.com",
]);

export const extractEmailDomain = (email?: string | null): string | null => {
  if (typeof email !== "string") return null;
  const trimmed = email.trim().toLowerCase();
  if (!trimmed) return null;
  const atIndex = trimmed.lastIndexOf("@");
  if (atIndex <= 0 || atIndex === trimmed.length - 1) return null;
  const domain = trimmed.slice(atIndex + 1);
  if (!domain.includes(".") || /\s/.test(domain)) return null;
  return domain;
};

// Domains of the workspace member users' emails (users collection lookup by
// _id), excluding free-mail domains — used as the "internal" domain set when
// classifying people as teammates vs clients.
export const resolveInternalDomains = async (
  db: Db,
  workspaceScope: { userIds: string[] }
): Promise<Set<string>> => {
  const userIds = Array.from(
    new Set(
      (workspaceScope.userIds || []).filter(
        (id): id is string => typeof id === "string" && Boolean(id.trim())
      )
    )
  );
  const domains = new Set<string>();
  if (!userIds.length) return domains;

  const objectIds = userIds
    .filter((userId) => ObjectId.isValid(userId))
    .map((userId) => new ObjectId(userId));
  const users = await db
    .collection("users")
    .find(
      {
        $or: [
          ...(objectIds.length ? [{ _id: { $in: objectIds } }] : []),
          { id: { $in: userIds } },
        ],
      } as any,
      { projection: { email: 1 } }
    )
    .toArray();

  for (const user of users) {
    const domain = extractEmailDomain((user as { email?: string | null }).email);
    if (domain && !FREE_EMAIL_DOMAINS.has(domain)) {
      domains.add(domain);
    }
  }

  return domains;
};

export const classifyPersonHeuristic = (
  person: { email?: string | null; slackId?: string | null },
  internalDomains: Set<string>
): PersonClassification => {
  if (typeof person.slackId === "string" && person.slackId.trim()) {
    return { personType: "teammate", reason: SLACK_TEAMMATE_REASON };
  }

  const domain = extractEmailDomain(person.email);
  if (!domain) {
    return { personType: "unknown", reason: "No email on file" };
  }
  if (internalDomains.has(domain)) {
    return {
      personType: "teammate",
      reason: `Email domain @${domain} matches your team`,
    };
  }
  if (FREE_EMAIL_DOMAINS.has(domain)) {
    return {
      personType: "unknown",
      reason: `Free email provider @${domain}`,
    };
  }
  return { personType: "client", reason: `External email domain @${domain}` };
};
