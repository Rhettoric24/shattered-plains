export const DIPLOMACY = {
  favorCap: 5,
  tributeSpheres: 10_000,
  tributeGemhearts: 1,
  tributeHostilityReduction: 12,
  tributeWindowMs: 24 * 3_600_000,
  petitionDurationMs: 24 * 3_600_000,
  petitionHostilityReduction: 15,
  aggressorHostility: 68,
  minimumEnemyPower: 100,
  minimumEnemyCasualties: 10,
  fallbackSpheres: [2500, 4000, 6000],
  tiers: [
    { cost: 1, power: 150, name: "Parshendi Scouts" },
    { cost: 2, power: 300, name: "Parshendi Warband" },
    { cost: 3, power: 500, name: "Parshendi Veterans" },
    { cost: 4, power: 750, name: "Parshendi Honor Guard" },
    { cost: 5, power: 1000, name: "Chasmfiend" },
  ],
};
export function tributeReduction(count: number) {
  return Math.max(1, Math.floor(DIPLOMACY.tributeHostilityReduction / (1 + count)));
}
export function requireFavorRoom(favor: number, reward = 1) {
  if (!Number.isSafeInteger(favor) || favor < 0 || favor + reward > DIPLOMACY.favorCap)
    throw Error("Favor cap is 5. Spend Favor before fulfilling this contract; nothing was consumed.");
}
