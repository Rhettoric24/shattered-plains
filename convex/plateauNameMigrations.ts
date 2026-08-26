import { internalMutation } from "./_generated/server";
import { migrateGenericPlateauNames } from "./plateauNaming";

export const migrateGeneratedNames = internalMutation({
  args: {},
  handler: async (ctx) => await migrateGenericPlateauNames(ctx),
});
