/**
 * Priority 9 — first-class company/account model for client profiles.
 *
 * Collection: `companies`. String UUID `_id`s, workspace-scoped, following the
 * src/lib/meeting-connections.ts conventions (ensureIndexes helper, plain
 * driver calls, serializer that converts dates to ISO strings).
 *
 * Resolution rules (manual assignment always overrides domain inference):
 *
 * 1. When a person carries a manually assigned `company` string, they resolve
 *    to the company matching that name (by normalized name key, alias key, or
 *    — when the string looks like a domain — the domain field). A new company
 *    is created from the manual name when nothing matches. The person's email
 *    domain is deliberately NOT attached to a manually named company: binding
 *    an inferred domain to a hand-picked account could silently pull in
 *    unrelated people who happen to share the domain.
 * 2. Otherwise the person's email domain (external, non-free — see
 *    FREE_EMAIL_DOMAINS) resolves to the company with that `domain` (or whose
 *    name/alias key equals the domain). A new company named after the domain
 *    is created when nothing matches.
 * 3. People with neither a manual company nor a usable domain resolve to no
 *    company at all (the clients page keeps its local "No company" bucket).
 *
 * Dedupe: create/resolve matches existing companies by normalized name key,
 * alias keys, and domain, so re-running the sync never inserts duplicates.
 */

import { randomUUID } from "crypto";
import type { Db } from "mongodb";
import {
  extractEmailDomain,
  FREE_EMAIL_DOMAINS,
} from "@/lib/person-classification";
import type { Company } from "@/types/company";

export interface CompanyDoc {
  _id: string;
  workspaceId: string;
  /** User who first created/derived the company. */
  userId: string;
  name: string;
  /** Normalized name used for dedupe (see normalizeCompanyKey). */
  nameKey: string;
  domain: string | null;
  aliases: string[];
  peopleIds: string[];
  createdAt: Date;
  updatedAt: Date;
}

export const COMPANIES_COLLECTION = "companies";

const getCompaniesCollection = (db: Db) =>
  db.collection<CompanyDoc>(COMPANIES_COLLECTION);

/** Lowercased, trimmed, whitespace-collapsed key for name/alias matching. */
export const normalizeCompanyKey = (value: string | null | undefined): string =>
  typeof value === "string" ? value.trim().toLowerCase().replace(/\s+/g, " ") : "";

const DOMAIN_LIKE_REGEX = /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i;

/** True when a manual company string is actually a bare domain ("acme.com"). */
export const looksLikeDomain = (value: string): boolean =>
  DOMAIN_LIKE_REGEX.test(value.trim());

const normalizeDomain = (value: string | null | undefined): string | null => {
  const normalized = normalizeCompanyKey(value);
  return normalized && looksLikeDomain(normalized) ? normalized : null;
};

