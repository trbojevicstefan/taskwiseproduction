import {
  AUTO_MERGE_MIN_CONFIDENCE,
  getBestPersonMatch,
  getPotentialPersonMatches,
  getRankedPersonMatches,
  isAutoMergeEligible,
  isMergeBlockedBetween,
  isMergeBlockedForCandidate,
  mergeSourceIdentities,
  resolveMergeDirection,
  upsertSourceIdentity,
} from "@/lib/people-matching";
import type { Person } from "@/types/person";

const buildPerson = (overrides: Partial<Person> = {}): Person => ({
  id: "person-1",
  userId: "user-1",
  name: "Test Person",
  sourceSessionIds: [],
  createdAt: null,
  lastSeenAt: null,
  ...overrides,
});

describe("people-matching scoring", () => {
  it("scores exact email matches at 1.0", () => {
    const person = buildPerson({ name: "Sam Smith", email: "sam@acme.com" });
    const match = getBestPersonMatch(
      { name: "Completely Different", email: "SAM@acme.com " },
      [person]
    );
    expect(match).toMatchObject({ confidence: 1, reason: "email" });
    expect(match?.person.id).toBe("person-1");
    expect(isAutoMergeEligible(match!)).toBe(true);
  });

  it("scores exact Slack id matches at 1.0", () => {
    const person = buildPerson({ name: "Sam Smith", slackId: "U123" });
    const match = getBestPersonMatch(
      { name: "Someone Else", slackId: "U123" },
      [person]
    );
    expect(match).toMatchObject({ confidence: 1, reason: "slack" });
    expect(isAutoMergeEligible(match!)).toBe(true);
  });

  it("scores alias matches at 0.92", () => {
    const person = buildPerson({
      name: "Samuel Smith",
      aliases: ["Sam Smith", "sam.old@acme.com"],
    });
    const byName = getBestPersonMatch({ name: "Sam Smith" }, [person]);
    expect(byName).toMatchObject({ confidence: 0.92, reason: "alias" });

    const byEmailAlias = getBestPersonMatch(
      { name: "Whoever", email: "sam.old@acme.com" },
      [person]
    );
    expect(byEmailAlias).toMatchObject({ confidence: 0.92, reason: "alias" });
    expect(isAutoMergeEligible(byName!)).toBe(true);
  });

  it("never lets fuzzy name similarity reach the auto-merge band", () => {
    const person = buildPerson({ name: "John Smith" });
    // "Jon Smith" is extremely similar but not identical.
    const best = getBestPersonMatch({ name: "Jon Smith" }, [person]);
    expect(best).toBeNull(); // default threshold 0.88 — no auto-merge

    const [ranked] = getRankedPersonMatches({ name: "Jon Smith" }, [person]);
    expect(ranked.reason).toBe("name");
    expect(ranked.confidence).toBeGreaterThan(0.78);
    expect(ranked.confidence).toBeLessThan(AUTO_MERGE_MIN_CONFIDENCE);
    expect(isAutoMergeEligible(ranked)).toBe(false);
  });

  it("caps same-first-name-only matches at low confidence", () => {
    const person = buildPerson({ name: "John Smith" });
    const [ranked] = getRankedPersonMatches({ name: "John Doe" }, [person]);
    expect(ranked.reason).toBe("first_name");
    expect(ranked.confidence).toBeLessThanOrEqual(0.45);

    const single = getRankedPersonMatches({ name: "John" }, [person]);
    expect(single[0].reason).toBe("first_name");
    expect(single[0].confidence).toBeLessThanOrEqual(0.45);
    expect(getBestPersonMatch({ name: "John" }, [person])).toBeNull();
  });

  it("treats same work domain + similar name as a medium-confidence suggestion", () => {
    const person = buildPerson({
      name: "John Smith",
      email: "john.smith@acme.com",
    });
    const [ranked] = getRankedPersonMatches(
      { name: "Jon Smith", email: "jon@acme.com" },
      [person]
    );
    expect(ranked.reason).toBe("domain");
    expect(ranked.confidence).toBeGreaterThanOrEqual(0.78);
    expect(ranked.confidence).toBeLessThanOrEqual(0.86);
    expect(isAutoMergeEligible(ranked)).toBe(false);
    // Never auto-merges even at high numeric similarity.
    expect(
      getBestPersonMatch({ name: "Jon Smith", email: "jon@acme.com" }, [person])
    ).toBeNull();
  });

  it("does not treat a shared free-mail domain as a work-domain signal", () => {
    const person = buildPerson({
      name: "John Smith",
      email: "john.smith@gmail.com",
    });
    const [ranked] = getRankedPersonMatches(
      { name: "Jon Smith", email: "jon@gmail.com" },
      [person]
    );
    expect(ranked.reason).toBe("name");
  });

  it("treats client company/domain matches as suggest-only", () => {
    const byCompany = getRankedPersonMatches(
      { name: "Sarah Lee", company: "Acme Corp" },
      [buildPerson({ name: "Bob Jones", company: "acme corp" })]
    );
    expect(byCompany[0]).toMatchObject({ confidence: 0.6, reason: "company" });
    expect(isAutoMergeEligible(byCompany[0])).toBe(false);

    const byDomain = getRankedPersonMatches(
      { name: "Sarah Lee", email: "sarah@acme.com" },
      [buildPerson({ name: "Bob Jones", email: "bob@acme.com" })]
    );
    expect(byDomain[0]).toMatchObject({ confidence: 0.6, reason: "company" });
    expect(
      getBestPersonMatch(
        { name: "Sarah Lee", email: "sarah@acme.com" },
        [buildPerson({ name: "Bob Jones", email: "bob@acme.com" })]
      )
    ).toBeNull();
  });

  it("never matches merged tombstones", () => {
    const merged = buildPerson({
      name: "Sam Smith",
      email: "sam@acme.com",
      mergeState: "merged",
      mergedIntoPersonId: "person-2",
    });
    expect(
      getBestPersonMatch({ name: "Sam Smith", email: "sam@acme.com" }, [merged])
    ).toBeNull();
    expect(
      getRankedPersonMatches({ name: "Sam Smith" }, [merged])
    ).toHaveLength(0);
  });
});

