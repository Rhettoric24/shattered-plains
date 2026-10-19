export const DIPLOMACY = {
  favorCap: 5,
  tributeSpheres: 10_000,
  tributeGemhearts: 1,
  sphereHostilityScale: 8,
  gemheartHostilityScale: 4,
  maximumSphereDonation: 1_000_000,
  maximumGemheartDonation: 1000,
  tributeWindowMs: 24 * 3_600_000,
  petitionDurationMs: 24 * 3_600_000,
  petitionHostilityReduction: 15,
  aggressorHostility: 68,
  minimumEnemyPower: 100,
  minimumEnemyCasualties: 10,
  tiers: [
    { cost: 1, power: 150, name: "Parshendi Scouts" },
    { cost: 2, power: 300, name: "Parshendi Warband" },
    { cost: 3, power: 500, name: "Parshendi Veterans" },
    { cost: 4, power: 750, name: "Parshendi Honor Guard" },
    { cost: 5, power: 1000, name: "Chasmfiend" },
  ],
};
export function donationCurve(spheres: number, gemhearts: number) {
  return DIPLOMACY.sphereHostilityScale * Math.log2(1 + spheres / DIPLOMACY.tributeSpheres) +
    DIPLOMACY.gemheartHostilityScale * Math.log2(1 + gemhearts / DIPLOMACY.tributeGemhearts);
}
/** Difference of cumulative totals: splitting a payment cannot beat diminishing returns. */
export function donationReduction(before: { spheres: number; gemhearts: number }, resource: "spheres" | "gemhearts", amount: number) {
  const after = { ...before, [resource]: before[resource] + amount };
  return Math.max(0, Math.floor(donationCurve(after.spheres, after.gemhearts) + 1e-9) -
    Math.floor(donationCurve(before.spheres, before.gemhearts) + 1e-9));
}
export function tributeProgress(spheres: number, gemhearts: number, favor: number) {
  if (![spheres, gemhearts].every(n => Number.isSafeInteger(n) && n >= 0)) throw Error("Invalid donation totals.");
  const favorGranted = Math.min(Math.floor(spheres / DIPLOMACY.tributeSpheres), Math.floor(gemhearts / DIPLOMACY.tributeGemhearts));
  requireFavorRoom(favor, favorGranted);
  return { favorGranted, sphereCredit: spheres - favorGranted * DIPLOMACY.tributeSpheres, gemheartCredit: gemhearts - favorGranted * DIPLOMACY.tributeGemhearts };
}
export function requireFavorRoom(favor: number, reward = 1) {
  if (!Number.isSafeInteger(favor) || favor < 0 || favor + reward > DIPLOMACY.favorCap)
    throw Error("Favor cap is 5. Spend Favor before fulfilling this contract; nothing was consumed.");
}