const normalizeAliases = (aliases: unknown): string[] => {
  if (!Array.isArray(aliases)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const alias of aliases) {
    if (typeof alias !== "string") continue;
    const trimmed = alias.trim();
    const key = normalizeCompanyKey(trimmed);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
};

const companyAliasKeys = (company: Pick<CompanyDoc, "aliases">): Set<string> =>
  new Set(
    (company.aliases || [])
      .map((alias) => normalizeCompanyKey(alias))
      .filter(Boolean)
  );

let companyIndexesPromise: Promise<void> | null = null;

export const ensureCompanyIndexes = async (db: Db) => {
  if (companyIndexesPromise) {
    await companyIndexesPromise;
    return;
  }

  companyIndexesPromise = (async () => {
    const collection = getCompaniesCollection(db);
    if (!collection || typeof collection.createIndex !== "function") {
      return;
    }
    try {
      await Promise.all([
        collection.createIndex(
          { workspaceId: 1, nameKey: 1 },
          { unique: true, name: "companies_workspace_name_key_unique" }
        ),
        collection.createIndex(
          { workspaceId: 1, domain: 1 },
          {
            name: "companies_workspace_domain",
            partialFilterExpression: { domain: { $type: "string" } },
          }
        ),
        collection.createIndex(
          { workspaceId: 1, peopleIds: 1 },
          { name: "companies_workspace_people" }
        ),
      ]);
    } catch (error) {
      console.warn("Failed to ensure companies indexes:", error);
    }
  })();

  await companyIndexesPromise;
};

export const listCompaniesForWorkspace = async (
  db: Db,
  workspaceId: string
): Promise<CompanyDoc[]> =>
  getCompaniesCollection(db)
    .find({ workspaceId } as any)
    .sort({ updatedAt: -1, createdAt: -1 })
    .toArray();

export const findCompanyById = async (
  db: Db,
  workspaceId: string,
  companyId: string
): Promise<CompanyDoc | null> =>
  getCompaniesCollection(db).findOne({ _id: companyId, workspaceId } as any);

/**
 * Find an existing workspace company matching a candidate name and/or domain
 * (normalized name key, alias key, or domain — in that precedence order).
 */
export const findMatchingCompany = async (
  db: Db,
  workspaceId: string,
  candidate: { name?: string | null; domain?: string | null }
): Promise<CompanyDoc | null> => {
  const nameKey = normalizeCompanyKey(candidate.name);
  const domain = normalizeDomain(candidate.domain) ?? normalizeDomain(candidate.name);

  const orClauses: Record<string, unknown>[] = [];
  if (nameKey) orClauses.push({ nameKey });
  if (domain) orClauses.push({ domain });
  if (!orClauses.length) return null;

  const matches = await getCompaniesCollection(db)
    .find({ workspaceId, $or: orClauses } as any)
    .toArray();
  if (!matches.length) {
    if (!nameKey) return null;
    // Alias keys are not stored — check them in code over a bounded scan.
    const all = await listCompaniesForWorkspace(db, workspaceId);
    return all.find((company) => companyAliasKeys(company).has(nameKey)) ?? null;
  }

  // Prefer the exact name-key match, then the domain match.
  return (
    matches.find((company) => nameKey && company.nameKey === nameKey) ??
    matches.find((company) => domain && company.domain === domain) ??
    matches[0]
  );
};

export interface CreateCompanyInput {
  workspaceId: string;
  userId: string;
  name: string;
  domain?: string | null;
  aliases?: string[];
  peopleIds?: string[];
}

/**
 * Create a company, deduping against existing companies by name key, alias
 * key, and domain. When a match exists it is reused: missing domain is filled
 * in, new aliases and peopleIds are unioned. Never inserts a duplicate.
 */
export const createOrReuseCompany = async (
  db: Db,
  input: CreateCompanyInput
): Promise<{ company: CompanyDoc; created: boolean }> => {
  await ensureCompanyIndexes(db);
  const name = input.name.trim();
  const nameKey = normalizeCompanyKey(name);
  if (!nameKey) {
    throw new Error("Company name is required.");
  }
  const domain = normalizeDomain(input.domain) ?? normalizeDomain(name);
  const aliases = normalizeAliases(input.aliases);
  const peopleIds = Array.from(
    new Set((input.peopleIds || []).map(String).filter(Boolean))
  );
  const now = new Date();

  const existing = await findMatchingCompany(db, input.workspaceId, {
    name,
    domain,
  });
  if (existing) {
    const mergedAliasKeys = companyAliasKeys(existing);
    const mergedAliases = [...(existing.aliases || [])];
    for (const alias of aliases) {
      const key = normalizeCompanyKey(alias);
      if (!key || key === existing.nameKey || mergedAliasKeys.has(key)) continue;
      mergedAliasKeys.add(key);
      mergedAliases.push(alias);
    }
    // Record the incoming name as an alias when it differs from the match.
    if (nameKey !== existing.nameKey && !mergedAliasKeys.has(nameKey)) {
      mergedAliases.push(name);
      mergedAliasKeys.add(nameKey);
    }
    const mergedPeopleIds = Array.from(
      new Set([...(existing.peopleIds || []), ...peopleIds])
    );
    const update: Partial<CompanyDoc> = {
      domain: existing.domain || domain || null,
      aliases: mergedAliases,
      peopleIds: mergedPeopleIds,
      updatedAt: now,
    };
    await getCompaniesCollection(db).updateOne(
      { _id: existing._id } as any,
      { $set: update }
    );
    return { company: { ...existing, ...update } as CompanyDoc, created: false };
  }

  const company: CompanyDoc = {
    _id: randomUUID(),
    workspaceId: input.workspaceId,
    userId: input.userId,
    name,
    nameKey,
    domain: domain || null,
    aliases,
    peopleIds,
    createdAt: now,
    updatedAt: now,
  };
  await getCompaniesCollection(db).insertOne(company as any);
  return { company, created: true };
};

export interface UpdateCompanyPatch {
  name?: string;
  domain?: string | null;
  aliases?: string[];
  peopleIds?: string[];
}

export const updateCompany = async (
  db: Db,
  workspaceId: string,
  companyId: string,
  patch: UpdateCompanyPatch
): Promise<CompanyDoc | null> => {
  const existing = await findCompanyById(db, workspaceId, companyId);
  if (!existing) return null;

  const update: Partial<CompanyDoc> = { updatedAt: new Date() };
  if (typeof patch.name === "string" && patch.name.trim()) {
    update.name = patch.name.trim();
    update.nameKey = normalizeCompanyKey(patch.name);
  }
  if (patch.domain !== undefined) {
    update.domain = normalizeDomain(patch.domain);
  }
  if (patch.aliases !== undefined) {
    update.aliases = normalizeAliases(patch.aliases);
  }
  if (patch.peopleIds !== undefined) {
    update.peopleIds = Array.from(
      new Set((patch.peopleIds || []).map(String).filter(Boolean))
    );
  }

  await getCompaniesCollection(db).updateOne(
    { _id: existing._id } as any,
    { $set: update }
  );
  return { ...existing, ...update } as CompanyDoc;
};

/** Minimal person shape the resolver needs. */
export interface CompanyResolvablePerson {
  _id?: unknown;
  id?: unknown;
  name?: string | null;
  email?: string | null;
  company?: string | null;
}

const personId = (person: CompanyResolvablePerson): string =>
  String(person._id ?? person.id ?? "").trim();

/**
 * Resolve (or create) the company a person belongs to. Manual `company`
 * assignment overrides domain inference; free/consumer email domains never
 * produce a company. Returns null when the person maps to no company.
 * The person's id is added to the company's peopleIds.
 */
export const resolveCompanyForPerson = async (
  db: Db,
  input: {
    workspaceId: string;
    userId: string;
    person: CompanyResolvablePerson;
  }
): Promise<CompanyDoc | null> => {
  const { person } = input;
  const id = personId(person);

  const manualName =
    typeof person.company === "string" ? person.company.trim() : "";
  if (manualName) {
    const { company } = await createOrReuseCompany(db, {
      workspaceId: input.workspaceId,
      userId: input.userId,
      name: manualName,
      peopleIds: id ? [id] : [],
    });
    return company;
  }

  const domain = extractEmailDomain(person.email);
  if (!domain || FREE_EMAIL_DOMAINS.has(domain)) return null;

  const { company } = await createOrReuseCompany(db, {
    workspaceId: input.workspaceId,
    userId: input.userId,
    name: domain,
    domain,
    peopleIds: id ? [id] : [],
  });
  return company;
};

/**
 * Bulk resolve-or-create used by the clients page: resolves every given
 * (client) person to a company, then reconciles membership so a person whose
 * assignment changed is removed from companies they no longer resolve to.
 * People not in the input list are never touched, so manual peopleIds edits
 * survive. Idempotent — re-running with the same input changes nothing.
 */
export const syncCompaniesFromClientPeople = async (
  db: Db,
  input: {
    workspaceId: string;
    userId: string;
    people: CompanyResolvablePerson[];
  }
): Promise<CompanyDoc[]> => {
  await ensureCompanyIndexes(db);
  const resolvedCompanyByPersonId = new Map<string, string | null>();

  for (const person of input.people) {
    const id = personId(person);
    if (!id) continue;
    const company = await resolveCompanyForPerson(db, {
      workspaceId: input.workspaceId,
      userId: input.userId,
      person,
    });
    resolvedCompanyByPersonId.set(id, company ? company._id : null);
  }

  // Remove synced people from companies they no longer resolve to.
  const companies = await listCompaniesForWorkspace(db, input.workspaceId);
  for (const company of companies) {
    const stalePersonIds = (company.peopleIds || []).filter((pid) => {
      const resolved = resolvedCompanyByPersonId.get(String(pid));
      return resolved !== undefined && resolved !== company._id;
    });
    if (!stalePersonIds.length) continue;
    company.peopleIds = (company.peopleIds || []).filter(
      (pid) => !stalePersonIds.includes(pid)
    );
    await getCompaniesCollection(db).updateOne(
      { _id: company._id } as any,
      { $set: { peopleIds: company.peopleIds, updatedAt: new Date() } }
    );
  }

  return companies;
};

const serializeDate = (value: Date | string | null | undefined): string | null => {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
};

export const serializeCompany = (company: CompanyDoc): Company => ({
  id: company._id,
  workspaceId: company.workspaceId,
  name: company.name,
  domain: company.domain || null,
  aliases: company.aliases || [],
  peopleIds: company.peopleIds || [],
  createdAt: serializeDate(company.createdAt),
  updatedAt: serializeDate(company.updatedAt),
});
