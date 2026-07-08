import {
  createOrReuseCompany,
  findMatchingCompany,
  looksLikeDomain,
  normalizeCompanyKey,
  resolveCompanyForPerson,
  serializeCompany,
  syncCompaniesFromClientPeople,
  updateCompany,
  type CompanyDoc,
} from "@/lib/companies";

/**
 * Minimal in-memory companies collection implementing exactly the driver
 * subset src/lib/companies.ts uses (findOne by _id+workspaceId, find by
 * workspaceId / $or clauses, insertOne, updateOne $set, createIndex).
 */
const buildFakeDb = () => {
  const docs: CompanyDoc[] = [];

  const matches = (doc: any, query: any): boolean => {
    for (const [key, value] of Object.entries(query)) {
      if (key === "$or") {
        const clauses = value as any[];
        if (!clauses.some((clause) => matches(doc, clause))) return false;
        continue;
      }
      if ((doc as any)[key] !== value) return false;
    }
    return true;
  };

  const collection = {
    createIndex: jest.fn().mockResolvedValue("ok"),
    findOne: jest.fn(async (query: any) => docs.find((doc) => matches(doc, query)) ?? null),
    find: jest.fn((query: any) => {
      const results = docs.filter((doc) => matches(doc, query));
      const cursor: any = {
        sort: jest.fn((): any => cursor),
        toArray: jest.fn(async () => results.map((doc) => ({ ...doc }))),
      };
      return cursor;
    }),
    insertOne: jest.fn(async (doc: CompanyDoc) => {
      docs.push({ ...doc });
      return { insertedId: doc._id };
    }),
    updateOne: jest.fn(async (query: any, update: any) => {
      const doc = docs.find((entry) => matches(entry, query));
      if (doc && update.$set) Object.assign(doc, update.$set);
      return { matchedCount: doc ? 1 : 0 };
    }),
  };

  const db = {
    collection: jest.fn((name: string) => {
      if (name !== "companies") {
        throw new Error(`Unexpected collection in test: ${name}`);
      }
      return collection;
    }),
  } as any;

  return { db, docs, collection };
};

const WORKSPACE = "workspace-1";
const USER = "user-1";