describe("blocked merges", () => {
  it("skips candidates blocked by normalized key", () => {
    const person = buildPerson({
      name: "Sam Smith",
      email: "sam@acme.com",
      blockedMergeKeys: ["sam smith", "other@x.com"],
    });
    expect(isMergeBlockedForCandidate({ name: "Sam Smith" }, person)).toBe(true);
    expect(isMergeBlockedForCandidate({ email: "other@x.com" }, person)).toBe(true);
    expect(isMergeBlockedForCandidate({ name: "Jane Roe" }, person)).toBe(false);
    expect(getBestPersonMatch({ name: "Sam Smith" }, [person])).toBeNull();
    expect(getRankedPersonMatches({ name: "Sam Smith" }, [person])).toHaveLength(0);
  });

  it("never re-suggests a blocked pair of saved people", () => {
    const slackPerson = buildPerson({
      id: "slack-1",
      name: "Sam Smith",
      email: "sam@acme.com",
      slackId: "U123",
    });
    const transcriptPerson = buildPerson({
      id: "transcript-1",
      name: "Sam Smith",
      email: null,
      blockedMergePersonIds: ["slack-1"],
    });

    expect(isMergeBlockedBetween(transcriptPerson, slackPerson)).toBe(true);
    expect(
      getPotentialPersonMatches([slackPerson, transcriptPerson])
    ).toHaveLength(0);

    // Without the block, the same pair is suggested.
    const unblocked = { ...transcriptPerson, blockedMergePersonIds: [] };
    expect(
      getPotentialPersonMatches([slackPerson, unblocked]).length
    ).toBe(1);
  });
});

describe("Slack canonical precedence", () => {
  it("always picks the Slack person as the merge target", () => {
    const slackPerson = buildPerson({
      id: "slack-1",
      name: "Sam Smith",
      email: "sam@acme.com",
      slackId: "U123",
    });
    const transcriptPerson = buildPerson({
      id: "transcript-1",
      name: "Sam Smith",
      email: null,
    });

    const matches = getPotentialPersonMatches([transcriptPerson, slackPerson]);
    expect(matches).toHaveLength(1);
    expect(matches[0].target.id).toBe("slack-1");
    expect(matches[0].source.id).toBe("transcript-1");
    expect(matches[0].confidence).toBe(1);
  });

  it("resolveMergeDirection prefers Slack, then email", () => {
    const slackPerson = buildPerson({ id: "a", slackId: "U1" });
    const emailPerson = buildPerson({ id: "b", email: "b@x.com" });
    const bare = buildPerson({ id: "c", email: null });

    expect(resolveMergeDirection(emailPerson, slackPerson).target.id).toBe("a");
    expect(resolveMergeDirection(slackPerson, emailPerson).target.id).toBe("a");
    expect(resolveMergeDirection(bare, emailPerson).target.id).toBe("b");
    expect(resolveMergeDirection(emailPerson, bare).target.id).toBe("b");
  });
});

describe("source identity helpers", () => {
  it("upserts identities keyed by provider + externalId", () => {
    const first = upsertSourceIdentity([], {
      provider: "slack",
      externalId: "U1",
      lastSeenAt: "2026-01-01",
    });
    const refreshed = upsertSourceIdentity(first, {
      provider: "slack",
      externalId: "U1",
      lastSeenAt: "2026-02-01",
    });
    expect(refreshed).toHaveLength(1);
    expect(refreshed[0].lastSeenAt).toBe("2026-02-01");

    const added = upsertSourceIdentity(refreshed, {
      provider: "fireflies",
      email: "sam@acme.com",
    });
    expect(added).toHaveLength(2);
  });

  it("merges identity lists without duplicates", () => {
    const merged = mergeSourceIdentities(
      [{ provider: "slack", externalId: "U1" }],
      [
        { provider: "slack", externalId: "U1", confidence: 1 },
        { provider: "grain", email: "sam@acme.com" },
      ]
    );
    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({ provider: "slack", confidence: 1 });
  });
});
