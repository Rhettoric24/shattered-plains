import { describe, expect, test } from "vitest";
import { formatDisclosedPower, kingdomIntelTimingRows, plateauIdentityPresentation, raidDefenseMarkup, raidDefensePresentation } from "./intelligence-ui-state.js";

describe("intelligence UI presentation", () => {
  test("renders every earned raid disclosure numerically", () => {
    const disclosures = [
      { level: 0, mode: "range", min: 100, max: 200 },
      { level: 1, mode: "estimate", min: 128, max: 198 },
      { level: 2, mode: "estimate", min: 143, max: 183 },
      { level: 3, mode: "estimate", min: 153, max: 173 },
      { level: 4, mode: "estimate", min: 153, max: 173 },
      { level: 5, mode: "exact", value: 163 },
    ];
    expect(disclosures.map(raidDefensePresentation)).toEqual([
      { label: "Estimated enemy Power", value: "100–200", exact: false },
      { label: "Estimated enemy Power", value: "128–198", exact: false },
      { label: "Estimated enemy Power", value: "143–183", exact: false },
      { label: "Estimated enemy Power", value: "153–173", exact: false },
      { label: "Estimated enemy Power", value: "153–173", exact: false },
      { label: "Enemy Power", value: "163", exact: true },
    ]);
    expect(formatDisclosedPower({ mode: "label", label: "Fortified" })).toBe("Fortified");
    expect(formatDisclosedPower({ mode: "range", min: 601, max: null })).toBe("601+");
    expect(raidDefenseMarkup(disclosures[2])).toContain('data-raid-defense-intel="estimate"');
    expect(raidDefenseMarkup(disclosures[2])).toContain("143–183");
  });

  test("presents plateau type and only disclosed traits", () => {
    expect(plateauIdentityPresentation({ name: "The Broken Crown", type: "unknown", highground: false, large: false }))
      .toEqual({ known: false, type: "Unknown plateau type", traits: [] });
    expect(plateauIdentityPresentation({ name: "The Broken Crown", type: "sphere", typeName: "Sphere Plateau", highground: true, large: true }))
      .toEqual({ known: true, type: "Sphere Plateau", traits: ["Large", "Highground"] });
  });

  test("presents Economy Intel as persistent while preserving other category decay", () => {
    const economyRows = kingdomIntelTimingRows("economy", { freshness: "fresh", updated: "43m ago", next: "2h 17m" });
    expect(economyRows).toEqual([
      { label: "Updated", value: "43m ago" },
      { label: "Persistence", value: "Changes only when Economy Intel is gained or spent." },
    ]);
    expect(economyRows.map((row) => row.label)).not.toContain("Next decay");

    expect(kingdomIntelTimingRows("military", { freshness: "fresh", updated: "43m ago", next: "2h 17m" })).toEqual([
      { label: "Freshness", value: "fresh" },
      { label: "Updated", value: "43m ago" },
      { label: "Next decay", value: "2h 17m" },
    ]);
  });
});
