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
import type * as ardentia from "../ardentia.js";
import type * as ardentiaHelpers from "../ardentiaHelpers.js";
import type * as army from "../army.js";
import type * as armyRules from "../armyRules.js";
import type * as auth from "../auth.js";
import type * as buildings from "../buildings.js";
import type * as config from "../config.js";
import type * as crons from "../crons.js";
import type * as economy from "../economy.js";
import type * as economyHelpers from "../economyHelpers.js";
import type * as eventHelpers from "../eventHelpers.js";
import type * as game from "../game.js";
import type * as http from "../http.js";
import type * as intelligence from "../intelligence.js";
import type * as intelligenceHelpers from "../intelligenceHelpers.js";
import type * as intelligenceRules from "../intelligenceRules.js";
import type * as messages from "../messages.js";
import type * as notificationHelpers from "../notificationHelpers.js";
import type * as notificationPush from "../notificationPush.js";
import type * as notifications from "../notifications.js";
import type * as ownership from "../ownership.js";
import type * as plateauHelpers from "../plateauHelpers.js";
import type * as plateauRuns from "../plateauRuns.js";
import type * as plateaus from "../plateaus.js";
import type * as players from "../players.js";
import type * as provisionHelpers from "../provisionHelpers.js";
import type * as raids from "../raids.js";
import type * as research from "../research.js";
import type * as researchHelpers from "../researchHelpers.js";
import type * as rules from "../rules.js";
import type * as spren from "../spren.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  ardentia: typeof ardentia;
  ardentiaHelpers: typeof ardentiaHelpers;
  army: typeof army;
  armyRules: typeof armyRules;
  auth: typeof auth;
  buildings: typeof buildings;
  config: typeof config;
  crons: typeof crons;
  economy: typeof economy;
  economyHelpers: typeof economyHelpers;
  eventHelpers: typeof eventHelpers;
  game: typeof game;
  http: typeof http;
  intelligence: typeof intelligence;
  intelligenceHelpers: typeof intelligenceHelpers;
  intelligenceRules: typeof intelligenceRules;
  messages: typeof messages;
  notificationHelpers: typeof notificationHelpers;
  notificationPush: typeof notificationPush;
  notifications: typeof notifications;
  ownership: typeof ownership;
  plateauHelpers: typeof plateauHelpers;
  plateauRuns: typeof plateauRuns;
  plateaus: typeof plateaus;
  players: typeof players;
  provisionHelpers: typeof provisionHelpers;
  raids: typeof raids;
  research: typeof research;
  researchHelpers: typeof researchHelpers;
  rules: typeof rules;
  spren: typeof spren;
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
