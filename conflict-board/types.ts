import type { UnitCounts } from "../convex/rules";
import type { FormationEquipment, EquipmentRecord } from "./fabrials";

export type Position = {
  id: string;
  name: string;
  kind: "field" | "staging" | "reserve" | "objective";
  objective?: "raid";
  x: number;
  y: number;
};
export type Board = {
  positions: Position[];
  connections: [string, string][];
  approach: string;
  reserve: string;
  objective: string;
};
export type Kingdom = {
  id: string;
  name: string;
  color: string;
  research: Record<string, number>;
};
export type Order = {
  kind: "hold" | "move" | "raid";
  route: string[];
  onDefeat: "continue" | "pause";
  paused?: boolean;
};
export type Formation = {
  lastHighstormExposureId?: string;
  equipment?: FormationEquipment;
  /** Legacy source maps are accepted on load; new cargo is owner-agnostic. */
  cargo?: number | Record<string, number>;
  id: string;
  name: string;
  kingdom: string;
  position: string;
  units: UnitCounts;
  history: string[];
  order: Order;
};
// Formations are presentation/command groups. Future exposure/equipment cohorts can
// live beneath them; neither formation identity nor merging implies asset identity.
export type Arrival = {
  id: string;
  cycle: number;
  formation: Omit<Formation, "position" | "history">;
};
export type Objective = {
  controller: string | null;
  hold?: { kingdom: string; beganCycle: number };
  conqueredBy?: string;
};
export type ConflictState = {
  highstorm?: { id: string; active: boolean; sequence?: number };
  equipmentRecords?: EquipmentRecord[];
  treasury?: number;
  recovered?: number;
  cargoLost?: number;
  cargoDestroyed?: number;
  id: string;
  cycle: number;
  board: Board;
  kingdoms: Kingdom[];
  originalOwner: string;
  formations: Formation[];
  arrivals: Arrival[];
  objective: Objective;
  raidFootholds?: Record<
    string,
    { kingdom: string; establishedCycle: number; occupants: string[] }
  >;
  raidValues?: Record<string, number>;
};
export type ResolverConfig = {
  highstorm?: { baseRate: number; surviveCap: number | null; visionRadius: number; fogPenalty: number; raidMultiplier: number };
  fabrialLossRates?: [number,number,number,number];
  /** Explicit testing policy until repeated-engagement Painrial semantics settle. */
  consumeFabrialPerEngagement?: boolean;
  combatModel?: "current" | "experimental-survival";
  raidCap?: number;
  cargoDropRates?: [number, number, number, number];
  specialization: {
    speedScale: number;
    surviveScale: number;
    plunderScale: number;
    minimum: number;
    dominance: number;
  };
  casualties: {
    factor: number;
    minimum: number;
    maximum: number;
    surviveCap: number | null;
  };
};
export type CycleInput = {
  state: ConflictState;
  cycle: number;
  seed: string;
  config: ResolverConfig;
  /** Keyed by kingdom + "@" + position; value is a participating formation ID. */
  mergePreferences?: Record<string, string>;
};
export type BattleForce = {
  kingdom: string;
  power: number;
  hostilePower: number;
  baseRate: number;
  finalRate: number;
  casualties: UnitCounts;
  survivors: UnitCounts;
};
export type Event =
  | { type:"highstorm"; formation:string; kingdom:string; stormId:string; casualties:UnitCounts; survivors:UnitCounts; finalRate:number }
  | {type:"fabrial";formation:string;kingdom:string;item:string;action:string;reason:string;lossChance?:number;roll?:number}
  | {
      type: "cargo";
      action:
        | "lost"
        | "dropped"
        | "destroyed"
        | "captured"
        | "annihilated"
        | "routed"
        | "banked"
        | "recovered";
      formation: string;
      amount: number;
      kingdom?: string;
      ratio?: number;
      dropRate?: number;
      reason: string;
    }
  | {
      type: "raidFoothold" | "raidReady" | "raidBroken";
      position: string;
      kingdom: string;
      cycle: number;
    }
  | {
      type: "raidFailed";
      position: string;
      formation: string;
      reason: string;
      cycle: number;
    }
  | {
      type: "raid";
      position: string;
      kingdom: string;
      target: string;
      formation: string;
      plunder: number;
      value: number;
      treasuryRemaining?: number;
      carried?: number;
      capacityReached?: boolean;
      cycle: number;
    }
  | { type: "move"; step: number; formation: string; from: string; to: string }
  | {
      type: "battle";
      combatModel?: "current" | "experimental-survival";
      step: number;
      position: string;
      forces: BattleForce[];
      winner: string | null;
      annihilated: boolean;
    }
  | {
      type: "retreat";
      step: number;
      formation: string;
      from: string;
      to: string;
      history: string[];
    }
  | {
      type: "retreatCollision";
      step: number;
      position: string;
      kingdoms: string[];
    }
  | { type: "order"; formation: string; reason: string }
  | {
      type: "merge";
      position: string;
      kingdom: string;
      sources: string[];
      formation: string;
      routeSource: string | null;
      reason: string;
    }
  | { type: "arrival"; formation: string; position: string }
  | { type: "control"; step: number; from: string | null; to: string | null }
  | { type: "holdStarted" | "holdBroken" | "conquest"; kingdom: string };
export type CycleResult = { id: string; state: ConflictState; events: Event[] };
