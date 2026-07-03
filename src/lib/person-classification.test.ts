import {
  FREE_EMAIL_DOMAINS,
  classifyPersonHeuristic,
  extractEmailDomain,
  resolveInternalDomains,
} from "@/lib/person-classification";

describe("person-classification", () => {
  describe("extractEmailDomain", () => {
    const cases: Array<{
      name: string;
      email: string | null | undefined;
      expected: string | null;
    }> = [
      { name: "plain email", email: "jane@acme.com", expected: "acme.com" },
      {
        name: "uppercase is lowercased",
        email: "Jane@ACME.COM",
        expected: "acme.com",
      },
      {
        name: "surrounding whitespace trimmed",
        email: "  jane@acme.com  ",
        expected: "acme.com",
      },
      {
        name: "subdomain preserved",
        email: "jane@mail.acme.co.uk",
        expected: "mail.acme.co.uk",
      },
      { name: "no at sign", email: "janeacme.com", expected: null },
      { name: "missing local part", email: "@acme.com", expected: null },
      { name: "missing domain", email: "jane@", expected: null },
      { name: "domain without dot", email: "jane@localhost", expected: null },
      { name: "empty string", email: "", expected: null },
      { name: "null", email: null, expected: null },
      { name: "undefined", email: undefined, expected: null },
    ];

    it.each(cases)("$name", ({ email, expected }) => {
      expect(extractEmailDomain(email)).toBe(expected);
    });
  });

  describe("FREE_EMAIL_DOMAINS", () => {
    it("contains the expected providers", () => {
      for (const domain of [
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
      ]) {
        expect(FREE_EMAIL_DOMAINS.has(domain)).toBe(true);
      }
    });
  });

  describe("classifyPersonHeuristic", () => {
    const internalDomains = new Set(["acme.com"]);

    const cases: Array<{
      name: string;
      person: { email?: string | null; slackId?: string | null };
      expectedType: "teammate" | "client" | "unknown";
      expectedReason: string;
    }> = [
      {
        name: "slackId beats everything (even an external domain email)",
        person: { email: "jane@othercorp.com", slackId: "U123" },
        expectedType: "teammate",
        expectedReason: "Synced from your Slack workspace",
      },
      {
        name: "slackId with no email is a teammate",
        person: { slackId: "U123" },
        expectedType: "teammate",
        expectedReason: "Synced from your Slack workspace",
      },
      {
        name: "internal domain email is a teammate",
        person: { email: "jane@acme.com", slackId: null },
        expectedType: "teammate",
        expectedReason: "Email domain @acme.com matches your team",
      },
      {
        name: "external non-free domain email is a client",
        person: { email: "bob@clientco.io", slackId: null },
        expectedType: "client",
        expectedReason: "External email domain @clientco.io",
      },
      {
        name: "free-mail email is unknown",
        person: { email: "bob@gmail.com", slackId: null },
        expectedType: "unknown",
        expectedReason: "Free email provider @gmail.com",
      },
      {
        name: "missing email is unknown",
        person: { email: null, slackId: null },
        expectedType: "unknown",
        expectedReason: "No email on file",
      },
      {
        name: "invalid email is unknown",
        person: { email: "not-an-email", slackId: null },
        expectedType: "unknown",
        expectedReason: "No email on file",
      },
      {
        name: "blank slackId does not count as slack-synced",
        person: { email: "bob@clientco.io", slackId: "   " },
        expectedType: "client",
        expectedReason: "External email domain @clientco.io",
      },
    ];

    it.each(cases)("$name", ({ person, expectedType, expectedReason }) => {
      const result = classifyPersonHeuristic(person, internalDomains);
      expect(result.personType).toBe(expectedType);
      expect(result.reason).toBe(expectedReason);
    });
  });

  describe("resolveInternalDomains", () => {
    it("returns member email domains, excluding free-mail domains", async () => {
      const toArray = jest.fn().mockResolvedValue([
        { _id: "507f1f77bcf86cd799439011", email: "owner@acme.com" },
        { _id: "507f1f77bcf86cd799439012", email: "member@subsidiary.io" },
        { _id: "507f1f77bcf86cd799439013", email: "freelancer@gmail.com" },
        { _id: "507f1f77bcf86cd799439014", email: null },
      ]);
      const find = jest.fn(() => ({ toArray }));
      const db = {
        collection: jest.fn((name: string) => {
          if (name === "users") {
            return { find };
          }
          throw new Error(`Unexpected collection: ${name}`);
        }),
      } as any;

      const domains = await resolveInternalDomains(db, {
        userIds: [
          "507f1f77bcf86cd799439011",
          "507f1f77bcf86cd799439012",
          "507f1f77bcf86cd799439013",
          "507f1f77bcf86cd799439014",
        ],
      });

      expect(db.collection).toHaveBeenCalledWith("users");
      expect(find).toHaveBeenCalledTimes(1);
      const [query, options] = find.mock.calls[0] as unknown as [any, any];
      expect(query.$or).toBeDefined();
      expect(options).toEqual({ projection: { email: 1 } });
      expect(domains).toEqual(new Set(["acme.com", "subsidiary.io"]));
    });

    it("tolerates non-ObjectId user ids", async () => {
      const toArray = jest
        .fn()
        .mockResolvedValue([{ id: "user-1", email: "owner@acme.com" }]);
      const find = jest.fn(() => ({ toArray }));
      const db = {
        collection: jest.fn(() => ({ find })),
      } as any;

      const domains = await resolveInternalDomains(db, {
        userIds: ["user-1"],
      });

      expect(find).toHaveBeenCalledTimes(1);
      const [query] = find.mock.calls[0] as unknown as [any];
      expect(query.$or).toEqual([{ id: { $in: ["user-1"] } }]);
      expect(domains).toEqual(new Set(["acme.com"]));
    });

    it("returns an empty set without querying when there are no user ids", async () => {
      const db = { collection: jest.fn() } as any;

      const domains = await resolveInternalDomains(db, { userIds: [] });

      expect(domains.size).toBe(0);
      expect(db.collection).not.toHaveBeenCalled();
    });
  });
});
