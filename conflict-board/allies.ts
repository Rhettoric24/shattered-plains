import { effectivePower, totalUnits } from "../convex/rules";
import { formationStats } from "./stats";
import type { Formation, ResolverConfig } from "./types";

type Piece = Pick<Formation, "units" | "allied">;
export const present = (f: Piece) => f.allied ? !f.allied.dispersed : totalUnits(f.units) > 0;
export const piecePower = (f: Piece, research: Record<string, number>) =>
  f.allied ? (present(f) ? f.allied.power : 0) : effectivePower(f.units, research);
export function pieceStats(f: Piece, research: Record<string, number>, config: ResolverConfig) {
  return f.allied
    ? { power: piecePower(f, research), movement: 1, specialization: "None" as const }
    : formationStats(f.units, research, config);
}
