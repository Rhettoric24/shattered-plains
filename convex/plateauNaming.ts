import type { Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { WORLD_KEY } from "./rules";

export const PLATEAU_NAME_POOL = [
  "The Broken Crown",
  "Windscar",
  "The Spearhead",
  "Stormrest",
  "The Split Shield",
  "Redstone Rise",
  "The Crooked Tower",
  "Last Light",
  "The Shattered Step",
  "Stormwatch",
  "The Long Shelf",
  "Blackglass",
  "The Windward Fang",
  "Three Spires",
  "The Hollow Crown",
  "Stormbreak",
  "The Fallen Spear",
  "Highcrest",
  "The Split Mesa",
  "Deadman’s Reach",
  "The Stonehook",
  "Thunderhead",
  "The Western Teeth",
  "The Long Drop",
  "Shardstone",
  "The Windcut",
  "Last Stand",
  "The Broken Bridge",
  "Stormscar",
  "The Watcher",
  "The Razorback",
  "The Lonely Spire",
  "The Sunken Crown",
  "The Far Reach",
  "Wayward Stone",
] as const;

const GENERIC_PLATEAU_NAME = /^(?:Home )?(?:Sphere|Ancient|Gemheart|Bridged|Training) Plateau \d+$/;

export function plateauNameForOrdinal(ordinal: number) {
  const normalized = Math.max(0, Math.floor(ordinal));
  const base = PLATEAU_NAME_POOL[normalized % PLATEAU_NAME_POOL.length];
  const cycle = Math.floor(normalized / PLATEAU_NAME_POOL.length) + 1;
  return cycle === 1 ? base : `${base} (${cycle})`;
}

export function isGenericGeneratedPlateau(plateau: Pick<Doc<"plateaus">, "name" | "origin">) {
  return (plateau.origin === "home" || plateau.origin === "neutral") && GENERIC_PLATEAU_NAME.test(plateau.name);
}

export async function reservePlateauNames(ctx: MutationCtx, count: number) {
  const world = await ctx.db
    .query("gameState")
    .withIndex("by_key", (q) => q.eq("key", WORLD_KEY))
    .unique();
  if (!world) throw new Error("The shared world must exist before generating plateaus.");

  let start = world.nextPlateauNameOrdinal;
  if (start === undefined) {
    const existing = await ctx.db.query("plateaus").take(1);
    if (existing.length > 0) throw new Error("Existing plateau names must be migrated before generating more plateaus.");
    start = 0;
  }

  const names = Array.from({ length: count }, (_, index) => plateauNameForOrdinal(start + index));
  if (count > 0) {
    await ctx.db.patch(world._id, {
      nextPlateauNameOrdinal: start + count,
      updatedAt: Date.now(),
    });
  }
  return names;
}

export async function migrateGenericPlateauNames(ctx: MutationCtx) {
  const plateaus = await ctx.db.query("plateaus").take(500);
  const candidates = plateaus
    .filter(isGenericGeneratedPlateau)
    .sort((a, b) => a.createdAt - b.createdAt || a._creationTime - b._creationTime || String(a._id).localeCompare(String(b._id)));
  const retainedNames = new Set(plateaus.filter((plateau) => !isGenericGeneratedPlateau(plateau)).map((plateau) => plateau.name));
  const assignments: Array<{ id: Doc<"plateaus">["_id"]; oldName: string; newName: string }> = [];
  let ordinal = 0;

  for (const plateau of candidates) {
    while (retainedNames.has(plateauNameForOrdinal(ordinal))) ordinal += 1;
    const newName = plateauNameForOrdinal(ordinal);
    assignments.push({ id: plateau._id, oldName: plateau.name, newName });
    retainedNames.add(newName);
    ordinal += 1;
  }

  const existingGeneratedOrdinals = plateaus
    .filter((plateau) => !isGenericGeneratedPlateau(plateau))
    .map((plateau) => {
      for (let index = 0; index < Math.max(PLATEAU_NAME_POOL.length, plateaus.length + PLATEAU_NAME_POOL.length); index += 1) {
        if (plateauNameForOrdinal(index) === plateau.name) return index;
      }
      return -1;
    });
  const nextOrdinal = Math.max(ordinal, ...existingGeneratedOrdinals.map((value) => value + 1), 0);
  const world = await ctx.db
    .query("gameState")
    .withIndex("by_key", (q) => q.eq("key", WORLD_KEY))
    .unique();
  if (!world) throw new Error("The shared world is missing.");

  for (const assignment of assignments) await ctx.db.patch(assignment.id, { name: assignment.newName });
  if (world.nextPlateauNameOrdinal === undefined || world.nextPlateauNameOrdinal < nextOrdinal) {
    await ctx.db.patch(world._id, { nextPlateauNameOrdinal: nextOrdinal });
  }

  return {
    scanned: plateaus.length,
    candidates: candidates.length,
    migrated: assignments.length,
    availableBaseNames: PLATEAU_NAME_POOL.length,
    nextOrdinal,
    assignments,
  };
}