describe("companies lib", () => {
  describe("normalizeCompanyKey / looksLikeDomain", () => {
    it("lowercases, trims, and collapses whitespace", () => {
      expect(normalizeCompanyKey("  Acme   Corp ")).toBe("acme corp");
      expect(normalizeCompanyKey(null)).toBe("");
    });

    it("detects bare domains", () => {
      expect(looksLikeDomain("acme.com")).toBe(true);
      expect(looksLikeDomain("sub.acme.io")).toBe(true);
      expect(looksLikeDomain("Acme Corp")).toBe(false);
    });
  });

  describe("resolveCompanyForPerson", () => {
    it("creates a domain company for a client with an external email", async () => {
      const { db, docs } = buildFakeDb();
      const company = await resolveCompanyForPerson(db, {
        workspaceId: WORKSPACE,
        userId: USER,
        person: { _id: "p1", name: "Jane", email: "jane@acme.com" },
      });
      expect(company).not.toBeNull();
      expect(company!.name).toBe("acme.com");
      expect(company!.domain).toBe("acme.com");
      expect(company!.peopleIds).toContain("p1");
      expect(docs).toHaveLength(1);
    });

    it("is idempotent — re-resolving the same person creates no duplicate", async () => {
      const { db, docs } = buildFakeDb();
      const person = { _id: "p1", name: "Jane", email: "jane@acme.com" };
      const first = await resolveCompanyForPerson(db, {
        workspaceId: WORKSPACE,
        userId: USER,
        person,
      });
      const second = await resolveCompanyForPerson(db, {
        workspaceId: WORKSPACE,
        userId: USER,
        person,
      });
      expect(docs).toHaveLength(1);
      expect(second!._id).toBe(first!._id);
      expect(second!.peopleIds).toEqual(["p1"]);
    });

    it("manual company assignment overrides domain inference", async () => {
      const { db, docs } = buildFakeDb();
      const company = await resolveCompanyForPerson(db, {
        workspaceId: WORKSPACE,
        userId: USER,
        person: {
          _id: "p1",
          name: "Bob",
          email: "bob@other.com",
          company: "Acme Corp",
        },
      });
      expect(company!.name).toBe("Acme Corp");
      // Manual names never absorb the person's email domain.
      expect(company!.domain).toBeNull();
      expect(docs).toHaveLength(1);
      expect(docs[0].nameKey).toBe("acme corp");
    });

    it("returns null for free/consumer email domains", async () => {
      const { db, docs } = buildFakeDb();
      const company = await resolveCompanyForPerson(db, {
        workspaceId: WORKSPACE,
        userId: USER,
        person: { _id: "p1", name: "Gmail Guy", email: "guy@gmail.com" },
      });
      expect(company).toBeNull();
      expect(docs).toHaveLength(0);
    });

    it("dedupes by domain — a domain-only person joins the named company", async () => {
      const { db, docs } = buildFakeDb();
      await createOrReuseCompany(db, {
        workspaceId: WORKSPACE,
        userId: USER,
        name: "Acme",
        domain: "acme.com",
      });
      const company = await resolveCompanyForPerson(db, {
        workspaceId: WORKSPACE,
        userId: USER,
        person: { _id: "p2", name: "Jane", email: "jane@acme.com" },
      });
      expect(docs).toHaveLength(1);
      expect(company!.name).toBe("Acme");
      expect(company!.peopleIds).toContain("p2");
    });
  });

  describe("createOrReuseCompany", () => {
    it("dedupes by alias key and merges aliases", async () => {
      const { db, docs } = buildFakeDb();
      const { company: original } = await createOrReuseCompany(db, {
        workspaceId: WORKSPACE,
        userId: USER,
        name: "Acme",
        aliases: ["ACME Inc"],
      });
      const { company: reused, created } = await createOrReuseCompany(db, {
        workspaceId: WORKSPACE,
        userId: USER,
        name: "acme inc",
        domain: "acme.com",
      });
      expect(created).toBe(false);
      expect(reused._id).toBe(original._id);
      // Missing domain gets filled in by the reuse.
      expect(reused.domain).toBe("acme.com");
      expect(docs).toHaveLength(1);
    });

    it("records a differing incoming name as an alias", async () => {
      const { db } = buildFakeDb();
      await createOrReuseCompany(db, {
        workspaceId: WORKSPACE,
        userId: USER,
        name: "acme.com",
        domain: "acme.com",
      });
      const { company } = await createOrReuseCompany(db, {
        workspaceId: WORKSPACE,
        userId: USER,
        name: "Acme Corporation",
        domain: "acme.com",
      });
      expect(company.aliases).toContain("Acme Corporation");
    });

    it("rejects empty names", async () => {
      const { db } = buildFakeDb();
      await expect(
        createOrReuseCompany(db, {
          workspaceId: WORKSPACE,
          userId: USER,
          name: "   ",
        })
      ).rejects.toThrow("Company name is required.");
    });
  });

  describe("syncCompaniesFromClientPeople", () => {
    it("moves a person between companies when their assignment changes", async () => {
      const { db, docs } = buildFakeDb();
      const person = { _id: "p1", name: "Bob", email: "bob@acme.com" };

      await syncCompaniesFromClientPeople(db, {
        workspaceId: WORKSPACE,
        userId: USER,
        people: [person],
      });
      expect(docs).toHaveLength(1);
      expect(docs[0].peopleIds).toEqual(["p1"]);

      // Manual assignment now overrides the acme.com inference.
      await syncCompaniesFromClientPeople(db, {
        workspaceId: WORKSPACE,
        userId: USER,
        people: [{ ...person, company: "Beta LLC" }],
      });

      const acme = docs.find((doc) => doc.domain === "acme.com");
      const beta = docs.find((doc) => doc.nameKey === "beta llc");
      expect(beta!.peopleIds).toEqual(["p1"]);
      expect(acme!.peopleIds).toEqual([]);
    });

    it("leaves people it was not given untouched", async () => {
      const { db, docs } = buildFakeDb();
      await createOrReuseCompany(db, {
        workspaceId: WORKSPACE,
        userId: USER,
        name: "Acme",
        domain: "acme.com",
        peopleIds: ["manual-person"],
      });
      await syncCompaniesFromClientPeople(db, {
        workspaceId: WORKSPACE,
        userId: USER,
        people: [{ _id: "p1", name: "Jane", email: "jane@acme.com" }],
      });
      expect(docs).toHaveLength(1);
      expect(docs[0].peopleIds).toEqual(
        expect.arrayContaining(["manual-person", "p1"])
      );
    });
  });

  describe("updateCompany / findMatchingCompany / serializeCompany", () => {
    it("updates whitelisted fields and normalizes them", async () => {
      const { db } = buildFakeDb();
      const { company } = await createOrReuseCompany(db, {
        workspaceId: WORKSPACE,
        userId: USER,
        name: "Acme",
      });
      const updated = await updateCompany(db, WORKSPACE, company._id, {
        name: "  Acme Corp ",
        domain: "ACME.com",
        aliases: ["Acme", "Acme", ""],
        peopleIds: ["p1", "p1"],
      });
      expect(updated!.name).toBe("Acme Corp");
      expect(updated!.nameKey).toBe("acme corp");
      expect(updated!.domain).toBe("acme.com");
      expect(updated!.aliases).toEqual(["Acme"]);
      expect(updated!.peopleIds).toEqual(["p1"]);
    });

    it("returns null for a company outside the workspace", async () => {
      const { db } = buildFakeDb();
      const { company } = await createOrReuseCompany(db, {
        workspaceId: WORKSPACE,
        userId: USER,
        name: "Acme",
      });
      const updated = await updateCompany(db, "other-workspace", company._id, {
        name: "Nope",
      });
      expect(updated).toBeNull();
    });

    it("findMatchingCompany matches by name key before domain", async () => {
      const { db } = buildFakeDb();
      await createOrReuseCompany(db, {
        workspaceId: WORKSPACE,
        userId: USER,
        name: "Acme",
        domain: "acme.com",
      });
      const byName = await findMatchingCompany(db, WORKSPACE, { name: "ACME" });
      expect(byName!.name).toBe("Acme");
      const byDomain = await findMatchingCompany(db, WORKSPACE, {
        domain: "acme.com",
      });
      expect(byDomain!.name).toBe("Acme");
      const none = await findMatchingCompany(db, WORKSPACE, { name: "" });
      expect(none).toBeNull();
    });

    it("serializeCompany converts dates and strips internals", () => {
      const now = new Date("2026-07-01T00:00:00.000Z");
      const serialized = serializeCompany({
        _id: "c1",
        workspaceId: WORKSPACE,
        userId: USER,
        name: "Acme",
        nameKey: "acme",
        domain: "acme.com",
        aliases: ["ACME"],
        peopleIds: ["p1"],
        createdAt: now,
        updatedAt: now,
      });
      expect(serialized).toEqual({
        id: "c1",
        workspaceId: WORKSPACE,
        name: "Acme",
        domain: "acme.com",
        aliases: ["ACME"],
        peopleIds: ["p1"],
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-01T00:00:00.000Z",
      });
    });
  });
});
