// @vitest-environment node
import { describe, expect, it } from "vitest";
import { EnvironmentIdentifier, type KnownEnvironmentLookup } from "./EnvironmentIdentifier.js";
import { MockBuildingSkillSuggester } from "./BuildingSkillSuggester.js";
import { StubPoiLookupProvider } from "./StubPoiLookupProvider.js";

const TEST_COORD = { latitude: 37.3318, longitude: -122.0312 };

function makeIdentifier(knownIds: string[] = []) {
  const repository: KnownEnvironmentLookup = {
    async getSkillPaths(environmentId: string) {
      return knownIds.includes(environmentId) ? [`/repo/${environmentId}/skills/x`] : [];
    },
  };
  return new EnvironmentIdentifier({
    poiProvider: new StubPoiLookupProvider(),
    repository,
    skillSuggester: new MockBuildingSkillSuggester(),
  });
}

describe("EnvironmentIdentifier", () => {
  it("returns ranked candidates with stable loc: ids", async () => {
    const identifier = makeIdentifier();
    const candidates = await identifier.identifyAvailableEnvironments({ ...TEST_COORD, isStationary: true });

    expect(candidates.length).toBeGreaterThanOrEqual(2);
    expect(candidates[0].environmentId).toBe("loc:target.com/store-1842");
    expect(candidates[0].displayName).toBe("Target");
    expect(candidates[0].storeNumber).toBe("1842");
    // Sorted descending by confidence.
    for (let i = 1; i < candidates.length; i++) {
      expect(candidates[i - 1].confidence).toBeGreaterThanOrEqual(candidates[i].confidence);
    }
  });

  it("reports hasKnownEnvironment from the repository", async () => {
    const identifier = makeIdentifier(["loc:target.com/store-1842"]);
    const candidates = await identifier.identifyAvailableEnvironments(TEST_COORD);
    const target = candidates.find((c) => c.environmentId === "loc:target.com/store-1842");
    const starbucks = candidates.find((c) => c.environmentId === "loc:starbucks.com/store-9988");

    expect(target?.hasKnownEnvironment).toBe(true);
    expect(target?.matchReasons).toContain("known_environment");
    expect(starbucks?.hasKnownEnvironment).toBe(false);
  });

  it("includes mocked possibleSkills for known operators", async () => {
    const identifier = makeIdentifier();
    const candidates = await identifier.identifyAvailableEnvironments(TEST_COORD);
    const target = candidates.find((c) => c.environmentId === "loc:target.com/store-1842");
    expect(target?.possibleSkills).toContain("store-navigation");
  });

  it("lowers confidence when moving fast (driving-like)", async () => {
    const identifier = makeIdentifier();
    const stationary = await identifier.identifyAvailableEnvironments({ ...TEST_COORD, isStationary: true });
    const driving = await identifier.identifyAvailableEnvironments({ ...TEST_COORD, speedMetersPerSecond: 20 });
    expect(driving[0].confidence).toBeLessThan(stationary[0].confidence);
  });

  it("returns no candidates when coordinate is far away", async () => {
    const identifier = makeIdentifier();
    const candidates = await identifier.identifyAvailableEnvironments({ latitude: 40, longitude: -74 });
    expect(candidates).toHaveLength(0);
  });
});
