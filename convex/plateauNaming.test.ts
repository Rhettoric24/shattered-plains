/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import { PLATEAU_NAME_POOL, plateauNameForOrdinal, reservePlateauNames } from "./plateauNaming";
import { emptyBuildings, emptyUnits, WORLD_KEY } from "./rules";

const modules = import.meta.glob("./**/*.ts");

async function seedWorld(t: ReturnType<typeof convexTest>, nextPlateauNameOrdinal?: number) {
  return await t.run((ctx) => ctx.db.insert("gameState", {
    key: WORLD_KEY,
    openAcres: 0,
    ...(nextPlateauNameOrdinal === undefined ? {} : { nextPlateauNameOrdinal }),
    createdAt: 1,
    updatedAt: 1,
  }));
}

async function seedPlayer(t: ReturnType<typeof convexTest>, name = "Tester") {
  return await t.run((ctx) => ctx.db.insert("players", {
    name,
    normalizedName: name.toLowerCase(),
    acres: 20,
    spheres: 1200,
    gemhearts: 1,
    units: emptyUnits(),
    buildings: emptyBuildings(),
    lastActiveAt: 1,
    createdAt: 1,
  }));
}

describe("plateau geographic naming", () => {
  test("uses the exact 35-name pool deterministically, then numbered cycles", () => {
    expect(PLATEAU_NAME_POOL).toHaveLength(35);
    expect(new Set(PLATEAU_NAME_POOL).size).toBe(35);
    expect(plateauNameForOrdinal(0)).toBe("The Broken Crown");
    expect(plateauNameForOrdinal(34)).toBe("Wayward Stone");
    expect(plateauNameForOrdinal(35)).toBe("The Broken Crown (2)");
    expect(plateauNameForOrdinal(69)).toBe("Wayward Stone (2)");
    expect(plateauNameForOrdinal(0)).toBe(plateauNameForOrdinal(0));
  });

  test("generation assigns unique names independently from plateau type", async () => {
    const t = convexTest(schema, modules);
    await seedWorld(t, 0);
    await t.run(async (ctx) => {
      const names = await reservePlateauNames(ctx, 35);
      for (let index = 0; index < names.length; index += 1) {
        await ctx.db.insert("plateaus", {
          name: names[index],
          type: index % 2 === 0 ? "sphere" : "ancient",
          status: "neutral",
          origin: "neutral",
          highground: false,
          neutralDefenseInitial: 100,
          neutralDefenseRemaining: 100,
          createdAt: 100 + index,
          updatedAt: 100 + index,
        });
      }
    });
    const plateaus = await t.run((ctx) => ctx.db.query("plateaus").take(100));
    expect(plateaus.map((plateau) => plateau.name)).toEqual([...PLATEAU_NAME_POOL]);
    expect(new Set(plateaus.map((plateau) => plateau.name)).size).toBe(35);
    expect(plateaus[0]).toMatchObject({ name: "The Broken Crown", type: "sphere" });
    expect(plateaus[1]).toMatchObject({ name: "Windscar", type: "ancient" });
  });

  test("migration renames only generic generated records and preserves gameplay state", async () => {
    const t = convexTest(schema, modules);
    await seedWorld(t);
    const ownerPlayerId = await seedPlayer(t, "Owner");
    const genericId = await t.run((ctx) => ctx.db.insert("plateaus", {
      name: "Home Ancient Plateau 2",
      type: "ancient",
      status: "owned",
      ownerPlayerId,
      origin: "home",
      highground: true,
      large: true,
      neutralDefenseInitial: 777,
      neutralDefenseRemaining: 321,
      baseNeutralDefense: 700,
      neutralDefenseBalanceVersion: 1,
      parshendiReclamationCount: 3,
      heldSince: 50,
      lastGemheartAt: 60,
      createdAt: 10,
      updatedAt: 70,
    }));
    const customId = await t.run((ctx) => ctx.db.insert("plateaus", {
      name: "Authored Test Location",
      type: "gemheart",
      status: "neutral",
      origin: "neutral",
      highground: false,
      large: false,
      neutralDefenseInitial: 500,
      neutralDefenseRemaining: 500,
      createdAt: 20,
      updatedAt: 20,
    }));
    const explicitFixtureId = await t.run((ctx) => ctx.db.insert("plateaus", {
      name: "Ancient Plateau 99",
      type: "ancient",
      status: "neutral",
      highground: false,
      neutralDefenseInitial: 10,
      neutralDefenseRemaining: 10,
      createdAt: 30,
      updatedAt: 30,
    }));
    const before = await t.run((ctx) => ctx.db.get(genericId));

    const first = await t.mutation(internal.plateauNameMigrations.migrateGeneratedNames, {});
    expect(first).toMatchObject({ candidates: 1, migrated: 1, availableBaseNames: 35 });
    const after = await t.run((ctx) => ctx.db.get(genericId));
    expect(after).toEqual({ ...before!, name: "The Broken Crown" });
    expect(await t.run((ctx) => ctx.db.get(customId))).toMatchObject({ name: "Authored Test Location" });
    expect(await t.run((ctx) => ctx.db.get(explicitFixtureId))).toMatchObject({ name: "Ancient Plateau 99" });

    const second = await t.mutation(internal.plateauNameMigrations.migrateGeneratedNames, {});
    expect(second).toMatchObject({ candidates: 0, migrated: 0 });
    expect(await t.run((ctx) => ctx.db.get(genericId))).toEqual(after);

    await t.run((ctx) => ctx.db.patch(genericId, {
      ownerPlayerId: undefined,
      status: "neutral",
      neutralDefenseRemaining: 444,
      parshendiReclamationCount: 4,
    }));
    expect(await t.run((ctx) => ctx.db.get(genericId))).toMatchObject({
      name: "The Broken Crown",
      status: "neutral",
      neutralDefenseRemaining: 444,
      parshendiReclamationCount: 4,
    });
  });
});
