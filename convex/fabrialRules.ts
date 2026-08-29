import { addUnits, normalizeUnits, type UnitCounts } from "./rules";
import { seededFraction } from "./worldPressureRules";

export const FABRIAL_KEYS = ["painrial", "soulcaster", "halfShard"] as const;
export type FabrialKey = (typeof FABRIAL_KEYS)[number];
export type ReusableOutcome = "clean_success" | "normal_success" | "lower_failure" | "catastrophic_failure";

export const FABRIAL_RULES = {
  painrial: {
    name: "Painrial",
    description: "A disposable field device that dulls trauma at the moment it is suffered.",
    effect: "Prevents 25% of calculated casualties, rounded down.",
    sphereCost: 10_000,
    gemheartCost: 0,
    batchSize: 3,
    reusable: false,
    casualtyProtection: 0.25,
  },
  soulcaster: {
    name: "Soulcaster",
    description: "A reusable logistical instrument that transforms otherwise unreachable spoils after a successful operation.",
    effect: "Recovers 50% of the Sphere pool beyond normal Plunder capacity on success.",
    sphereCost: 15_000,
    gemheartCost: 1,
    batchSize: 1,
    reusable: true,
    casualtyProtection: 0,
  },
  halfShard: {
    name: "Half-Shard",
    description: "A reusable defensive device that turns aside the worst blows, though a broken retreat may leave it behind.",
    effect: "Prevents 50% of calculated casualties, rounded down.",
    sphereCost: 15_000,
    gemheartCost: 2,
    batchSize: 1,
    reusable: true,
    casualtyProtection: 0.5,
  },
} as const;

export function isFabrialKey(value: unknown): value is FabrialKey {
  return FABRIAL_KEYS.includes(value as FabrialKey);
}

export function applyFabrialCasualtyProtection(
  kind: FabrialKey | undefined,
  original: { survivors: UnitCounts; casualties: UnitCounts },
) {
  const rate = kind ? FABRIAL_RULES[kind].casualtyProtection : 0;
  const casualties = normalizeUnits(original.casualties);
  const casualtyTotal = Object.values(casualties).reduce((sum, count) => sum + count, 0);
  const preventedTarget = Math.floor(casualtyTotal * rate);
  if (preventedTarget <= 0) return { ...original, prevented: 0 };
  const restored = normalizeUnits({});
  const keys = ["bridgeman", "spearman", "chull", "scout", "heavy", "shardbearer"] as const;
  const allocations = keys.map((key) => {
    const exact = casualties[key] * preventedTarget / casualtyTotal;
    return { key, count: Math.floor(exact), remainder: exact - Math.floor(exact) };
  });
  let remainingToPrevent = preventedTarget - allocations.reduce((sum, allocation) => sum + allocation.count, 0);
  for (const allocation of [...allocations].sort((a, b) => b.remainder - a.remainder || keys.indexOf(a.key) - keys.indexOf(b.key))) {
    if (remainingToPrevent <= 0) break;
    if (allocation.count < casualties[allocation.key]) {
      allocation.count += 1;
      remainingToPrevent -= 1;
    }
  }
  for (const { key, count } of allocations) {
    casualties[key] -= count;
    restored[key] += count;
  }
  const prevented = Object.values(restored).reduce((sum, count) => sum + count, 0);
  return { survivors: addUnits(original.survivors, restored), casualties, prevented };
}

export function soulcasterRecovery(rewardPool: number, armyPlunder: number, won: boolean) {
  if (!won) return { normalRecovery: 0, bonus: 0, totalRecovery: 0 };
  const pool = Math.max(0, Math.floor(rewardPool));
  const normalRecovery = Math.min(pool, Math.max(0, Math.floor(armyPlunder)));
  const bonus = Math.min(pool - normalRecovery, Math.round((pool - normalRecovery) * 0.5));
  return { normalRecovery, bonus, totalRecovery: normalRecovery + bonus };
}

export function reusableFabrialLost(outcome: ReusableOutcome, seed: string) {
  if (outcome === "catastrophic_failure") return true;
  if (outcome === "lower_failure") return seededFraction(seed) < 0.5;
  return false;
}
