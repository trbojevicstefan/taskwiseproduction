import {
  blockSuggestedMatch,
  triageDiscoveredPeople,
} from "@/components/dashboard/people/PeopleDiscoveryDialog";
import type { Person } from "@/types/person";

jest.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: jest.fn() }),
}));

const buildPerson = (overrides: Partial<Person> = {}): Person => ({
  id: "person-1",
  userId: "user-1",
  name: "Sam Smith",
  sourceSessionIds: [],
  createdAt: null,
  lastSeenAt: null,
  ...overrides,
});

describe("triageDiscoveredPeople", () => {
  it("routes exact email hits to the existing bucket", () => {
    const existing = [buildPerson({ email: "sam@acme.com" })];
    const result = triageDiscoveredPeople(
      [{ name: "Samuel Smith", email: "sam@acme.com" }],
      existing
    );
    expect(result.existingDiscoveredPeople).toHaveLength(1);
    expect(result.newPeople).toHaveLength(0);
    expect(result.potentialMatches).toHaveLength(0);
  });

  it("routes fuzzy name matches to review, never to auto-match", () => {
    const existing = [buildPerson({ name: "John Smith" })];
    const result = triageDiscoveredPeople([{ name: "Jon Smith" }], existing);
    expect(result.potentialMatches).toHaveLength(1);
    expect(result.potentialMatches[0].matchedPerson.id).toBe("person-1");
    expect(result.potentialMatches[0].matchConfidence).toBeLessThan(0.88);
    expect(result.existingDiscoveredPeople).toHaveLength(0);
  });

  it("treats unrelated people as new", () => {
    const existing = [buildPerson({ name: "John Smith" })];
    const result = triageDiscoveredPeople([{ name: "Ada Lovelace" }], existing);
    expect(result.newPeople).toHaveLength(1);
    expect(result.potentialMatches).toHaveLength(0);
  });

  it("never re-suggests a blocked candidate, even on exact name", () => {
    const existing = [
      buildPerson({
        name: "Sam Smith",
        blockedMergeKeys: ["sam smith"],
      }),
    ];
    const result = triageDiscoveredPeople([{ name: "Sam Smith" }], existing);
    expect(result.existingDiscoveredPeople).toHaveLength(0);
    expect(result.potentialMatches).toHaveLength(0);
    expect(result.newPeople).toHaveLength(1);
  });

  it("still drops candidates matching blocked (isBlocked) directory entries", () => {
    const existing = [buildPerson({ name: "Spam Bot", isBlocked: true })];
    const result = triageDiscoveredPeople([{ name: "Spam Bot" }], existing);
    expect(result.newPeople).toHaveLength(0);
    expect(result.existingDiscoveredPeople).toHaveLength(0);
    expect(result.potentialMatches).toHaveLength(0);
  });
});

describe("blockSuggestedMatch", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("persists the block against the matched person", async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true });
    global.fetch = fetchMock as any;

    await blockSuggestedMatch({
      person: { name: "Sam S", email: "sam@old.com" },
      matchedPerson: buildPerson({ id: "person-9" }),
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/people/merge/block",
      expect.objectContaining({ method: "POST" })
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({
      personId: "person-9",
      blockedName: "Sam S",
      blockedEmail: "sam@old.com",
    });
  });

  it("throws when the API rejects the block", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false }) as any;
    await expect(
      blockSuggestedMatch({
        person: { name: "Sam S" },
        matchedPerson: buildPerson({ id: "person-9" }),
      })
    ).rejects.toThrow("Failed to block this match.");
  });
});
