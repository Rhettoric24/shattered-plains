/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin from "../admin.js";
import type * as army from "../army.js";
import type * as auth from "../auth.js";
import type * as buildings from "../buildings.js";
import type * as config from "../config.js";
import type * as crons from "../crons.js";
import type * as economy from "../economy.js";
import type * as economyHelpers from "../economyHelpers.js";
import type * as game from "../game.js";
import type * as http from "../http.js";
import type * as messages from "../messages.js";
import type * as ownership from "../ownership.js";
import type * as plateauRuns from "../plateauRuns.js";
import type * as players from "../players.js";
import type * as raids from "../raids.js";
import type * as rules from "../rules.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  army: typeof army;
  auth: typeof auth;
  buildings: typeof buildings;
  config: typeof config;
  crons: typeof crons;
  economy: typeof economy;
  economyHelpers: typeof economyHelpers;
  game: typeof game;
  http: typeof http;
  messages: typeof messages;
  ownership: typeof ownership;
  plateauRuns: typeof plateauRuns;
  players: typeof players;
  raids: typeof raids;
  rules: typeof rules;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
