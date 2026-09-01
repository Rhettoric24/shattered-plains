import { ConvexClient, ConvexHttpClient } from "convex/browser";
import { espionageMissionAvailability, sphereHeistAvailability, syncEspionageControlLock } from "./espionage-ui-state.js";
import { intelligenceDisclosureState, normalizeRosterUnits, orderedActiveUnits, researchDisclosureState, shouldBlockMissionKey, shouldResetRouteScroll } from "./ui-overhaul-state.js";
import { createLoadCoordinator, createReconciliationLifecycle, createSessionQueryCache, createSubscriptionLifecycle, playerAccountingInputKey, playerStateSubscription, projectGameClock, projectPlayerSpheres, routeNeedsChronicle, routeNeedsPlateauBoard, routeNeedsTerritoryIntelligence, runMutationAction } from "./data-loading-state.js";
import { formatDisclosedPower, kingdomIntelTimingRows, plateauIdentityPresentation, raidDefenseMarkup } from "./intelligence-ui-state.js";

const CONVEX_URL =
  window.SHATTERED_PLAINS_CONFIG?.convexUrl ||
  "https://clean-yak-51.convex.cloud";
const BUILD_IDENTIFIER = window.SHATTERED_PLAINS_CONFIG?.buildIdentifier || "dev";
const client = new ConvexHttpClient(CONVEX_URL);
const AUTH_TOKEN_KEY = "sp-convex-auth-token";
const AUTH_REFRESH_KEY = "sp-convex-auth-refresh-token";
const ESPIONAGE_UI_DEFAULTS = {
  building: {
    name: "Ghostblood Network",
    levelCosts: [3000, 7500, 15000],
    maxLevel: 3,
    constructionTimeMs: 0,
    description: "Recruits operatives, stores rival-specific Intel, and unlocks covert investigations.",
  },
  operatives: {
    informant: { name: "Informant", networkLevel: 1, spyPower: 1, provisionsCost: 3, sphereCost: 150, trainingTimeMs: 0 },
    spy: { name: "Spy", networkLevel: 2, spyPower: 3, provisionsCost: 2, sphereCost: 750, trainingTimeMs: 0 },
    ghostblood: { name: "Ghostblood", networkLevel: 3, spyPower: 6, provisionsCost: 1, sphereCost: 3000, trainingTimeMs: 0 },
  },
  network: {
    name: "Ghostblood Network",
    levelCosts: [3000, 7500, 15000],
    intelCaps: [50, 100, 150],
    missionIntelSpendCaps: [5, 10, 15],
    maxLevel: 3,
    currentIntelCap: 0,
    currentMissionIntelSpendCap: 0,
  },
  sphereHeist: {
    economyIntelCap: 100,
    economyIntelCost: 50,
    disclosure: { estimateAt: 25, exactAt: 75 },
    treasuryPercent: 0.05,
    minimumHaul: 1000,
    maximumHaul: 10000,
  },
};

let authToken = localStorage.getItem(AUTH_TOKEN_KEY);
let refreshToken = localStorage.getItem(AUTH_REFRESH_KEY);
if (authToken) client.setAuth(authToken);
let authSessionGeneration = authToken ? 1 : 0;
let state = null;
let rawStateData = null;
const SPACE_TABS = {
  warcamp: [{ key: "buildings", label: "Buildings" }, { key: "recruitment", label: "Recruitment" }],
  plains: [{ key: "raids", label: "Raids" }, { key: "sieges", label: "Sieges" }, { key: "plateau-runs", label: "Plateau Runs" }],
  intelligence: [{ key: "ledger", label: "Ledger" }, { key: "operations", label: "Operations" }, { key: "territory", label: "Territory" }],
  research: [{ key: "current", label: "Current" }, { key: "libraries", label: "Libraries" }, { key: "ardents", label: "Ardents" }, { key: "fabrials", label: "???" }],
};
const ROUTE_SECTIONS = {
  home: "overview",
  "warcamp:buildings": "buildings",
  "warcamp:recruitment": "army",
  "plains:raids": "raids",
  "plains:sieges": "plateaus",
  "plains:plateau-runs": "plateau",
  "intelligence:ledger": "ledger",
  "intelligence:operations": "intelligence-operations",
  "intelligence:territory": "intelligence-territory",
  "research:current": "research-current",
  "research:libraries": "research-libraries",
  "research:ardents": "research-ardents",
  "research:fabrials": "research-fabrials",
  "research:teaser": "research-teaser",
  spanreed: "inbox",
  testing: "testing",
  chronicle: "chronicle",
};
const LEGACY_ROUTES = {
  overview: { view: "home" },
  ledger: { view: "intelligence", tab: "ledger", focus: "my-season" },
  buildings: { view: "warcamp", tab: "buildings" },
  army: { view: "warcamp", tab: "recruitment" },
  raids: { view: "plains", tab: "raids" },
  plateaus: { view: "plains", tab: "sieges" },
  plateau: { view: "plains", tab: "plateau-runs" },
  intelligence: { view: "intelligence", tab: "ledger" },
  research: { view: "research", tab: "current" },
  inbox: { view: "spanreed" },
};
const DEFAULT_TABS = { warcamp: "buildings", plains: "raids", intelligence: "ledger", research: "current" };

function routeFromLocation() {
  const params = new URLSearchParams(location.search);
  const rawView = params.get("view") || localStorage.getItem("sp-current-view") || "home";
  const legacy = LEGACY_ROUTES[rawView];
  const view = legacy?.view || rawView;
  const requestedTab = params.get("tab") || legacy?.tab || localStorage.getItem("sp-current-tab");
  const tab = requestedTab && ROUTE_SECTIONS[view + ":" + requestedTab]
    ? requestedTab
    : DEFAULT_TABS[view] || null;
  return {
    view,
    tab,
    focus: params.get("focus") || legacy?.focus || null,
    message: params.get("message") || null,
    kingdom: params.get("kingdom") || null,
    category: params.get("category") || null,
  };
}

let currentRoute = routeFromLocation();
let lastSelections = { trainUnit: "", target: "", attackUnits: {}, recruitment: {}, fabrials: {}, espionageMission: {}, espionageDefense: {}, espionageOperation: "investigation" };
let previewListenersReady = false;
let activePopoverAnchor = null;
let inboxFilter = "all";
let holdingsExpanded = false;
let latestLoadRequest = 0;
let loadedPlateauCommitmentId = null;
let deferredInstallPrompt = null;
let quantityIncrement = [1, 10, 50, 100].includes(Number(localStorage.getItem("sp-quantity-increment"))) ? Number(localStorage.getItem("sp-quantity-increment")) : 10;
const sessionQueries = createSessionQueryCache();
const routeDetails = { events: [], eventsLoadedAt: 0, eventsRequest: null };
const subscriptionLifecycle = createSubscriptionLifecycle({
  createClient: () => new ConvexClient(CONVEX_URL, { unsavedChangesWarning: false }),
});
const loadCoordinator = createLoadCoordinator((options) => load(options));
let reactiveRenderPromise = Promise.resolve();

const $ = (id) => document.getElementById(id);

function intelligenceUnlocks() {
  return intelligenceDisclosureState({
    networkLevel: state?.espionage?.networkLevel || state?.me?.buildings?.espionageNetwork || 0,
    watchtowerLevel: state?.me?.buildings?.watchtower || state?.intelligence?.watchtower?.level || 0,
  });
}

/**
 * Shared attack-planner contract. Every mission uses the same unit controls,
 * outlook renderer, stat explanations, validation path, and confirmation shape.
 * Mission configuration changes only timing and intelligence presentation.
 */
const ATTACK_PLANNERS = {
  spheres: { formId: "sphere-form", unitsId: "sphere-raid-units", previewId: "sphere-raid-preview", timing: "speed", intelligence: "estimated" },
  deepPlains: { formId: "deep-plains-form", unitsId: "deep-plains-units", previewId: "deep-plains-preview", timing: "deep", intelligence: "estimated" },
  neutralSiege: { formId: "neutral-siege-form", unitsId: "neutral-siege-units", previewId: "neutral-siege-preview", timing: "speed", intelligence: "qualitative" },
  playerSiege: { formId: "player-siege-form", unitsId: "player-siege-units", previewId: "player-siege-preview", timing: "fixed", intelligence: "known-owner" },
  plateau: { formId: "plateau-form", unitsId: "plateau-run-units", previewId: "plateau-run-preview", timing: "speed-score", intelligence: "qualitative-rivals" },
};

window.addEventListener("error", (event) => {
  showAccountMessage("Browser error: " + event.message);
});

window.addEventListener("unhandledrejection", (event) => {
  showAccountMessage("Async error: " + friendlyError(event.reason));
});

const refs = {
  signIn: "auth:signIn",
  signOut: "auth:signOut",
  isAdmin: "admin:isAdmin",
  resetWorldKeepAccounts: "admin:resetWorldKeepAccounts",
  getSeasonLedger: "seasonLedger:getMine",
  rolloverSeason: "seasonLedger:rolloverSeason",
  finishActiveResearch: "admin:finishActiveResearch",
  backfillResearchSystem: "admin:backfillResearchSystem",
  bootstrapWorld: "game:bootstrapWorld",
  getClock: "game:getClock",
  getGameConfig: "config:getGameConfig",
  getPlayerSettings: "settings:get",
  updatePlayerSettings: "settings:update",
  getPlayerSummary: "players:getPlayerSummary",
  getPlayerAccounting: "players:getPlayerAccounting",
  createPlayer: "players:createPlayer",
  listPlayers: "players:listPlayers",
  upgradeBuilding: "buildings:upgradeBuilding",
  trainUnit: "army:trainUnit",
  disbandUnits: "army:disbandUnits",
  getArmy: "army:getArmy",
  getArdentiaStatus: "ardentia:getStatus",
  recruitConclave: "ardentia:recruitConclave",
  disbandConclave: "ardentia:disbandConclave",
  renameConclave: "ardentia:renameConclave",
  getResearchStatus: "research:getStatus",
  getFabrialStatus: "fabrials:getStatus",
  fabricateFabrial: "fabrials:fabricate",
  startResearch: "research:start",
  startDoctrine: "research:startDoctrine",
  launchSphereRaid: "raids:launchSphereRaid",
  launchDeepPlainsRaid: "raids:launchDeepPlainsRaid",
  getWorldPressure: "worldPressure:getStatus",
  listVisibleRaids: "raids:listVisibleRaids",
  forceResolveRaid: "raids:forceResolveRaid",
  forceResolveAllRaids: "raids:forceResolveAllRaids",
  getMyPlateauState: "plateaus:getMyPlateauState",
  getSiegeBoard: "plateaus:getSiegeBoard",
  launchNeutralSiege: "plateaus:launchNeutralSiege",
  launchPlayerSiege: "plateaus:launchPlayerSiege",
  commitSiegeDefenders: "plateaus:commitSiegeDefenders",
  reinforcePlayerSiege: "plateaus:reinforcePlayerSiege",
  beginSiegeBattle: "plateaus:beginSiegeBattle",
  launchSiegeInvestigation: "plateaus:launchSiegeInvestigation",
  setEmergencyDefense: "plateaus:setEmergencyDefense",
  fortifySiege: "plateaus:fortifySiege",
  retreatSiege: "plateaus:retreatSiege",
  forceResolveSiege: "plateaus:forceResolveSiege",
  forceResolveAllSieges: "plateaus:forceResolveAllSieges",
  backfillPlateaus: "plateaus:backfillPlateaus",
  getCurrentPlateauRun: "plateauRuns:getCurrent",
  startPlateauRun: "plateauRuns:startPlateauRun",
  joinPlateauRun: "plateauRuns:joinPlateauRun",
  cancelPlateauRunCommitment: "plateauRuns:cancelPlateauRunCommitment",
  forceResolvePlateauRun: "plateauRuns:forceResolvePlateauRun",
  listInbox: "messages:listInbox",
  sendMessage: "messages:sendMessage",
  markInboxRead: "messages:markInboxRead",
  markMessageRead: "messages:markMessageRead",
  listNotifications: "notifications:list",
  getHighstormForecast: "highstorms:getForecast",
  getPushConfiguration: "notifications:getPushConfiguration",
  markNotificationRead: "notifications:markRead",
  markAllNotificationsRead: "notifications:markAllRead",
  updateNotificationPreferences: "notifications:updatePreferences",
  registerPushDevice: "notifications:registerDevice",
  removePushDevice: "notifications:removeDevice",
  setPushDeviceSound: "notifications:setDeviceSound",
  listEvents: "game:listEvents",
  listDossiers: "intelligence:listDossiers",
  getEspionageStatus: "espionage:getStatus",
  getKingdomLedger: "espionage:getKingdomLedger",
  recruitOperatives: "espionage:recruitOperatives",
  disbandOperatives: "espionage:disbandOperatives",
  setEspionageDefense: "espionage:setDefense",
  launchInvestigation: "espionage:launchInvestigation",
  launchSphereHeist: "espionage:launchSphereHeist",
};

async function createAccount() {
  showAccountMessage("Creating account...");
  const email = $("create-email").value.trim().toLowerCase();
  const password = $("create-password").value;
  const warcampName = $("create-warcamp-name").value.trim();

  if (!email.includes("@")) {
    showAccountMessage("Enter an email address.");
    return;
  }
  if (password.length < 8) {
    showAccountMessage("Password must be at least 8 characters.");
    return;
  }
  if (warcampName.length < 2) {
    showAccountMessage("Choose a warcamp name with at least 2 characters.");
    return;
  }

  try {
    await client.mutation(refs.bootstrapWorld, {});
    await signInWithPassword("signUp", email, password);
    await client.mutation(refs.createPlayer, { name: warcampName });
    showAccountMessage("Account created.");
    await load();
  } catch (error) {
    console.error(error);
    showAccountMessage(friendlyError(error));
  }
}

async function signIn() {
  showAccountMessage("Signing in...");
  const email = $("sign-in-email").value.trim().toLowerCase();
  const password = $("sign-in-password").value;

  if (!email.includes("@")) {
    showAccountMessage("Enter an email address.");
    return;
  }
  if (!password) {
    showAccountMessage("Enter your password.");
    return;
  }

  try {
    await signInWithPassword("signIn", email, password);
    showAccountMessage("");
    await load();
  } catch (error) {
    console.error(error);
    showAccountMessage(friendlyError(error));
  }
}

async function signInWithPassword(flow, email, password) {
  const authClient = new ConvexHttpClient(CONVEX_URL);
  const result = await authClient.action(refs.signIn, {
    provider: "password",
    params: { flow, email, password },
  });
  if (!result.tokens) {
    throw new Error("Sign in did not return an auth token.");
  }
  setAuthTokens(result.tokens);
}

async function refreshAuthToken() {
  if (!refreshToken) return false;
  const authClient = new ConvexHttpClient(CONVEX_URL);
  const result = await authClient.action(refs.signIn, { refreshToken });
  if (!result.tokens) return false;
  setAuthTokens(result.tokens, { newSession: false });
  return true;
}

function setAuthTokens(tokens, options = {}) {
  const newSession = options.newSession ?? true;
  authToken = tokens.token;
  refreshToken = tokens.refreshToken;
  client.setAuth(authToken);
  localStorage.setItem(AUTH_TOKEN_KEY, authToken);
  localStorage.setItem(AUTH_REFRESH_KEY, refreshToken);
  sessionQueries.setSession(authToken);
  if (newSession) authSessionGeneration += 1;
}

async function fetchSubscriptionAuthToken({ forceRefreshToken }) {
  if (!forceRefreshToken || !refreshToken) return authToken;
  const authClient = new ConvexHttpClient(CONVEX_URL);
  const result = await authClient.action(refs.signIn, { refreshToken });
  if (!result.tokens) return null;
  setAuthTokens(result.tokens, { newSession: false });
  return authToken;
}

function clearAuthTokens() {
  authToken = null;
  refreshToken = null;
  client.clearAuth();
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(AUTH_REFRESH_KEY);
  sessionQueries.clear();
  routeDetails.events = [];
  routeDetails.eventsLoadedAt = 0;
  routeDetails.eventsRequest = null;
  rawStateData = null;
  authSessionGeneration += 1;
  void subscriptionLifecycle.dispose();
}

async function loadChronicleEventsForRoute(route) {
  if (!routeNeedsChronicle(route)) return routeDetails.events;
  if (routeDetails.eventsRequest) return routeDetails.eventsRequest;
  routeDetails.eventsRequest = client.query(refs.listEvents, {}).then((events) => {
    routeDetails.events = events;
    routeDetails.eventsLoadedAt = Date.now();
    routeDetails.eventsRequest = null;
    return events;
  }, (error) => {
    routeDetails.eventsRequest = null;
    throw error;
  });
  return routeDetails.eventsRequest;
}

async function refreshRouteDetails(route) {
  if (!state || !routeNeedsChronicle(route) || Date.now() - routeDetails.eventsLoadedAt < 1000) return;
  try {
    const events = await loadChronicleEventsForRoute(route);
    if (!state || !routeNeedsChronicle(currentRoute)) return;
    if (rawStateData) rawStateData.events = events;
    state.log = events.map((event) => ({ text: event.text, at: event.createdAt, kind: event.kind || "world", gameDate: event.gameDate || null }));
    renderLog();
    ensureReactiveSubscriptions(rawStateData);
  } catch (error) {
    console.warn("Chronicle history could not be loaded.", error);
  }
}

function subscriptionSpecs(data) {
  const monastery = Number(data.playerSummary?.player?.buildings?.ardentMonastery || 0);
  const network = Number(data.playerSummary?.player?.buildings?.espionageNetwork || 0);
  return [
    playerStateSubscription(refs),
    { key: "players", query: refs.listPlayers },
    { key: "raids", query: refs.listVisibleRaids },
    { key: "plateauSummary", query: refs.getMyPlateauState },
    { key: "plateauRun", query: refs.getCurrentPlateauRun },
    { key: "inbox", query: refs.listInbox },
    { key: "notifications", query: refs.listNotifications },
    { key: "highstorm", query: refs.getHighstormForecast },
    { key: "seasonLedger", query: refs.getSeasonLedger },
    { key: "worldPressure", query: refs.getWorldPressure },
    ...(routeNeedsChronicle(currentRoute) ? [{ key: "events", query: refs.listEvents }] : []),
    ...(routeNeedsPlateauBoard(currentRoute) ? [{ key: "plateauBoard", query: refs.getSiegeBoard }] : []),
    ...(routeNeedsTerritoryIntelligence(currentRoute) ? [{ key: "intelligence", query: refs.listDossiers }] : []),
    ...(network >= 1 ? [
      { key: "espionage", query: refs.getEspionageStatus },
      { key: "kingdomLedger", query: refs.getKingdomLedger },
    ] : []),
    ...(monastery >= 1 ? [
      { key: "ardentia", query: refs.getArdentiaStatus },
      { key: "research", query: refs.getResearchStatus },
      { key: "fabrials", query: refs.getFabrialStatus },
    ] : []),
  ];
}

function composePlateauState(summary, board) {
  return {
    types: summary?.types || board?.types || [],
    counts: summary?.counts || { sphere: 0, bridged: 0, gemheart: 0, ancient: 0 },
    mine: summary?.mine || [],
    neutral: board?.neutral || [],
    rivals: board?.rivals || [],
    sieges: routeNeedsPlateauBoard(currentRoute) ? (board?.sieges || summary?.sieges || []) : (summary?.sieges || []),
    watchtower: summary?.watchtower || board?.watchtower || { level: 0, territoryLevel: 0 },
  };
}

function ensureReactiveSubscriptions(data) {
  if (!authToken || !data?.playerSummary?.player) return;
  const sessionKey = `auth-${authSessionGeneration}`;
  const expectedSessionGeneration = authSessionGeneration;
  subscriptionLifecycle.start(sessionKey, fetchSubscriptionAuthToken, {
    onBatch: (batch) => applyReactiveBatch(batch, expectedSessionGeneration),
    onError: (error, key) => console.warn(`Convex subscription ${key} failed; the safety reconciliation remains active.`, error),
  });
  subscriptionLifecycle.sync(subscriptionSpecs(data));
}

function applyReactiveBatch(batch, expectedSessionGeneration) {
  reactiveRenderPromise = reactiveRenderPromise.then(async () => {
    if (!authToken || !rawStateData || expectedSessionGeneration !== authSessionGeneration) return;
    const accountingInputsBefore = playerAccountingInputKey(rawStateData);
    for (const [key, value] of batch) rawStateData[key] = value;
    rawStateData.plateaus = composePlateauState(rawStateData.plateauSummary, rawStateData.plateauBoard);
    if (!rawStateData.playerSummary?.player || !rawStateData.plateaus) return;
    if (playerAccountingInputKey(rawStateData) !== accountingInputsBefore) {
      rawStateData.playerAccounting = await client.query(refs.getPlayerAccounting, {}).catch((error) => {
        console.warn("Player accounting refresh failed; the safety reconciliation will recover it.", error);
        return rawStateData.playerAccounting;
      });
    }
    if (!rawStateData.intelligence) rawStateData.intelligence = { kingdoms: [], territories: [], watchtower: rawStateData.plateaus.watchtower };
    if (expectedSessionGeneration !== authSessionGeneration) return;
    state = buildState(rawStateData);
    render();
    ensureReactiveSubscriptions(rawStateData);
  }).catch((error) => console.error("Reactive state update failed; the safety reconciliation will recover it.", error));
}

function requestLoad(options = {}) {
  return loadCoordinator.request(options);
}

async function load(options = {}) {
  const requestId = ++latestLoadRequest;
  const allowRefresh = options.allowRefresh ?? true;
  const allowSeasonBootstrap = options.allowSeasonBootstrap ?? true;
  if (!authToken) return signedOut();
  sessionQueries.setSession(authToken);
  captureSelections();

  try {
    const [
      config,
      playerSummary,
      playerAccounting,
      players,
      events,
      clock,
      adminStatus,
    ] = await Promise.all([
      sessionQueries.get("config", () => client.query(refs.getGameConfig, {})),
      client.query(refs.getPlayerSummary, {}),
      client.query(refs.getPlayerAccounting, {}),
      client.query(refs.listPlayers, {}),
      loadChronicleEventsForRoute(currentRoute),
      sessionQueries.get("clock", async () => ({ ...(await client.query(refs.getClock, {})), browserReceivedAt: Date.now() })),
      sessionQueries.get("admin", () => client.query(refs.isAdmin, {})),
    ]);

    if (requestId !== latestLoadRequest) return;

    if (!playerSummary || !playerSummary.player || !playerAccounting) {
      state = null;
      signedOut();
      showAccountMessage("This login worked, but no warcamp is attached to it. Create a new account with a warcamp, or delete this test auth account and start fresh.");
      return;
    }

    const [raids, plateauSummary, plateauBoard, territoryIntelligence, plateauRun, inbox, espionage, kingdomLedger, ardentia, research, fabrials, notifications, highstorm, pushConfiguration, seasonLedger, worldPressure, playerSettings] = await Promise.all([
      client.query(refs.listVisibleRaids, {}),
      client.query(refs.getMyPlateauState, {}),
      routeNeedsPlateauBoard(currentRoute) ? client.query(refs.getSiegeBoard, {}) : Promise.resolve(null),
      routeNeedsTerritoryIntelligence(currentRoute) ? client.query(refs.listDossiers, {}) : Promise.resolve(null),
      client.query(refs.getCurrentPlateauRun, {}),
      client.query(refs.listInbox, {}),
      Number(playerSummary.player.buildings?.espionageNetwork || 0) >= 1 ? client.query(refs.getEspionageStatus, {}).catch((error) => {
        console.warn("Espionage backend is not available yet.", error);
        return { networkLevel: 0, available: {}, defending: {}, onMission: {}, counterIntelligence: 0, targets: [], missions: [], rules: { operatives: ESPIONAGE_UI_DEFAULTS.operatives, network: ESPIONAGE_UI_DEFAULTS.network } };
      }) : Promise.resolve({ networkLevel: 0, available: {}, defending: {}, onMission: {}, counterIntelligence: 0, targets: [], missions: [], rules: { operatives: ESPIONAGE_UI_DEFAULTS.operatives, network: ESPIONAGE_UI_DEFAULTS.network } }),
      Number(playerSummary.player.buildings?.espionageNetwork || 0) >= 1 ? client.query(refs.getKingdomLedger, {}).catch((error) => {
        console.warn("Kingdom Intelligence backend is unavailable.", error);
        return { loadError: true, errorMessage: friendlyError(error), season: null, rows: [], generatedAt: Date.now() };
      }) : Promise.resolve({ locked: true, season: null, rows: [], generatedAt: Date.now() }),
      Number(playerSummary.player.buildings?.ardentMonastery || 0) >= 1 ? client.query(refs.getArdentiaStatus, {}).catch(() => ({ owned: 0, away: 0, ready: 0, capacity: 0, provisionsEach: 10 })) : Promise.resolve({ owned: 0, away: 0, ready: 0, capacity: 0, provisionsEach: 10, conclaves: [] }),
      Number(playerSummary.player.buildings?.ardentMonastery || 0) >= 1 ? client.query(refs.getResearchStatus, {}).catch(() => ({ unlocked: false, completedLevels: {}, active: null, speed: { monastery: 0, conclave: 0, ancient: 0, total: 0 } })) : Promise.resolve({ unlocked: false, completedLevels: playerAccounting.completedResearch || {}, active: null, speed: { monastery: 0, conclave: 0, ancient: 0, total: 0 } }),
      Number(playerSummary.player.buildings?.ardentMonastery || 0) >= 1 ? client.query(refs.getFabrialStatus, {}).catch(() => ({ hasDiscovery: false, inventory: [] })) : Promise.resolve({ hasDiscovery: false, inventory: [] }),
      client.query(refs.listNotifications, {}).catch(() => ({ notifications: [], unreadCount: 0, preferences: { combat: true, missions: true, research: true, plateauRuns: true, messages: true }, devices: [], vapidPublicKey: null })),
      client.query(refs.getHighstormForecast, {}).catch(() => null),
      sessionQueries.get("pushConfiguration", () => client.query(refs.getPushConfiguration, {}).catch(() => ({ vapidPublicKey: null, configured: false }))),
      client.query(refs.getSeasonLedger, {}).catch((error) => {
        console.warn("Season Ledger backend is unavailable.", error);
        return { loadError: true, season: null, total: 0, categoryTotals: {}, events: [], achievements: [], rules: null, opponentChains: [] };
      }),
      client.query(refs.getWorldPressure, {}).catch(() => ({ hostility: 0, state: { key: "quiet", label: "Quiet", min: 0, max: 16 }, nextState: null, progressPercent: 0, nextDecayAt: null, nextRetaliationAt: null, retaliationEligible: false, warning: null })),
      sessionQueries.get("settings", () => client.query(refs.getPlayerSettings, {}).catch(() => ({ confirmConsequentialMissions: true, researchTeased: false }))),
    ]);

    if (requestId !== latestLoadRequest) return;
    const plateaus = composePlateauState(plateauSummary, plateauBoard);
    const resolvedTerritoryIntelligence = territoryIntelligence || { kingdoms: [], territories: [], watchtower: plateauSummary.watchtower };
    if (requestId !== latestLoadRequest) return;

    // Worlds created before seasons existed have no active ledger. Bootstrap is
    // idempotent and fills that migration gap without resetting existing data.
    if (allowSeasonBootstrap && !seasonLedger.loadError && !seasonLedger.season) {
      await client.mutation(refs.bootstrapWorld, {});
      return await load({ allowRefresh: false, allowSeasonBootstrap: false });
    }

    rawStateData = {
      config,
      playerSummary,
      playerAccounting,
      players,
      raids,
      plateauSummary,
      plateauBoard,
      plateaus,
      plateauRun,
      inbox,
      intelligence: resolvedTerritoryIntelligence,
      espionage,
      kingdomLedger,
      ardentia,
      research,
      fabrials,
      notifications,
      highstorm,
      pushConfiguration,
      seasonLedger,
      worldPressure,
      playerSettings,
      events,
      clock,
      adminStatus,
    };
    state = buildState(rawStateData);
    render();
    ensureReactiveSubscriptions(rawStateData);
  } catch (error) {
    if (requestId !== latestLoadRequest) return;
    if (allowRefresh && await refreshAuthToken()) {
      return await load({ allowRefresh: false });
    }
    console.error(error);
    signedOut();
    showAccountMessage(friendlyError(error));
  }
}

function showAccountMessage(text) {
  const message = $("message");
  if (message) message.textContent = text;
}

function buildState(data) {
  const player = data.playerSummary.player;
  const accounting = data.playerAccounting;
  const playerUnits = normalizeRosterUnits(player.units, Object.keys(data.config.units || {}));
  const buildingRules = {
    ...(data.config.buildings || {}),
    espionageNetwork: data.config.buildings?.espionageNetwork || ESPIONAGE_UI_DEFAULTS.building,
  };
  const playerBuildings = normalizeBuildingObject(player.buildings, buildingRules);
  const config = {
    ...data.config,
    units: { ...(data.config.units || {}) },
    buildings: decorateBuildings(buildingRules, playerBuildings),
    unlockedUnits: unlockedUnits({ ...(data.config.units || {}) }, playerBuildings),
  };
  const outgoingRaids = data.raids.filter((raid) => raid.attackerId === player._id);
  const outgoingSieges = (data.plateaus?.sieges || []).filter((siege) => siege.attackerId === player._id);
  const plateauAway =
    data.plateauRun?.commitments.find((entry) => entry.playerId === player._id)
      ?.units || emptyUnits();
  const raidAway = addUnitObjects(
    outgoingRaids.reduce((total, raid) => addUnitObjects(total, raid.units), emptyUnits()),
    plateauAway,
  );
  const unitsAway = outgoingSieges.reduce(
    (total, siege) => addUnitObjects(total, siege.attackerUnits || emptyUnits()),
    raidAway,
  );
  const totalUnitsAtHome = sumUnits(playerUnits);
  const totalUnitsOwned = totalUnitsAtHome + sumUnits(unitsAway);
  const availableStats = accounting.armyStats;
  const playerRows = data.players.map((entry) => ({
    id: entry._id,
    _id: entry._id,
    name: entry.name,
    acres: entry.acres,
    homePower: entry._id === player._id ? availableStats.power : null,
  }));

  return {
    config,
    gameClock: data.clock || null,
    gameDate: projectGameClock(data.clock, data.config.realMsPerGameDay)?.label || data.clock?.label || "World clock unavailable",
    me: {
      id: player._id,
      name: player.name,
      acres: accounting.ownedPlateauCount || 0,
      spheres: projectPlayerSpheres(player, accounting, data.config.realMsPerGameDay),
      gemhearts: player.gemhearts,
      units: playerUnits,
      availableUnits: playerUnits,
      unitsAway,
      buildings: playerBuildings,
      buildingStats: accounting.buildingStats,
      provisions: accounting.provisions || { used: 0, capacity: 0, remaining: 0 },
      plateauBonuses: accounting.plateauBonuses || { sphereIncomeBonusPercent: 0, bridgedTravelReductionPercent: 0 },
      plateauAttributes: accounting.plateauAttributes || { large: 0, highground: 0 },
      totalIncomePerDay: accounting.buildingStats.totalIncomePerDay,
      totalUnits: totalUnitsOwned,
      totalAvailableUnits: totalUnitsAtHome,
      power: availableStats.power,
      homePower: availableStats.power,
      completedResearch: accounting.completedResearch || {},
      sphereEconomy: {
        player,
        accounting,
        realMsPerGameDay: data.config.realMsPerGameDay,
      },
    },
    players: playerRows,
    playerMap: Object.fromEntries(playerRows.map((entry) => [entry.id, entry])),
    openAcres: 0,
    plateaus: decoratePlateaus(data.plateaus, playerRows, data.config.units),
    raids: decorateRaids(data.raids, playerRows, data.config.units),
    plateauRun: decoratePlateauRun(data.plateauRun, data.config.units),
    inbox: (data.inbox?.messages || []).map((message) => ({
      id: message._id,
      fromPlayerId: message.fromPlayerId,
      kind: message.kind || (message.fromPlayerId ? "player" : "report"),
      subject: message.subject,
      text: message.body,
      eventType: message.eventType || null,
      destinationView: message.destinationView || null,
      destinationTab: message.destinationTab || null,
      entityType: message.entityType || null,
      entityId: message.entityId || null,
      kingdomId: message.kingdomId || null,
      intelligenceCategory: message.intelligenceCategory || null,
      read: Boolean(message.readAt),
      at: message.createdAt,
    })),
    unreadCount: data.inbox?.unreadCount || 0,
    isAdmin: Boolean(data.adminStatus?.isAdmin),
    adminEmail: data.adminStatus?.email || null,
    alerts: [],
    intelligence: data.intelligence || { kingdoms: [], territories: [], watchtower: { level: 0, territoryLevel: 0, counterIntelligence: 0 } },
    espionage: {
      networkLevel: 0, available: {}, defending: {}, onMission: {}, counterIntelligence: 0, targets: [], missions: [],
      ...(data.espionage || {}),
      rules: {
        ...(data.espionage?.rules || {}),
        operatives: { ...ESPIONAGE_UI_DEFAULTS.operatives, ...(data.espionage?.rules?.operatives || {}) },
        network: { ...ESPIONAGE_UI_DEFAULTS.network, ...(data.espionage?.rules?.network || {}) },
        sphereHeist: { ...ESPIONAGE_UI_DEFAULTS.sphereHeist, ...(data.espionage?.rules?.sphereHeist || {}) },
      },
    },
    kingdomLedger: data.kingdomLedger || { season: null, rows: [], generatedAt: Date.now() },
    ardentia: data.ardentia || { owned: 0, away: 0, ready: 0, capacity: 0, provisionsEach: 10 },
    research: data.research,
    fabrials: data.fabrials || { hasDiscovery: false, inventory: [] },
    seasonLedger: data.seasonLedger,
    worldPressure: data.worldPressure || { hostility: 0, state: { key: "quiet", label: "Quiet" }, progressPercent: 0, warning: null },
    highstorm: data.highstorm || null,
    notifications: data.notifications?.notifications || [],
    notificationUnreadCount: data.notifications?.unreadCount || 0,
    notificationPreferences: data.notifications?.preferences || { combat: true, missions: true, research: true, plateauRuns: true, messages: true },
    notificationDevices: data.notifications?.devices || [],
    playerSettings: data.playerSettings || { confirmConsequentialMissions: true, researchTeased: false },
    researchTeased: Boolean(data.playerSettings?.researchTeased),
    vapidPublicKey: data.pushConfiguration?.vapidPublicKey || data.notifications?.vapidPublicKey || null,
    log: data.events.map((event) => ({ text: event.text, at: event.createdAt, kind: event.kind || "world", gameDate: event.gameDate || null })),
  };
}

function signedOut() {
  $("account-screen").classList.remove("hidden");
  $("game-screen").classList.add("hidden");
}

function render() {
  const me = state.me;
  $("account-screen").classList.add("hidden");
  $("game-screen").classList.remove("hidden");
  $("game-date").textContent = state.gameDate;
  $("player-name").textContent = me.name;
  $("settings-player-name").textContent = me.name;
  $("build-identifier").textContent = BUILD_IDENTIFIER;
  $("res-acres").textContent = number(me.acres);
  $("res-spheres").textContent = number(me.spheres);
  $("res-gemhearts").textContent = number(me.gemhearts || 0);
  $("res-units").textContent = number(me.totalAvailableUnits) + " / " + number(me.totalUnits);
  if ($("mission-confirmations")) $("mission-confirmations").checked = state.playerSettings?.confirmConsequentialMissions !== false;
  renderHostility();
  renderTopProvisions();
  renderBuildings();
  renderUnits();
  renderConclaveControls();
  renderResearch();
  renderSeasonLedger();
  renderSelects();
  renderInboxBadge();
  renderNotifications();
  renderHighstorm();
  renderRaidUnitInputs("sphere-raid-units");
  renderRaidUnitInputs("deep-plains-units");
  renderRaidUnitInputs("neutral-siege-units");
  renderRaidUnitInputs("player-siege-units");
  renderRaidUnitInputs("plateau-run-units");
  attachPreviewListeners();
  renderRaidPreviews();
  renderRaids();
  renderPlateaus();
  renderPlateau();
  renderInbox();
  renderIntelligence();
  renderLog();
  renderOverview();
  renderAdminAccess();
  renderNavStates();
  showRoute(currentRoute, { history: "replace" });
}

function stormTime(timestamp, includeMinutes = true) {
  return new Intl.DateTimeFormat(undefined, { timeZone: "America/Denver", hour: "numeric", ...(includeMinutes ? { minute: "2-digit" } : {}) }).format(new Date(timestamp));
}

function renderHighstorm() {
  const storm = state.highstorm;
  if (!storm) return;
  const active = storm.active === true;
  document.body.classList.toggle("highstorm-active", active);
  let status;
  if (active) status = "HIGHSTORM ACTIVE";
  else if (storm.forecast?.exact) status = `Highstorm: ${stormTime(storm.forecast.startAt)}`;
  else status = `Highstorm: ${stormTime(storm.forecast?.startAt)}–${stormTime(storm.forecast?.endAt)}`;
  $("highstorm-status").textContent = status;
  $("storm-details-state").textContent = active ? `The storm is active. Expected to pass at ${stormTime(storm.endAt)} Mountain Time.` : `${storm.state === "approaching" ? "The storm is approaching" : "The next storm is forecast"}: ${status.replace("Highstorm: ", "")} Mountain Time.`;
  const dismissed = sessionStorage.getItem(`sp-highstorm-dismissed:${storm.stormId}`) === "1";
  $("highstorm-banner").classList.toggle("hidden", !active || dismissed);
}

function openStormDetails() { const dialog=$("storm-details"); if (typeof dialog.showModal === "function") dialog.showModal(); else dialog.setAttribute("open",""); }
$("highstorm-indicator")?.addEventListener("click", openStormDetails);
$("highstorm-banner-details")?.addEventListener("click", openStormDetails);
$("storm-details-close")?.addEventListener("click", () => $("storm-details").close());
$("highstorm-banner-dismiss")?.addEventListener("click", () => { if(state?.highstorm) sessionStorage.setItem(`sp-highstorm-dismissed:${state.highstorm.stormId}`,"1"); $("highstorm-banner").classList.add("hidden"); });

function renderAdminAccess() {
  const isAdmin = Boolean(state?.isAdmin);
  const status = $("admin-status");
  if (status) {
    status.textContent = isAdmin
      ? "Admin tools enabled"
      : state?.adminEmail
        ? "Standard: " + state.adminEmail
        : "Standard account";
    status.title = state?.adminEmail ? "Signed in as " + state.adminEmail : "";
  }
  document.querySelectorAll("[data-admin-only='true']").forEach((element) => {
    element.classList.toggle("hidden", !isAdmin);
  });
  if (!isAdmin && (currentRoute.view === "testing" || currentRoute.view === "chronicle")) {
    currentRoute = { view: "home", tab: null };
  }
}

function renderNavStates() {
  const runState = $("run-nav-state");
  const siegeState = $("siege-nav-state");
  if (runState) runState.classList.toggle("hidden", !state.plateauRun);
  const needsDefense = state.plateaus.sieges.some((siege) => siege.defenderId === state.me.id && !siege.defenderCommittedAt);
  if (siegeState) siegeState.classList.toggle("hidden", !needsDefense);
  const researchNav = $("research-primary-nav");
  const monastery = Number(state.me.buildings.ardentMonastery || 0);
  const teased = Boolean(state.researchTeased || state.plateaus.mine.some((plateau) => plateau.type === "ancient" || plateau.type === "ancient_ruins"));
  const disclosure = researchDisclosureState({ monasteryLevel: monastery, teased });
  researchNav?.classList.toggle("hidden", disclosure === "hidden");
  const researchLabel = researchNav?.querySelector("[data-research-nav-label]");
  if (researchLabel) researchLabel.textContent = disclosure === "revealed" ? "Research" : "???";
  const intelNav = $("intelligence-primary-nav");
  const intelLabel = intelNav?.querySelector("[data-intelligence-nav-label]");
  const intel = intelligenceUnlocks();
  const intelligenceRevealed = intel.network || intel.watchtower;
  if (intelNav) {
    intelNav.disabled = !intelligenceRevealed;
    intelNav.dataset.routeTab = intel.network ? "ledger" : "territory";
    intelNav.title = intelligenceRevealed ? "Intelligence" : "Establish an intelligence network to reveal this space.";
    intelNav.setAttribute("aria-label", intelligenceRevealed ? "Intelligence" : "Unknown game space");
  }
  if (intelLabel) intelLabel.textContent = intelligenceRevealed ? "Intel" : "???";
}

function captureSelections() {
  if ($("target")) lastSelections.target = $("target").value;
  if ($("neutral-plateau-target")) lastSelections.neutralPlateau = $("neutral-plateau-target").value;
  if ($("player-plateau-target")) lastSelections.playerPlateau = $("player-plateau-target").value;
  ["sphere-fabrial", "deep-plains-fabrial", "neutral-fabrial", "player-fabrial"].forEach((id) => { if ($(id)) lastSelections.fabrials[id] = $(id).value; });
  lastSelections.siegeDefenders = lastSelections.siegeDefenders || {};
  document.querySelectorAll("[data-siege-defense-unit]").forEach((input) => {
    lastSelections.siegeDefenders[input.dataset.siegeId + ":" + input.dataset.unit] = input.value;
  });
  lastSelections.emergencyDefense = lastSelections.emergencyDefense || {};
  document.querySelectorAll("[data-emergency-defense-range]").forEach((input) => {
    lastSelections.emergencyDefense[input.dataset.siegeId] = input.value;
  });
  document.querySelectorAll("[data-attack-planner]").forEach((planner) => {
    const plannerId = planner.dataset.attackPlanner;
    lastSelections.attackUnits[plannerId] = lastSelections.attackUnits[plannerId] || {};
    planner.querySelectorAll("input[data-unit]").forEach((input) => {
      lastSelections.attackUnits[plannerId][input.dataset.unit] = input.value;
    });
  });
}

function normalizeRoute(routeOrLegacy) {
  if (typeof routeOrLegacy === "string") {
    const legacy = LEGACY_ROUTES[routeOrLegacy];
    if (legacy) return { ...legacy };
    if (routeOrLegacy === "home" || routeOrLegacy === "spanreed" || routeOrLegacy === "testing" || routeOrLegacy === "chronicle") return { view: routeOrLegacy, tab: null };
    return { view: "home", tab: null };
  }
  const legacyObject = LEGACY_ROUTES[routeOrLegacy.view];
  const route = legacyObject ? { ...legacyObject, ...routeOrLegacy, view: legacyObject.view, tab: routeOrLegacy.tab || legacyObject.tab } : { ...routeOrLegacy };
  route.tab = route.tab || DEFAULT_TABS[route.view] || null;
  if ((route.view === "testing" || route.view === "chronicle") && !state?.isAdmin) return { view: "home", tab: null };
  if (route.view === "research" && state) {
    const monastery = Number(state.me?.buildings?.ardentMonastery || 0);
    const teased = Boolean(state.researchTeased || state.plateaus?.mine?.some((plateau) => plateau.type === "ancient" || plateau.type === "ancient_ruins"));
    const disclosure = researchDisclosureState({ monasteryLevel: monastery, teased });
    if (disclosure !== "revealed") return disclosure === "teased" ? { ...route, tab: "teaser" } : { view: "home", tab: null };
  }
  if (route.view === "intelligence" && state) {
    const intel = intelligenceUnlocks();
    if ((route.tab === "ledger" || route.tab === "operations") && !intel.network) {
      return intel.watchtower ? { view: "intelligence", tab: "territory" } : { view: "home", tab: null };
    }
    if (route.tab === "territory" && !intel.watchtower) {
      return intel.network ? { view: "intelligence", tab: "ledger" } : { view: "home", tab: null };
    }
  }
  const sectionKey = route.tab ? route.view + ":" + route.tab : route.view;
  if (!ROUTE_SECTIONS[sectionKey]) return { view: "home", tab: null };
  return route;
}

function routeSection(route) {
  return ROUTE_SECTIONS[route.tab ? route.view + ":" + route.tab : route.view] || "overview";
}

function renderSpaceSubnav(route) {
  const nav = $("space-subnav");
  const tabs = SPACE_TABS[route.view] || [];
  const intel = intelligenceUnlocks();
  const visibleTabs = route.view === "intelligence" && !intel.network
    ? tabs.filter((tab) => tab.key !== "operations")
    : tabs;
  nav.classList.toggle("hidden", visibleTabs.length < 1 || route.tab === "teaser");
  nav.innerHTML = visibleTabs.map((tab) => {
    const locked = route.view === "intelligence" && ((tab.key === "ledger" || tab.key === "operations") ? !intel.network : tab.key === "territory" ? !intel.watchtower : false);
    const requirement = tab.key === "territory" ? "Watchtower" : "Ghostblood Network";
    const mysteryFabrials = route.view === "research" && tab.key === "fabrials" && !state?.fabrials?.hasDiscovery;
    const label = mysteryFabrials ? "???" : route.view === "research" && tab.key === "fabrials" ? "Fabrials" : tab.label;
    const accessibility = mysteryFabrials ? ' aria-label="Unexplored scholarly applications" title="Unexplored scholarly applications"' : '';
    return '<button type="button" class="subnav-button ' + (route.tab === tab.key ? 'active' : '') + (locked ? ' disclosure-locked' : '') + '"' + (locked ? ' disabled aria-label="Unknown intelligence function. Requires ' + requirement + '." title="Requires ' + requirement + '"' : ' data-route-view="' + route.view + '" data-route-tab="' + tab.key + '"' + accessibility) + '>' + escapeHtml(locked ? "???" : label) + (route.view === "plains" && tab.key === "plateau-runs" && state?.plateauRun ? '<span class="nav-state-dot" aria-label="Plateau Run active"></span>' : '') + '</button>';
  }).join("");
}

function applyRouteFocus(route) {
  const focus = route.message || route.focus;
  if (route.kingdom && route.category) {
    if (route.view === "intelligence" && route.tab === "operations") {
      if ($("espionage-target")) $("espionage-target").value = route.kingdom;
      if ($("espionage-category")) $("espionage-category").value = route.category;
      updateEspionagePreview();
    } else if (route.view === "intelligence" && route.tab === "ledger") {
      openKingdomIntelDetail(route.kingdom, route.category);
    }
  }
  if (!focus) return;
  const target = document.getElementById(focus) || document.querySelector('[data-entity-id="' + CSS.escape(String(focus)) + '"], [data-building="' + CSS.escape(String(focus)) + '"], [data-building-card="' + CSS.escape(String(focus)) + '"], [data-message-id="' + CSS.escape(String(focus)) + '"]');
  if (!target) return;
  target.classList.add("route-focus");
  target.scrollIntoView({ behavior: "smooth", block: "center" });
  window.setTimeout(() => target.classList.remove("route-focus"), 2600);
  if (target.tagName === "DETAILS") target.open = true;
}

function bindRouteControls(root = document) {
  root.querySelectorAll("[data-route-view]").forEach((element) => {
    if (element.dataset.routeBound === "true") return;
    element.dataset.routeBound = "true";
    if (!element.matches("button, a, [role='button']")) {
      element.setAttribute("role", "button");
      element.setAttribute("tabindex", "0");
    }
    const open = () => showRoute({ view: element.dataset.routeView, tab: element.dataset.routeTab || null, focus: element.dataset.focus || null });
    element.addEventListener("click", open);
    element.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      open();
    });
  });
}

function showRoute(routeOrLegacy, options = {}) {
  const route = normalizeRoute(routeOrLegacy);
  const sectionName = routeSection(route);
  const section = document.getElementById("view-" + sectionName);
  if (!section) return;
  const previousRoute = currentRoute;
  currentRoute = route;
  localStorage.setItem("sp-current-view", route.view);
  if (route.tab && route.tab !== "teaser") localStorage.setItem("sp-current-tab", route.tab);
  const url = new URL(location.href);
  url.search = "";
  url.searchParams.set("view", route.view);
  if (route.tab && route.tab !== "teaser") url.searchParams.set("tab", route.tab);
  for (const key of ["focus", "message", "kingdom", "category"]) if (route[key]) url.searchParams.set(key, route[key]);
  if (options.history !== "none") history[options.history === "replace" ? "replaceState" : "pushState"](route, "", url);
  document.querySelectorAll(".view").forEach((section) => {
    section.classList.toggle("active", section.id === "view-" + sectionName);
  });
  document.querySelectorAll(".nav-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.routeView === route.view);
  });
  $("home-brand")?.classList.toggle("active", route.view === "home");
  if (route.view === "home") $("home-brand")?.setAttribute("aria-current", "page"); else $("home-brand")?.removeAttribute("aria-current");
  $("view-title").textContent = section.dataset.title || "Dashboard";
  $("view-eyebrow").textContent = section.dataset.eyebrow || "Command";
  renderSpaceSubnav(route);
  bindRouteControls();
  void refreshRouteDetails(route);
  ensureReactiveSubscriptions(rawStateData);
  if (route.view === "spanreed" && localStorage.getItem("sp-auto-read-inbox") === "true" && state?.unreadCount > 0) {
    action(() => client.mutation(refs.markInboxRead, {}));
  }
  window.requestAnimationFrame(() => {
    if (shouldResetRouteScroll(previousRoute, route, options)) window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    applyRouteFocus(route);
  });
}

function showView(view) {
  showRoute(view);
}

function renderBuildings() {
  const visibleBuildings = Object.entries(state.config.buildings).filter(([key]) => key === "market" || key === "watchtower" || key === "ardentMonastery" || key === "soulcastBunker" || key === "espionageNetwork");
  const buildingCards = visibleBuildings.map(([key, building]) => {
    const level = state.me.buildings[key] ?? building.level ?? 0;
    const soulcastingLevel = Number(state.research?.completedLevels?.soulcasting || 0);
    const soulcastingDiscount = [0, 5, 10, 20][soulcastingLevel] || 0;
    const doctrineMultiplier = state.research?.economicDoctrine === "militaryState" ? 1.15 : 1;
    const nextCost = Math.round(Number(building?.nextCost || 0) * (1 - soulcastingDiscount / 100) * doctrineMultiplier);
    const affordable = state.me.spheres >= nextCost;
    const ancientOwned = state.plateaus.mine.filter((plateau) => plateau.type === "ancient" || plateau.type === "ancient_ruins").length;
    const monasteryTerritoryReady = key !== "ardentMonastery" || ancientOwned >= Number(state.config.ardentiaRules?.monasteryAncientPlateausRequired || 2);
    const values = buildingEffectValues(key, level);
    const name = key === "market" ? "Warcamp Market" : building?.name || key;
    const maxed = Number(building.maxLevel || 0) > 0 && level >= Number(building.maxLevel);
    const status = maxed ? "Mastered" : !monasteryTerritoryReady ? "Requires 2 Ancient Plateaus" : affordable ? "Affordable" : "Need " + number(nextCost - state.me.spheres);
    const ready = !maxed && affordable && monasteryTerritoryReady;
    const html = maxed
      ? '<details class="compact-completed-row established-building" data-building-card="' + key + '"><summary><span><strong>' + escapeHtml(name) + ' ' + level + '</strong><small>' + escapeHtml(values.current) + '</small></span><span class="status-badge ready">✓ Mastered</span></summary><div class="compact-detail"><p>' + escapeHtml(building?.description || "") + '</p><p><strong>Established effect:</strong> ' + escapeHtml(values.current) + '</p></div></details>'
      : '<article class="upgrade-card investment-card ' + (ready ? 'action-ready' : '') + '" data-building-card="' + key + '"><div class="card-heading"><div><strong>' + escapeHtml(name) + '</strong><span>Level ' + level + '</span></div><span class="status-badge ' + (ready ? 'ready' : 'blocked') + '">' + status + '</span></div><small>' + escapeHtml(building?.description || "") + '</small><div class="effect-comparison"><div><span>Current effect</span><strong>' + escapeHtml(values.current) + '</strong></div><div><span>After upgrade</span><strong>' + escapeHtml(values.next) + '</strong></div></div>' + (key === "ardentMonastery" ? '<p class="rule-callout">Requires 2 currently owned Ancient Plateaus. Owned: ' + ancientOwned + '.</p>' : '') + '<div class="cost-line"><span>Upgrade cost</span><strong>' + number(nextCost) + ' Spheres</strong></div><button data-building="' + key + '" data-building-name="' + escapeHtml(name) + '" data-building-cost="' + nextCost + '"' + (ready ? '' : ' disabled') + '>Upgrade to Level ' + (level + 1) + '</button></article>';
    return { maxed, ready, html };
  });
  const investments = buildingCards.filter((card) => !card.maxed).sort((a, b) => Number(b.ready) - Number(a.ready));
  const established = buildingCards.filter((card) => card.maxed);
  $("buildings").innerHTML = '<section class="content-group"><div class="section-heading"><p class="eyebrow">Available investments</p><h3>Current decisions</h3></div><div class="building-grid">' + investments.map((card) => card.html).join("") + '</div></section>' + (established.length ? '<section class="content-group"><div class="section-heading"><p class="eyebrow">Established buildings</p><h3>Completed development</h3></div><div class="compact-row-list">' + established.map((card) => card.html).join("") + '</div></section>' : '');
  document.querySelectorAll("[data-building]").forEach((button) => {
    button.addEventListener("click", () => {
      const cost = Number(button.dataset.buildingCost || 0);
      if (state.me.spheres > 0 && cost >= state.me.spheres * 0.5) {
        const remaining = state.me.spheres - cost;
        if (!window.confirm("Upgrade " + button.dataset.buildingName + " for " + number(cost) + " Spheres? You will have " + number(remaining) + " Spheres remaining.")) return;
      }
      action(() => client.mutation(refs.upgradeBuilding, { building: button.dataset.building }));
    });
  });
}

function buildingEffectValues(key, level) {
  if (key === "market") {
    const perLevel = configValue("marketSpheresPerLevelPerGameDay", 250);
    return { current: "+" + number(level * perLevel) + " Spheres/day", next: "+" + number((level + 1) * perLevel) + " Spheres/day", gain: "+" + number(perLevel) + " per day" };
  }
  if (key === "watchtower") {
    const effects = [
      "No passive territory survey · Highstorm arrival within about 4 hours",
      "Reveals plateau names, types, attributes, and broad resistance ranges · Highstorm arrival within about 2 hours",
      "Adds narrow resistance estimates · Highstorm arrival within about 1 hour",
      "Maintains narrow estimates and adds +1 Counter-Intelligence · Exact Highstorm arrival time",
    ];
    return {
      current: effects[Math.min(3, level)],
      next: effects[Math.min(3, level + 1)],
    };
  }
  if (key === "ardentMonastery") {
    const capacity = Math.max(0, Math.min(3, level));
    const nextCapacity = Math.max(0, Math.min(3, level + 1));
    return {
      current: capacity ? "Supports " + capacity + " Scout Conclave" + (capacity === 1 ? "" : "s") : "Scout Conclaves unavailable",
      next: "Supports " + nextCapacity + " Scout Conclave" + (nextCapacity === 1 ? "" : "s"),
    };
  }
  if (key === "espionageNetwork") {
    const caps = [0, 50, 100, 150];
    const boosts = [0, 5, 10, 15];
    return { current: level ? caps[Math.min(3, level)] + " Intel/rival · +" + boosts[Math.min(3, level)] + " mission boost" : "Espionage unavailable", next: caps[Math.min(3, level + 1)] + " Intel/rival · +" + boosts[Math.min(3, level + 1)] + " mission boost" };
  }
  const current = soulcastBunkerCapacity(level);
  const next = soulcastBunkerCapacity(level + 1);
  return { current: number(current) + " Provisions", next: number(next) + " Provisions", gain: "+" + number(next - current) + " capacity" };
}

function renderUnits() {
  renderArmyStatus();
  const unitCards = activeUnitEntries().map(([key, unit]) => {
    const unlocked = Boolean(state.config.unlockedUnits[key]);
    const available = state.me.availableUnits[key] || 0;
    const away = state.me.unitsAway[key] || 0;
    const count = available + away;
    const militaryMultiplier = state.research?.economicDoctrine === "taxItAll" ? 1.1 : state.research?.economicDoctrine === "militaryState" ? 0.85 : 1;
    const resourceCost = unit.gemheartCost || Math.ceil((unit.cost || 0) * militaryMultiplier);
    const resourceName = unit.gemheartCost ? "Gemheart" + (resourceCost === 1 ? "" : "s") : "Spheres";
    const provisionCost = unit.provisionsCost || 0;
    const draft = Math.max(0, Math.floor(Number(lastSelections.recruitment[key]) || 0));
    const contribution = (value) => Number(value || 0) > 0 ? "+" + formatStat(value) : formatStat(value);
    const researchBonuses = unitResearchBonuses(key);
    const statValue = (base, bonus) => contribution(base) + (bonus ? '<small class="research-stat-bonus">' + signedStat(bonus) + ' Research · ' + formatStat(Number(base || 0) + bonus) + ' total</small>' : '');
    const statTitle = (stat, base, bonus) => statTooltip(stat) + unitResearchMath(key, stat, base, bonus);
    const shardbearerSupportPower = Number(state.config.armyRules?.shardbearerSupportPowerPerUnit || 100);
    const breakthrough = key === "shardbearer"
      ? '<p class="rule-callout">Breakthrough: doubles up to ' + number(shardbearerSupportPower) + ' supporting Power per Shardbearer.</p>'
      : '';
    const startingGemhearts = Number(state.config.startingGemhearts || 0);
    const gemheartWarning = unit.gemheartCost && state.me.gemhearts <= startingGemhearts
      ? '<p class="rule-callout gemheart-scarcity"><strong>Your first Gemhearts are scarce.</strong> Reliable replacements require a Gemheart Plateau or success far out on the Plains. Spending them here is permanent.</p>'
      : '';
    const disband = key !== "shardbearer" && available > 0 ? '<button type="button" class="secondary" data-disband-unit="' + key + '" data-available="' + available + '">Disband available</button>' : '';
    const statButton = (stat, label, value, bonus = 0) => '<button type="button" class="stat-cell" data-stat-explanation="' + stat + '" aria-label="Explain ' + label + '" title="' + escapeHtml(statTitle(stat, value, bonus)) + '"><span>' + label + '</span><strong>' + statValue(value, bonus) + '</strong></button>';
    return '<article class="upgrade-card unit-card unit-' + key + ' ' + (unlocked ? "" : "locked") + '" data-recruit-card="' + key + '"><div class="card-heading"><div><strong>' + escapeHtml(unit.name) + '</strong><span>' + escapeHtml(unit.role || "") + '</span></div><span class="status-badge">Available: ' + number(available) + ' · Owned: ' + number(count) + '</span></div><div class="unit-stat-grid">' + statButton("power", "Power", unit.power, researchBonuses.power) + statButton("speed", "Speed", unit.speed) + statButton("plunder", "Plunder", unit.plunder, researchBonuses.plunder) + statButton("survivability", "Survive", unit.survivability, researchBonuses.survivability) + '</div>' + breakthrough + gemheartWarning + '<div class="unit-costs"><span><small>Recruitment cost</small><strong>' + number(resourceCost) + ' ' + escapeHtml(resourceName) + '</strong></span><span><small>Provision cost</small><strong>' + number(provisionCost) + ' each</strong></span></div>' + quantityControlMarkup('data-recruit-quantity aria-label="Recruitment quantity"', draft, maxRecruitable(key), { max: true }) + '<div data-recruit-preview class="recruit-preview"></div><button type="button" data-recruit-submit>Recruit ' + escapeHtml(unit.name) + '</button>' + disband + '<details class="details-lore"><summary>Details &amp; Lore</summary><div class="unit-identity"><p>' + escapeHtml(unit.identity || "") + '</p><small><strong>Best for:</strong> ' + escapeHtml(unit.bestFor || "General operations.") + '</small></div></details></article>';
  }).join("");
  const monasteryLevel = Number(state.me.buildings.ardentMonastery || 0);
  const ardentia = state.ardentia;
  const rules = state.config.ardentiaRules || { recruitmentCost: 2000, provisionsCost: 10 };
  const canRecruit = monasteryLevel > 0 && ardentia.owned < ardentia.capacity && state.me.spheres >= rules.recruitmentCost && state.me.provisions.remaining >= rules.provisionsCost;
  const conclaveCombatReady = Number(state.research?.completedLevels?.religiousStudies || 0) >= 3;
  const conclaveRows = (ardentia.conclaves || []).map((entry) => '<div class="compact-status-row"><span><strong>' + escapeHtml(entry.name) + '</strong><small>' + (entry.missionId ? 'Away on mission' : 'Ready · Rank ' + number(entry.rank)) + '</small></span>' + (entry.missionId ? '<span class="status-badge blocked">Committed</span>' : '<button type="button" class="secondary compact-button" data-disband-conclave="' + entry._id + '" data-conclave-name="' + escapeHtml(entry.name) + '">Disband</button>') + '</div>').join('');
  const conclaveCard = monasteryLevel > 0
    ? '<article class="upgrade-card unit-card conclave-card"><div class="card-heading"><div><strong>Ardentia Scout Conclave</strong><span>Field intelligence specialists</span></div><span class="status-badge">' + number(ardentia.ready) + ' ready / ' + number(ardentia.owned) + ' formed</span></div><div class="unit-identity"><p>' + (conclaveCombatReady ? 'May accompany an army as an unkillable support cohort, strengthening its Power and Survive. A deployed Conclave stops contributing Research speed until it returns.' : 'Accompanies an army to improve the resulting intelligence report. It does not add combat Power until the necessary Religious Studies are complete.') + '</p><small><strong>Capacity:</strong> ' + number(ardentia.owned) + ' / ' + number(ardentia.capacity) + ' supported by Ardent Monastery level ' + monasteryLevel + '.</small></div><div class="unit-costs"><span><small>Formation cost</small><strong>' + number(rules.recruitmentCost) + ' Spheres</strong></span><span><small>Provision cost</small><strong>' + number(rules.provisionsCost) + '</strong></span></div><p class="rule-callout">One Conclave may accompany each expedition. It always has at least a 25% chance to complete its investigation and is never permanently destroyed.</p><button type="button" data-recruit-conclave' + (canRecruit ? '' : ' disabled') + '>' + (ardentia.owned >= ardentia.capacity ? 'Monastery capacity reached' : 'Form Scout Conclave') + '</button>' + conclaveRows + '</article>'
    : '';
  const operativeRoles = { informant: "Rumor gatherers and local contacts", spy: "Trained covert field agents", ghostblood: "Elite clandestine operatives" };
  const operativeCards = Object.entries(state.espionage?.rules?.operatives || {}).map(([tier, rule]) => { const unlocked = Number(state.espionage?.networkLevel || 0) >= Number(rule.networkLevel || 0); const available = Number(state.espionage?.available?.[tier] || 0); return '<article class="upgrade-card unit-card operative-card operative-' + tier + ' ' + (unlocked ? '' : 'locked') + '" data-recruit-card="' + tier + '"><div class="card-heading"><div><strong>' + escapeHtml(rule.name) + '</strong><span>' + escapeHtml(operativeRoles[tier] || "Espionage operative") + '</span></div><span class="status-badge ' + (unlocked ? 'ready' : 'blocked') + '">' + (unlocked ? 'Available: ' + number(available) : 'Network ' + number(rule.networkLevel) + ' required') + '</span></div><div class="unit-stat-grid"><div class="stat-cell operative-stat"><span>Spy Power</span><strong>' + number(rule.spyPower) + '</strong></div><div class="stat-cell operative-stat"><span>Network level</span><strong>' + number(rule.networkLevel) + '</strong></div></div><div class="unit-costs"><span><small>Recruitment cost</small><strong>' + number(rule.sphereCost) + ' Spheres</strong></span><span><small>Provision cost</small><strong>' + number(rule.provisionsCost) + ' each</strong></span></div><div class="operative-recruit">' + quantityControlMarkup('data-operative-recruit-count="' + tier + '" aria-label="' + escapeHtml(rule.name) + ' recruitment count"' + (unlocked ? '' : ' disabled'), 1, unlocked ? Math.max(0, Math.floor(state.me.spheres / Number(rule.sphereCost || 1))) : 0, { max: true }) + '<button type="button" data-recruit-operative="' + tier + '"' + (unlocked ? '' : ' disabled') + '>Recruit ' + escapeHtml(rule.name) + '</button></div>' + (available ? '<button type="button" class="secondary" data-disband-operative="' + tier + '" data-available="' + available + '">Disband available</button>' : '') + '</article>'; }).join('');
  const groupOpen = (key) => localStorage.getItem("sp-recruitment-group-v1-" + key) !== "closed";
  const group = (key, title, summary, content, contentClass) => '<details class="recruitment-group form-wide" data-recruitment-group="' + key + '"' + (groupOpen(key) ? ' open' : '') + '><summary><span><strong>' + title + '</strong><small>' + summary + '</small></span><span class="recruitment-group-affordance" aria-hidden="true"></span></summary><div id="recruitment-group-' + key + '" class="recruitment-group-content ' + contentClass + '">' + content + '</div></details>';
  const militaryOwned = activeUnitEntries().reduce((sum, [key]) => sum + Number(state.me.availableUnits[key] || 0) + Number(state.me.unitsAway[key] || 0), 0);
  const operativeOwned = Object.keys(state.espionage?.rules?.operatives || {}).reduce((sum, tier) => sum + Number(state.espionage?.available?.[tier] || 0) + Number(state.espionage?.defending?.[tier] || 0) + Number(state.espionage?.onMission?.[tier] || 0), 0);
  const expeditionHintKey = "sp-first-neutral-expedition-v1-" + state.me.id;
  const hasNeutralHolding = state.plateaus.mine.some((plateau) => plateau.origin === "neutral");
  if (hasNeutralHolding) localStorage.setItem(expeditionHintKey, "complete");
  const showExpeditionHint = localStorage.getItem(expeditionHintKey) !== "complete";
  const expeditionHint = showExpeditionHint ? '<aside class="fresh-player-dispatch"><div><span>Orders from the warcamp</span><strong>The Plains wait beyond the warcamp.</strong><p>Recruit a force suited to the crossing, then send it to survey an unclaimed plateau. Strength may win the ground, but Speed, Plunder, and Survive shape what returns.</p></div><button type="button" data-route-view="plains" data-route-tab="sieges">Survey the Plains</button></aside>' : '';
  $("unit-roster").innerHTML = expeditionHint + group("military", "Military Units", number(militaryOwned) + " owned", unitCards, "building-grid") + group("ardents", "Ardents", number(ardentia.ready) + " ready · " + number(ardentia.owned) + " formed", conclaveCard || '<div class="empty">Construct an Ardent Monastery to form Scout Conclaves.</div>', "building-grid") + group("espionage", "Espionage Operatives", number(operativeOwned) + " owned", '<p class="hint">Recruit here; assign defenders and launch missions from Intelligence.</p><div class="operative-roster">' + operativeCards + '</div>', "personnel-group");
  $("unit-roster").querySelectorAll("[data-recruitment-group]").forEach((details) => details.addEventListener("toggle", () => localStorage.setItem("sp-recruitment-group-v1-" + details.dataset.recruitmentGroup, details.open ? "open" : "closed")));
  attachRecruitmentControls();
  const recruitConclave = document.querySelector("[data-recruit-conclave]");
  if (recruitConclave) {
    recruitConclave.addEventListener("click", () => {
      const name = window.prompt("Name the new Scout Conclave (or leave blank for a numbered name)", "");
      if (name === null) return;
      action(() => client.mutation(refs.recruitConclave, name.trim() ? { name: name.trim() } : {}));
    });
  }
  bindQuantityControls($("unit-roster"));
  $("unit-roster").querySelectorAll("[data-recruit-operative]").forEach((button) => button.addEventListener("click", () => { const input = $("unit-roster").querySelector('[data-operative-recruit-count="' + button.dataset.recruitOperative + '"]'); action(() => client.mutation(refs.recruitOperatives, { tier: button.dataset.recruitOperative, count: Math.floor(Number(input?.value) || 0) })); }));
  const confirmDisband = (label, maximum) => { const raw = window.prompt('Disband how many ' + label + '? (1–' + maximum + ')\nNo resources will be refunded.', '1'); if (raw === null) return 0; const count = Number(raw); if (!Number.isInteger(count) || count < 1 || count > maximum) { window.alert('Enter a whole number from 1 to ' + maximum + '.'); return 0; } return window.confirm('Disband ' + count + ' ' + label + '?\nNo resources will be refunded.') ? count : 0; };
  $("unit-roster").querySelectorAll("[data-disband-unit]").forEach((button) => button.addEventListener("click", () => { const count = confirmDisband(state.config.units[button.dataset.disbandUnit]?.name || 'units', Number(button.dataset.available)); if (count) action(() => client.mutation(refs.disbandUnits, { unit: button.dataset.disbandUnit, count })); }));
  $("unit-roster").querySelectorAll("[data-disband-operative]").forEach((button) => button.addEventListener("click", () => { const label = state.espionage.rules.operatives[button.dataset.disbandOperative]?.name || 'operatives'; const count = confirmDisband(label, Number(button.dataset.available)); if (count) action(() => client.mutation(refs.disbandOperatives, { tier: button.dataset.disbandOperative, count })); }));
  $("unit-roster").querySelectorAll("[data-disband-conclave]").forEach((button) => button.addEventListener("click", () => { if (window.confirm('Disband ' + button.dataset.conclaveName + '?\nNo resources will be refunded.')) action(() => client.mutation(refs.disbandConclave, { conclaveId: button.dataset.disbandConclave })); }));
}

function renderSeasonLedger() {
  const ledger = state.seasonLedger || {};
  if (ledger.loadError) {
    if ($("ledger-season-name")) $("ledger-season-name").textContent = "Ledger unavailable";
    if ($("ledger-total")) $("ledger-total").textContent = "—";
    if ($("ledger-categories")) $("ledger-categories").innerHTML = '<div class="empty">The Season Ledger could not reach its Convex backend. Refresh after the backend deployment is complete.</div>';
    if ($("ledger-achievements")) $("ledger-achievements").innerHTML = '<div class="empty">Badge data is temporarily unavailable.</div>';
    if ($("ledger-events")) $("ledger-events").innerHTML = '<div class="empty">Scoring history is temporarily unavailable.</div>';
    if ($("ledger-rules")) $("ledger-rules").innerHTML = '<p class="warning-text">Scoring rules could not be loaded. The Ledger will not substitute zeroes for missing backend values.</p>';
    return;
  }
  const totals = ledger.categoryTotals || {};
  const rules = ledger.rules || {};
  const categories = rules.categories || {
    military: { name: "Military", description: "Combat accomplishments" },
    research: { name: "Research", description: "Scholarship and discovery" },
    economy: { name: "Economy", description: "Kingdom investment" },
    territory: { name: "Territory", description: "Expansion and control" },
  };
  if ($("ledger-season-name")) $("ledger-season-name").textContent = ledger.season?.name || "Season awaiting initialization";
  if ($("ledger-total")) $("ledger-total").textContent = number(ledger.total || 0);
  const ownIntelligence = (state.kingdomLedger?.rows || []).find((row) => row.playerId === state.me.id);
  if ($("ledger-categories")) $("ledger-categories").innerHTML = Object.entries(categories).map(([key, category]) =>
    '<article class="ledger-category-card"><span>' + escapeHtml(category.name) + '</span><strong>' + number(totals[key] || 0) + '</strong><b class="score-quality">' + escapeHtml(ownIntelligence?.cells?.[key]?.presentation?.label || "Unranked") + '</b><small>' + escapeHtml(category.description || "") + '</small></article>'
  ).join("");
  const earned = Object.fromEntries((ledger.achievements || []).map((entry) => [entry.key, entry]));
  const achievementRules = rules.achievements || {};
  if ($("ledger-achievements")) $("ledger-achievements").innerHTML = Object.entries(achievementRules).filter(([key]) => earned[key]).map(([key, badge]) => {
    const record = earned[key];
    return '<article class="ledger-badge-card earned"><span class="ledger-badge-icon">' + escapeHtml(badge.icon || "•") + '</span><strong>' + escapeHtml(badge.name) + '</strong><p>' + escapeHtml(badge.flavor || "") + '</p><small>+' + number(badge.points) + ' ' + escapeHtml(categories[badge.category]?.name || badge.category) + ' · Earned ' + escapeHtml(new Date(record.earnedAt).toLocaleString()) + '</small></article>';
  }).join("") || '<div class="empty">No seasonal distinctions earned yet.</div>';

  if ($("ledger-events")) $("ledger-events").innerHTML = (ledger.events || []).map((event) =>
    '<article class="ledger-event"><b>+' + number(event.points) + '</b><span><strong>' + escapeHtml(categories[event.category]?.name || event.category) + '</strong><small>' + escapeHtml(event.description) + (event.multiplier && event.multiplier < 1 ? ' · ' + Math.round(event.multiplier * 100) + '% value' : '') + '</small></span><small>' + escapeHtml(new Date(event.createdAt).toLocaleString()) + '</small></article>'
  ).join("") || '<div class="empty">No scoring events yet. Your next accomplishment will appear here.</div>';

  const military = rules.military || {};
  const research = rules.research || {};
  const economy = rules.economy || {};
  const territory = rules.territory || {};
  const chain = rules.opponentChains || {};
  const hours = (ms) => Math.round(Number(ms || 0) / 3600000);
  if ($("ledger-rules")) $("ledger-rules").innerHTML = '<div class="ledger-rule-grid">' +
    '<article><h3>Military</h3><ul><li>Successful Parshendi raid with Sphere recovery: +' + number(military.parshendiRaidVictory || 0) + '</li><li>PvP siege capture: +' + number(military.pvpSiegeVictory || 0) + ' before chain adjustment</li><li>Successful siege defense: +' + number(military.pvpSiegeDefense || 0) + '</li><li>Successful Plateau Run: winner +' + number(military.plateauRunWinner || 0) + ', meaningful contributor +' + number(military.plateauRunContributor || 0) + '</li><li>Failed Plateau Runs award no score.</li></ul></article>' +
    '<article><h3>Research</h3><ul><li>Research levels: ' + (research.levelPoints || []).map((value, index) => 'L' + (index + 1) + ' +' + value).join(', ') + '</li><li>Ancient Plateau scholarship every ' + hours(research.ancientHoldIntervalMs) + ' hours: +' + number(research.ancientHoldPoints || 0) + '</li><li>Doctrine switching awards no score.</li></ul></article>' +
    '<article><h3>Economy</h3><ul><li>Market upgrade: +' + number(economy.buildingPoints?.market || 0) + '</li><li>Other building upgrade: +' + number(economy.buildingPoints?.watchtower || 0) + '</li><li>Sphere balances and passive accumulation award no score.</li></ul></article>' +
    '<article><h3>Territory</h3><ul><li>Control milestones: ' + (territory.milestones || []).map((entry) => entry.count + ' plateaus +' + entry.points).join(', ') + '</li><li>Each held plateau every ' + hours(territory.holdIntervalMs) + ' hours: +' + number(territory.holdPoints || 0) + '</li><li>Ancient and Gemheart plateaus receive a modest bonus.</li></ul></article>' +
    '<article><h3>Repeated opponents</h3><p>Every PvP siege launch extends that opponent chain. Values are ' + (chain.multipliers || []).map((value) => Math.round(value * 100) + '%').join(', ') + ' and reset after ' + hours(chain.resetAfterMs) + ' hours without another launch against that kingdom. Defending score is never reduced.</p></article>' +
    '</div>';
}

function renderConclaveControls() {
  const conclaves = state.ardentia?.conclaves || [];
  const readyConclavesOnly = conclaves.filter((entry) => !entry.missionId);
  const awayConclaves = conclaves.filter((entry) => entry.missionId);
  const combatReady = Number(state.research?.completedLevels?.religiousStudies || 0) >= 3;
  ["sphere-conclave", "deep-plains-conclave", "neutral-conclave-select", "player-conclave-select", "plateau-conclave"].forEach((id) => {
    const select = $(id);
    if (!select) return;
    const selected = select.value;
    select.innerHTML = '<option value="">No Conclave</option>' + readyConclavesOnly.map((entry) => '<option value="' + entry._id + '">' + escapeHtml(entry.name) + ' · Rank ' + entry.rank + '</option>').join("") + awayConclaves.map((entry) => '<option disabled>' + escapeHtml(entry.name) + ' · Away on mission</option>').join("");
    select.disabled = conclaves.length < 1;
    if (readyConclavesOnly.some((entry) => entry._id === selected)) select.value = selected;
    const detail = select.closest(".conclave-deployment")?.querySelector("[data-conclave-tradeoff]");
    if (detail) detail.textContent = combatReady
      ? "Religious Studies III: adds +10 Power plus 50% of up to 100 existing Power, +50% Survive, +25 Plunder, and +1 Speed. The Conclave is not killed like a normal unit, but contributes no Research speed until it returns."
      : "Improves the resulting intelligence report. It does not add combat strength until Religious Studies III.";
  });
  return;
  const monasteryLevel = Number(state.me.buildings.ardentMonastery || 0);
  const ready = Number(state.ardentia?.ready || 0);
  [
    ["neutral-conclave-option", "neutral-conclave"],
    ["player-conclave-option", "player-conclave"],
  ].forEach(([wrapperId, checkboxId]) => {
    const wrapper = $(wrapperId);
    const checkbox = $(checkboxId);
    if (!wrapper || !checkbox) return;
    wrapper.classList.toggle("hidden", monasteryLevel < 1);
    wrapper.classList.toggle("unavailable", ready < 1);
    checkbox.disabled = ready < 1;
    if (ready < 1) checkbox.checked = false;
    const detail = wrapper.querySelector("small");
    if (detail && monasteryLevel > 0) {
      const base = checkboxId === "neutral-conclave"
        ? "Improves the resulting report by one Intelligence level if the Conclave completes its investigation."
        : "Improves the resulting rival dossier by one Intelligence level if the Conclave completes its investigation.";
      detail.textContent = base + " Minimum success chance: 25%. " + ready + " ready.";
    }
  });
  const readyConclaves = (state.ardentia?.conclaves || []).filter((entry) => !entry.missionId);
  ["sphere-conclave", "neutral-conclave-select", "player-conclave-select", "plateau-conclave"].forEach((id) => {
    const select = $(id);
    if (!select) return;
    select.innerHTML = '<option value="">No Conclave</option>' + readyConclaves.map((entry) => '<option value="' + entry._id + '">' + escapeHtml(entry.name) + ' · Rank ' + entry.rank + '</option>').join("");
    select.disabled = readyConclaves.length < 1;
  });
  if ($("espionage-target")) lastSelections.espionageTarget = $("espionage-target").value;
  if ($("espionage-operation")) lastSelections.espionageOperation = $("espionage-operation").value;
  if ($("espionage-category")) lastSelections.espionageCategory = $("espionage-category").value;
  if ($("espionage-intel-spend")) lastSelections.espionageIntelSpend = $("espionage-intel-spend").value;
  document.querySelectorAll("[data-espionage-mission-tier]").forEach((input) => { lastSelections.espionageMission[input.dataset.espionageMissionTier] = input.value; });
  document.querySelectorAll("[data-espionage-defense-tier]").forEach((input) => { lastSelections.espionageDefense[input.dataset.espionageDefenseTier] = input.value; });
}

function researchEffectText(key, level, project) {
  if (!level) return "Not yet researched";
  const value = project.effects[level - 1];
  const secondary = project.speedEffects?.[level - 1] || 0;
  if (key === "bridgeEngineering") return "+" + value + " total army Speed";
  if (key === "packHarnessDesign") return "+" + value + " Plunder and " + secondary + " Speed per Chull";
  if (key === "painrialMedicine") return "+" + value + " Survive per Spearman";
  if (key === "soulcastArmor") return "+" + value + " Power and " + secondary + " Speed per Spearman";
  if (key === "siegeEngineering") return "Emergency Defenses " + value + "% cheaper";
  if (key === "gemCutting") return value + "-hour Gemheart production interval";
  if (key === "soulcasting") return value + "% total building discount";
  if (key === "marketEconomics") return "+" + value + "% total Market income";
  if (key === "sprenStudies") return ["", "Subtle Signals: occasional strange reports", "Spren Observation: chance of a bonus Territory fact", "Ancient Insight: +1 permanent Ancient Plateau-equivalent for Research requirements only", "A deeper path begins to answer"][level];
  if (key === "religiousStudies") return ["", "Conclaves earn mission XP twice as quickly", "+1 effective Conclave rank for Research", "Conclaves may strengthen armies instead of Research", "A deeper path begins to answer"][level];
  return String(value) + " " + project.effect;
}

function researchLibraryOpen(key) {
  const saved = localStorage.getItem("sp-research-library-" + key);
  return saved == null ? key === "economic" : saved === "open";
}

function renderResearch() {
  const currentContainer = $("research-current");
  const librariesContainer = $("research-libraries");
  const ardentsContainer = $("research-ardents");
  const bonusesContainer = $("research-bonuses");
  renderFabrials();
  if (!currentContainer || !librariesContainer || !ardentsContainer || !bonusesContainer) return;
  const research = state.research || {};
  if (!research.unlocked) {
    const locked = '<div class="empty"><strong>The ardents seek room to grow.</strong><p>Construct an Ardent Monastery to establish formal scholarship.</p></div>';
    currentContainer.innerHTML = locked;
    librariesContainer.innerHTML = locked;
    ardentsContainer.innerHTML = locked;
    bonusesContainer.innerHTML = '<div class="empty">No formal Research bonuses are active.</div>';
    return;
  }
  const rules = research.rules || state.config.researchRules;
  const active = research.active;
  const activeName = active?.kind === "doctrine" ? research.doctrines?.[active.doctrine]?.name : rules.projects[active?.project]?.name;
  const activeHtml = active ? '<article class="upgrade-card investment-card active-research-card"><div class="card-heading"><div><strong>Active Research</strong><span>' + escapeHtml(activeName || "Research") + (active.level ? ' · Level ' + active.level : '') + '</span></div><span class="status-badge ' + (active.status === "paused" ? 'blocked' : 'ready') + '">' + escapeHtml(active.status) + '</span></div><p>Research speed +' + number(research.speed.total) + '%</p><div class="research-speed-breakdown"><span>Monastery +' + number(research.speed.monastery) + '%</span><span>Available Conclaves +' + number(research.speed.conclave) + '%</span><span>Ancient Plateaus +' + number(research.speed.ancient) + '%</span></div><small>' + (active.projectedCompletionAt ? 'Expected ' + new Date(active.projectedCompletionAt).toLocaleString() : 'Paused until the territory requirement is restored.') + '</small><p class="rule-callout research-switch-note">You may switch studies in Libraries. Paid progress is saved and can be resumed later.</p></article>' : '<div class="empty">No research is active. Choose a project below.</div>';
  const projectCards = Object.entries(rules.projects).map(([key, project]) => {
    const level = Number(research.completedLevels?.[key] || 0);
    const next = level + 1;
    const max = project.effects.length;
    if (next > max) return { library: project.library, completed: true, key, name: project.name, level, effect: researchEffectText(key, level, project), html: '<details class="compact-completed-row research-card"><summary><span><strong>' + escapeHtml(project.name) + '</strong><small>Level ' + max + ' mastered</small></span><span class="status-badge ready">Complete</span></summary><div class="compact-detail"><p>' + escapeHtml(project.description || "") + '</p><p><strong>Active effect:</strong> ' + escapeHtml(researchEffectText(key, level, project)) + '</p></div></details>' };
    const baseSpheres = project.costs[next - 1];
    const spheres = Math.round(baseSpheres * (research.economicDoctrine === "militaryState" ? 1.15 : 1));
    const gems = project.gemhearts[next - 1];
    const ancient = project.ancient[next - 1];
    const monastery = project.monastery[next - 1];
    const baseMinutes = Math.round(Number(project.durationsMs[next - 1]) / 60000);
    const adjustedMinutes = Math.max(1, Math.round(baseMinutes / (1 + Number(research.speed?.total || 0) / 100)));
    const speedTooltip = 'Base duration: ' + formatDuration(baseMinutes) + '\nTotal research speed: +' + number(research.speed?.total || 0) + '%\nMonastery: +' + number(research.speed?.monastery || 0) + '%\nConclaves: +' + number(research.speed?.conclave || 0) + '%\nAncient Plateaus: +' + number(research.speed?.ancient || 0) + '%\nAdjusted duration = Base ÷ (1 + total speed).';
    const needsGemPlateau = Boolean(project.requiresGemheartPlateau?.[next - 1]);
    const defenses = Number(project.defensiveSieges?.[next - 1] || 0);
    const savedKey = 'project:' + key + ':' + next;
    const saved = research.savedProgress?.[savedKey];
    const currentlyActive = active?.kind === 'project' && active.project === key && Number(active.level || 0) === next;
    const requirementsMet = Number(state.me.buildings.ardentMonastery || 0) >= monastery && Number(research.speed?.researchAncientCount || research.speed?.ancientCount || 0) >= ancient && (!needsGemPlateau || Number(research.speed?.gemheartPlateauCount || 0) > 0) && Number(research.successfulDefensiveSieges || 0) >= defenses;
    const canStart = !currentlyActive && requirementsMet && (saved || (state.me.spheres >= spheres && state.me.gemhearts >= gems));
    const savedPercent = saved?.durationBaseMs ? Math.max(1, Math.min(99, Math.floor(Number(saved.accumulatedBaseMs || 0) / Number(saved.durationBaseMs) * 100))) : 0;
    const actionLabel = currentlyActive ? 'Currently researching' : saved ? 'Resume Level ' + next + (savedPercent ? ' · ' + savedPercent + '%' : '') : active ? 'Switch to Level ' + next : 'Research Level ' + next;
    const statusLabel = currentlyActive ? 'In progress' : saved ? 'Saved · ' + savedPercent + '%' : canStart ? 'Ready' : 'Requirements unmet';
    const currentEffect = level ? '<p class="research-effect"><strong>Current effect:</strong> ' + escapeHtml(researchEffectText(key, level, project)) + '</p>' : '';
    const special = (needsGemPlateau ? '<div><span>Gemheart territory</span><strong>' + number(research.speed?.gemheartPlateauCount || 0) + ' held</strong></div>' : '') + (defenses ? '<div><span>Defensive sieges</span><strong>' + number(research.successfulDefensiveSieges || 0) + ' / ' + defenses + '</strong></div>' : '');
    const virtualInsight = Number(research.speed?.virtualAncient || 0);
    const ancientDetail = number(research.speed?.ancientCount || 0) + ' owned' + (virtualInsight ? ' + ' + number(virtualInsight) + ' research-only insight' : '') + ' / ' + ancient + ' required';
    const html = '<article class="upgrade-card investment-card research-card' + (saved ? ' saved-research-card' : '') + '"><div class="card-heading"><div><strong>' + escapeHtml(project.name) + '</strong><span>Current Level ' + level + ' · Next Level ' + next + '</span></div><span class="status-badge ' + (canStart || currentlyActive ? 'ready' : 'blocked') + '">' + escapeHtml(statusLabel) + '</span></div><p class="research-description">' + escapeHtml(project.description || "") + '</p>' + currentEffect + '<p class="research-effect"><strong>Next total effect:</strong> ' + escapeHtml(researchEffectText(key, next, project)) + '</p><div class="research-requirements"><div><span>Sphere cost</span><strong>' + (saved ? 'Paid · resume' : number(spheres) + ' Spheres') + '</strong></div><div><span>Gemheart cost</span><strong>' + (saved ? 'Paid · resume' : number(gems) + ' Gemhearts') + '</strong></div><div><span>Ancient Plateaus</span><strong>' + ancientDetail + '</strong></div><div><span>Monastery</span><strong>Level ' + monastery + '</strong></div>' + special + '</div><button type="button" class="research-time-cell" title="' + escapeHtml(speedTooltip) + '"><span>Base time</span><strong>' + formatDuration(baseMinutes) + '</strong><small>' + (saved ? savedPercent + '% preserved · no repeat cost' : 'Adjusted: ' + formatDuration(adjustedMinutes) + ' with +' + number(research.speed?.total || 0) + '% speed') + '</small></button><button data-research-project="' + key + '" data-research-name="' + escapeHtml(project.name) + '"' + (canStart ? '' : ' disabled') + '>' + escapeHtml(actionLabel) + '</button></article>';
    return { library: project.library, completed: false, key, name: project.name, level, effect: level ? researchEffectText(key, level, project) : "", html };
  });
  const rankThresholds = state.config.ardentiaRules?.rankThresholds || [0, 500, 1000, 1500, 2000];
  const rankDescriptions = [
    "Newly sworn ardents learn to turn field observations into disciplined inquiry.",
    "Practiced observers now recognize useful patterns amid the chaos of a campaign.",
    "Seasoned scholars coordinate their findings and sharpen the Monastery's work.",
    "Veteran researchers return from the field with hard-won insights few others can see.",
    "Master ardents guide the kingdom's scholarship with unmatched judgment and experience.",
  ];
  const religiousLevel = Number(research.completedLevels?.religiousStudies || 0);
  const conclaves = (state.ardentia?.conclaves || []).map((entry) => {
    const rank = Math.max(1, Number(entry.rank || 1));
    const xp = Number(entry.xp || 0);
    const rankFloor = Number(rankThresholds[rank - 1] || 0);
    const nextThreshold = rankThresholds[rank];
    const progress = nextThreshold == null ? 100 : Math.max(0, Math.min(100, ((xp - rankFloor) / (Number(nextThreshold) - rankFloor)) * 100));
    const xpLabel = nextThreshold == null ? number(xp) + " XP · Maximum rank" : number(xp) + " / " + number(nextThreshold) + " XP";
    const effectiveRank = rank + (religiousLevel >= 2 ? 1 : 0);
    const activeBonus = religiousLevel >= 3 && entry.missionId ? 0 : effectiveRank;
    return '<article class="upgrade-card conclave-progress-card"><div class="card-heading"><div><strong>' + escapeHtml(entry.name) + '</strong><span>Rank ' + rank + (effectiveRank !== rank ? ' · Effective ' + effectiveRank : '') + '</span></div><span class="status-badge ' + (entry.missionId ? 'blocked' : 'ready') + '">' + (entry.missionId ? 'Away' : 'Ready') + '</span></div><p class="rank-narrative">' + escapeHtml(rankDescriptions[rank - 1] || rankDescriptions[rankDescriptions.length - 1]) + '</p><div class="conclave-xp-heading"><span>' + escapeHtml(xpLabel) + '</span><strong>+' + activeBonus + '% active research speed</strong></div><div class="conclave-xp-track" role="progressbar" aria-label="' + escapeHtml(entry.name) + ' rank progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.round(progress) + '"><span style="width:' + progress + '%"></span></div><button class="secondary" data-rename-conclave="' + entry._id + '" data-conclave-name="' + escapeHtml(entry.name) + '">Rename</button></article>';
  }).join("");
  const cohortBonus = Number(research.speed?.conclave || 0);
  const doctrineChanges = Number(research.doctrineChangeCount || 0);
  const nextDoctrineSwitch = research.economicDoctrine ? doctrineChanges + 1 : 0;
  const doctrineCost = Number(rules.doctrine.baseSphereCost) + nextDoctrineSwitch * Number(rules.doctrine.switchSphereIncrease);
  const doctrineMinutes = Math.round((Number(rules.doctrine.baseDurationMs) + nextDoctrineSwitch * Number(rules.doctrine.switchDurationIncreaseMs)) / 60000);
  const doctrineAdjustedMinutes = Math.max(1, Math.round(doctrineMinutes / (1 + Number(research.speed?.total || 0) / 100)));
  const doctrineSpeedTooltip = 'Base duration: ' + formatDuration(doctrineMinutes) + '\nTotal research speed: +' + number(research.speed?.total || 0) + '%\nMonastery: +' + number(research.speed?.monastery || 0) + '%\nConclaves: +' + number(research.speed?.conclave || 0) + '%\nAncient Plateaus: +' + number(research.speed?.ancient || 0) + '%';
  const doctrines = Object.entries(research.doctrines || {}).map(([key, doctrine]) => {
    const selected = research.economicDoctrine === key;
    const saved = research.savedProgress?.['doctrine:' + key];
    const currentlyActive = active?.kind === 'doctrine' && active.doctrine === key;
    const savedPercent = saved?.durationBaseMs ? Math.max(1, Math.min(99, Math.floor(Number(saved.accumulatedBaseMs || 0) / Number(saved.durationBaseMs) * 100))) : 0;
    const canChoose = !selected && !currentlyActive && (saved || state.me.spheres >= doctrineCost);
    const actionLabel = selected ? 'Doctrine active' : currentlyActive ? 'Currently considering' : saved ? 'Resume doctrine · ' + savedPercent + '%' : active ? 'Switch doctrine' : research.economicDoctrine ? 'Change doctrine' : 'Adopt doctrine';
    return '<article class="upgrade-card doctrine-card' + (saved ? ' saved-research-card' : '') + '"><div class="card-heading"><div><strong>' + escapeHtml(doctrine.name) + '</strong><span>' + (selected ? 'Current doctrine' : 'Economic Doctrine') + '</span></div><span class="status-badge ' + (selected || canChoose || currentlyActive ? 'ready' : 'blocked') + '">' + (selected ? 'Active' : currentlyActive ? 'In progress' : saved ? 'Saved · ' + savedPercent + '%' : canChoose ? 'Available' : 'Unavailable') + '</span></div><p class="research-description">' + escapeHtml(doctrine.description) + '</p><div class="doctrine-effects">' + doctrine.effects.map((effect) => '<span>' + escapeHtml(effect) + '</span>').join('') + '</div><div class="research-requirements"><div><span>Sphere cost</span><strong>' + (saved ? 'Paid · resume' : number(doctrineCost) + ' Spheres') + '</strong></div></div><button type="button" class="research-time-cell" title="' + escapeHtml(doctrineSpeedTooltip) + '"><span>Base time</span><strong>' + formatDuration(doctrineMinutes) + '</strong><small>' + (saved ? savedPercent + '% preserved · no repeat cost' : 'Adjusted: ' + formatDuration(doctrineAdjustedMinutes) + ' with +' + number(research.speed?.total || 0) + '% speed') + '</small></button><button data-research-doctrine="' + key + '" data-research-name="' + escapeHtml(doctrine.name) + '"' + (canChoose ? '' : ' disabled') + '>' + escapeHtml(actionLabel) + '</button></article>';
  }).join('');
  const libraries = ["economic", "military", "ancient"].map((key) => {
    const library = rules.libraries[key];
    const cards = projectCards.filter((entry) => entry.library === key);
    const currentCards = cards.filter((entry) => !entry.completed);
    const completedCards = cards.filter((entry) => entry.completed);
    const done = completedCards.length;
    const open = researchLibraryOpen(key);
    const doctrineSection = key === 'economic' ? '<div class="doctrine-section"><div class="section-heading"><div><strong>Economic Doctrine</strong><p>One doctrine may guide the kingdom at a time. A replacement takes effect only when its Research completes; repeated changes cost more time and Spheres.</p></div><span>' + doctrineChanges + ' prior change' + (doctrineChanges === 1 ? '' : 's') + '</span></div><div class="building-grid">' + doctrines + '</div></div>' : key === 'ancient' && research.futurePathUnlocked ? '<div class="rule-callout"><strong>A veiled path has opened.</strong><br>The ardents have found a question the Monastery is not yet prepared to name.</div>' : '';
    const currentSection = currentCards.length ? '<div class="building-grid research-current-choices">' + currentCards.map((entry) => entry.html).join('') + '</div>' : '';
    const completedSection = completedCards.length ? '<section class="completed-research-section"><div class="completed-research-heading"><strong>Mastered studies</strong><small>Active effects remain in force. Expand a row for details.</small></div><div class="completed-research-grid">' + completedCards.map((entry) => entry.html).join('') + '</div></section>' : '';
    return '<section class="research-library ' + (open ? 'open' : 'collapsed') + '" data-research-library="' + key + '"><button type="button" class="research-library-toggle" aria-expanded="' + String(open) + '"><span><strong>' + escapeHtml(library.name) + '</strong><small>' + escapeHtml(library.description) + '</small></span><b>' + done + ' / ' + cards.length + ' complete · ' + (open ? 'Collapse' : 'Expand') + '</b></button><div class="research-library-body">' + doctrineSection + currentSection + completedSection + '</div></section>';
  }).join('');
  currentContainer.innerHTML = '<div class="building-grid">' + activeHtml + '</div><div class="research-current-stats">' + pulseItem("Research speed", "+" + number(research.speed?.total || 0) + "%") + pulseItem("Monastery", "+" + number(research.speed?.monastery || 0) + "%") + pulseItem("Ready Conclaves", "+" + number(research.speed?.conclave || 0) + "%") + pulseItem("Ancient insight", "+" + number(research.speed?.ancient || 0) + "%") + '</div>';
  const bonusRows = projectCards.filter((entry) => entry.level > 0 && entry.effect).map((entry) => '<div class="compact-status-row"><span><strong>' + escapeHtml(entry.name) + ' ' + number(entry.level) + '</strong><small>' + escapeHtml(entry.effect) + '</small></span><span class="status-badge ready">Active</span></div>');
  const doctrine = research.economicDoctrine ? research.doctrines?.[research.economicDoctrine] : null;
  if (doctrine) bonusRows.unshift('<div class="compact-status-row"><span><strong>' + escapeHtml(doctrine.name) + '</strong><small>' + escapeHtml(doctrine.effects.join(" · ")) + '</small></span><span class="status-badge ready">Doctrine</span></div>');
  bonusesContainer.innerHTML = bonusRows.join("") || '<div class="empty">Complete Research to establish kingdom-wide bonuses.</div>';
  librariesContainer.innerHTML = '<div class="research-libraries">' + libraries + '</div>';
  ardentsContainer.innerHTML = '<div class="cohort-heading"><div><h3>Ardent Cohort</h3><p>Field experience strengthens every Conclave and accelerates the kingdom\'s research. Ancient Plateau requirements use ' + number(research.speed?.ancientCount || 0) + ' owned territor' + (Number(research.speed?.ancientCount || 0) === 1 ? 'y' : 'ies') + (research.speed?.virtualAncient ? ' plus ' + number(research.speed.virtualAncient) + ' permanent research-only insight from Spren Studies III (not territory)' : '') + '.</p></div><span class="status-badge ready">+' + number(cohortBonus) + '% combined speed</span></div><div class="building-grid">' + (conclaves || '<div class="empty">Form a Scout Conclave from Recruitment.</div>') + '</div>';
  librariesContainer.querySelectorAll("[data-research-project]").forEach((button) => button.addEventListener("click", () => {
    if (active && !window.confirm('Switch Research to ' + button.dataset.researchName + '?\n\nYour current paid progress will be saved and can be resumed later.')) return;
    action(() => client.mutation(refs.startResearch, { project: button.dataset.researchProject }));
  }));
  librariesContainer.querySelectorAll("[data-research-doctrine]").forEach((button) => button.addEventListener("click", () => {
    if (active && !window.confirm('Switch Research to ' + button.dataset.researchName + '?\n\nYour current paid progress will be saved and can be resumed later.')) return;
    action(() => client.mutation(refs.startDoctrine, { doctrine: button.dataset.researchDoctrine }));
  }));
  librariesContainer.querySelectorAll("[data-research-library]").forEach((library) => library.querySelector(".research-library-toggle")?.addEventListener("click", () => { const open = !library.classList.contains("open"); library.classList.toggle("open", open); library.classList.toggle("collapsed", !open); localStorage.setItem("sp-research-library-" + library.dataset.researchLibrary, open ? "open" : "closed"); renderResearch(); }));
  ardentsContainer.querySelectorAll("[data-rename-conclave]").forEach((button) => button.addEventListener("click", () => {
    const name = window.prompt("Name this Scout Conclave", button.dataset.conclaveName);
    if (name !== null) action(() => client.mutation(refs.renameConclave, { conclaveId: button.dataset.renameConclave, name }));
  }));
}

function renderFabrials() {
  const container = $("research-fabrials");
  const heading = $("fabrials-heading");
  if (!container || !heading) return;
  const inventory = state?.fabrials?.inventory || [];
  if (!state?.fabrials?.hasDiscovery) {
    heading.textContent = "An unnamed possibility";
    container.innerHTML = '<div class="empty mystery-panel"><strong>The ardents sense an application they cannot yet describe.</strong><p>Separate lines of scholarship seem to be drawing toward the same unanswered question.</p></div>';
    return;
  }
  heading.textContent = "Fabrials";
  container.innerHTML = '<div class="building-grid">' + inventory.map((item) => {
    const canAfford = state.me.spheres >= item.sphereCost && state.me.gemhearts >= item.gemheartCost;
    const reason = state.me.spheres < item.sphereCost ? 'Requires ' + number(item.sphereCost) + ' Spheres' : state.me.gemhearts < item.gemheartCost ? 'Requires ' + number(item.gemheartCost) + ' Gemheart' + (item.gemheartCost === 1 ? '' : 's') : '';
    return '<article class="upgrade-card investment-card fabrial-card"><div class="card-heading"><div><strong>' + escapeHtml(item.name) + '</strong><span>' + (item.reusable ? 'Reusable' : 'Disposable') + '</span></div><span class="status-badge ready">Discovered</span></div><p class="research-description">' + escapeHtml(item.description) + '</p><p class="research-effect"><strong>Effect:</strong> ' + escapeHtml(item.effect) + '</p><div class="research-requirements"><div><span>Fabrication</span><strong>' + number(item.sphereCost) + ' Spheres</strong></div><div><span>Gemhearts</span><strong>' + number(item.gemheartCost) + '</strong></div><div><span>Produces</span><strong>' + number(item.batchSize) + '</strong></div><div><span>Inventory</span><strong>' + number(item.available) + ' available · ' + number(item.owned) + ' owned' + (item.reusable ? ' · ' + number(item.committed) + ' committed' : '') + '</strong></div></div><button data-fabricate-fabrial="' + item.kind + '"' + (canAfford ? '' : ' disabled title="' + escapeHtml(reason) + '"') + '>Fabricate ' + escapeHtml(item.name) + (item.batchSize > 1 ? ' ×' + item.batchSize : '') + '</button>' + (reason ? '<small class="hint">' + escapeHtml(reason) + '</small>' : '') + '</article>';
  }).join('') + '</div>';
  container.querySelectorAll("[data-fabricate-fabrial]").forEach((button) => button.addEventListener("click", () => action(() => client.mutation(refs.fabricateFabrial, { kind: button.dataset.fabricateFabrial }))));
}

function renderArmyStatus() {
  const container = $("army-status");
  if (!container) return;
  container.innerHTML = pulseItem("Units ready", number(state.me.totalAvailableUnits) + " / " + number(state.me.totalUnits)) + pulseItem("Ready Power", formatStat(state.me.power)) + pulseItem("Provisions", number(state.me.provisions.used) + " / " + number(state.me.provisions.capacity)) + pulseItem("Units away", number(sumUnits(state.me.unitsAway)));
}

function attachRecruitmentControls() {
  document.querySelectorAll("[data-recruit-card]").forEach((card) => {
    const key = card.dataset.recruitCard;
    const input = card.querySelector("[data-recruit-quantity]");
    if (!input) return;
    const update = (value) => { input.value = String(Math.max(0, Math.floor(Number(value) || 0))); lastSelections.recruitment[key] = input.value; renderRecruitmentPreview(card, key); };
    bindQuantityControls(card);
    input.addEventListener("input", () => update(input.value));
    card.querySelector("[data-recruit-submit]").addEventListener("click", () => action(async () => { await client.mutation(refs.trainUnit, { unit: key, count: Number(input.value) }); lastSelections.recruitment[key] = 0; }));
    renderRecruitmentPreview(card, key);
  });
}

function renderRecruitmentPreview(card, key) {
  const unit = state.config.units[key];
  const count = Math.max(0, Math.floor(Number(card.querySelector("[data-recruit-quantity]").value) || 0));
  const resourceName = unit.gemheartCost ? "Gemhearts" : "Spheres";
  const militaryMultiplier = state.research?.economicDoctrine === "taxItAll" ? 1.1 : state.research?.economicDoctrine === "militaryState" ? 0.85 : 1;
  const unitCost = unit.gemheartCost || unit.cost || 0;
  const availableResource = unit.gemheartCost ? state.me.gemhearts : state.me.spheres;
  const totalCost = unit.gemheartCost ? count * unitCost : Math.ceil(count * unitCost * militaryMultiplier);
  const provisionCost = count * (unit.provisionsCost || 0);
  const after = state.me.provisions.used + provisionCost;
  const shortages = [];
  if (totalCost > availableResource) shortages.push("Needs " + number(totalCost - availableResource) + " more " + resourceName);
  if (after > state.me.provisions.capacity) shortages.push("Needs " + number(after - state.me.provisions.capacity) + " more Provisions");
  const owned = Number(state.me.availableUnits[key] || 0) + Number(state.me.unitsAway[key] || 0);
  if (key === "chull" && state.research?.economicDoctrine === "gemheartBaron" && owned + count > 10) shortages.push("Gemheart Baron permits at most 10 owned Chulls");
  const preview = card.querySelector("[data-recruit-preview]");
  card.classList.toggle("has-draft", count > 0);
  preview.classList.toggle("empty-draft", count < 1);
  preview.innerHTML = '<span>Total cost <strong>' + number(totalCost) + ' ' + resourceName + '</strong></span><span>Provision use <strong>+' + number(provisionCost) + '</strong></span><span>After recruiting <strong>' + number(after) + ' / ' + number(state.me.provisions.capacity) + '</strong></span>' + (count < 1 ? '<small>Enter a quantity to preview recruitment.</small>' : shortages.length ? '<small class="warning-text">' + escapeHtml(shortages.join(" · ")) + '</small>' : '<small>Ready to recruit.</small>');
  card.querySelector("[data-recruit-submit]").disabled = count < 1 || shortages.length > 0;
}

function renderProvisionsSummary(containerId) {
  const container = $(containerId);
  if (!container) return;
  const provisions = state.me.provisions || { used: 0, capacity: 0, remaining: 0 };
  const overCap = provisions.used > provisions.capacity;
  container.classList.toggle("warning", overCap);
  container.innerHTML = '<div><span>Provisions</span><strong>' + number(provisions.used) + ' / ' + number(provisions.capacity) + '</strong></div><small>' +
    (overCap
      ? 'Your army is over capacity. Upgrade a Soulcast Bunker before training more units.'
      : number(provisions.remaining) + ' Provisions available for new units. Soulcast Bunkers increase capacity' + (provisions.largeBonusPercent ? ', boosted +' + number(provisions.largeBonusPercent) + '% by Large Plateaus.' : '.')) +
    '</small>';
}

function renderTopProvisions() {
  const card = $("res-provisions-card");
  const value = $("res-provisions");
  if (!card || !value) return;
  const provisions = state.me.provisions || { used: 0, capacity: 0, remaining: 0 };
  const overCap = provisions.used > provisions.capacity;
  value.textContent = number(provisions.used) + " / " + number(provisions.capacity);
  card.classList.toggle("warning", overCap);
  card.title = overCap
    ? "Over Provisions. Upgrade a Soulcast Bunker before training more units."
    : number(provisions.remaining) + " Provisions available." + (provisions.largeBonusPercent ? "\nLarge Plateau bonus: +" + number(provisions.largeBonusPercent) + "% Soulcast Bunker capacity." : "");
}

function renderSelects() {
  const targets = state.players.filter((player) => player.id !== state.me.id);
  if ($("message-target")) {
    $("message-target").innerHTML = targets.map((player) => {
      return '<option value="' + player.id + '">' + escapeHtml(player.name) + '</option>';
    }).join("");
  }
  if ($("neutral-plateau-target")) {
    const neutralOptions = state.plateaus.neutral.map((plateau) => {
      const identity = plateauIdentityPresentation(plateau);
      const gameplayIdentity = identity.known ? " · " + identity.type + (identity.traits.length ? " · " + identity.traits.join(" • ") : "") : "";
      return '<option value="' + plateau.id + '">' + escapeHtml(plateau.name + gameplayIdentity + " · " + formatIntelValue(plateau.resistance)) + '</option>';
    });
    $("neutral-plateau-target").innerHTML = neutralOptions.length ? neutralOptions.join("") : '<option value="">No neutral plateaus available</option>';
    $("neutral-plateau-target").disabled = neutralOptions.length < 1;
    if (lastSelections.neutralPlateau && state.plateaus.neutral.some((plateau) => plateau.id === lastSelections.neutralPlateau)) $("neutral-plateau-target").value = lastSelections.neutralPlateau;
  }
  if ($("player-plateau-target")) {
    const rivalOptions = state.plateaus.rivals.map((plateau) => {
      const typeLabel = plateau.type === "unknown" ? "Type unknown" : plateau.typeName;
      const label = plateau.ownerName + " - " + plateau.name + " · " + typeLabel;
      return '<option value="' + plateau.id + '"' + (plateau.gemheartProgress ? ' data-gemheart-at="' + plateau.gemheartProgress.nextGemheartAt + '" data-countdown-label="' + escapeHtml(label) + '"' : '') + '>' + escapeHtml(label + (plateau.gemheartProgress ? " · Next Gemheart: " + formatCountdownAt(plateau.gemheartProgress.nextGemheartAt) : "")) + '</option>';
    });
    $("player-plateau-target").innerHTML = rivalOptions.length ? rivalOptions.join("") : '<option value="">No rival plateaus available</option>';
    $("player-plateau-target").disabled = rivalOptions.length < 1;
    if (lastSelections.playerPlateau && state.plateaus.rivals.some((plateau) => plateau.id === lastSelections.playerPlateau)) $("player-plateau-target").value = lastSelections.playerPlateau;
  }
}

function renderRaidUnitInputs(containerId) {
  const container = $(containerId);
  if (!container) return;
  if (container.contains(document.activeElement)) return;
  const planner = container.closest("[data-attack-planner]");
  const plannerId = planner?.dataset.attackPlanner || containerId;
  const currentValues = {};
  container.querySelectorAll("input[data-unit]").forEach((input) => {
    currentValues[input.dataset.unit] = input.value;
  });
  const currentCommitment = containerId === "plateau-run-units"
    ? state.plateauRun?.participants.find((entry) => entry.playerId === state.me.id)
    : null;
  container.innerHTML = Object.entries(state.config.unlockedUnits).map(([key, unit]) => {
    const available = Number(state.me.availableUnits[key] || 0) + Number(currentCommitment?.units?.[key] || 0);
    const existing = currentValues[key] ?? lastSelections.attackUnits?.[plannerId]?.[key] ?? "0";
    return '<div class="unit-input mission-unit-input"><div class="mission-unit-heading"><strong>' + escapeHtml(unit.name) + '</strong><small>Available ' + number(available) + ' · Power ' + formatStat(unit.power) + ' · Speed ' + formatStat(unit.speed) + ' · Plunder ' + formatStat(unit.plunder || 0) + ' · Survive ' + signedStat(unit.survivability) + '</small></div>' + quantityControlMarkup('data-unit="' + key + '" aria-label="' + escapeHtml(unit.name) + ' quantity"', existing, available, { half: true, max: true }) + '</div>';
  }).join("");
  bindQuantityControls(container);
}

function readRaidUnits(containerId) {
  const units = emptyUnits();
  $(containerId).querySelectorAll("input[data-unit]").forEach((input) => {
    units[input.dataset.unit] = Math.max(0, Math.floor(Number(input.value) || 0));
  });
  return units;
}

function validatedRaidUnits(containerId) {
  const units = readRaidUnits(containerId);
  const selected = sumUnits(units);
  if (!selected) throw new Error("Choose at least one ready unit before confirming this mission.");
  const currentCommitment = containerId === "plateau-run-units"
    ? state.plateauRun?.participants.find((entry) => entry.playerId === state.me.id)
    : null;
  for (const [key, count] of Object.entries(units)) {
    const available = Number(state.me.availableUnits[key] || 0) + Number(currentCommitment?.units?.[key] || 0);
    if (count > available) {
      const unitName = state.config.units[key]?.name || key;
      throw new Error(`Only ${number(available)} ${unitName} are ready; remove ${number(count - available)} from this mission.`);
    }
  }
  return units;
}

function attachPreviewListeners() {
  if (previewListenersReady) return;
  ["sphere-raid-units", "deep-plains-units", "neutral-siege-units", "player-siege-units", "plateau-run-units"].forEach((containerId) => {
    const container = $(containerId);
    if (!container) return;
    container.addEventListener("input", renderRaidPreviews);
  });
  ["neutral-plateau-target", "player-plateau-target"].forEach((id) => {
    if (!$(id)) return;
    $(id).addEventListener("input", renderRaidPreviews);
    $(id).addEventListener("change", renderRaidPreviews);
  });
  ["sphere-conclave", "deep-plains-conclave", "neutral-conclave-select", "player-conclave-select", "plateau-conclave"].forEach((id) => {
    if ($(id)) $(id).addEventListener("change", renderRaidPreviews);
  });
  previewListenersReady = true;
}

function renderRaidPreviews() {
  if (!state) return;
  if ($("sphere-mission-summary")) $("sphere-mission-summary").innerHTML = '<strong>Raid Parshendi sphere stores</strong><span>Resistance and reward are estimates. Your force is committed for the full displayed duration.</span>';
  Object.entries(ATTACK_PLANNERS).forEach(([type, planner]) => {
    const units = readRaidUnits(planner.unitsId);
    $(planner.previewId).innerHTML = previewMarkup(units, type, planner);
    const submit = $(planner.formId)?.querySelector('[data-mission-launch]');
    if (submit) submit.disabled = !attackPlannerCanSubmit(type, planner, units);
  });
}

function quantityControlMarkup(inputAttributes, value, maximum, options = {}) {
  const steps = [1, 10, 50, 100].map((step) => '<button type="button" class="secondary ' + (step === quantityIncrement ? 'active' : '') + '" data-quantity-step="' + step + '" aria-pressed="' + String(step === quantityIncrement) + '">' + step + '</button>').join('');
  return '<div class="quantity-control" data-quantity-control><div class="increment-picker" aria-label="Adjustment increment"><span>Step</span>' + steps + '</div><div class="quantity-adjust-row"><button type="button" class="secondary quantity-sign" data-quantity-adjust="-1" aria-label="Subtract selected increment">−</button><input data-quantity-input ' + inputAttributes + ' type="number" min="0" max="' + Math.max(0, Number(maximum) || 0) + '" value="' + Math.max(0, Number(value) || 0) + '" inputmode="numeric"><button type="button" class="quantity-sign" data-quantity-adjust="1" aria-label="Add selected increment">+</button>' + (options.half ? '<button type="button" class="secondary" data-quantity-half>Half</button>' : '') + (options.max ? '<button type="button" class="secondary" data-quantity-max>Max</button>' : '') + '</div></div>';
}

function bindQuantityControls(root) {
  if (!root || root.dataset.quantityControlsBound === "true") return;
  root.dataset.quantityControlsBound = "true";
  root.addEventListener("click", (event) => {
    const stepButton = event.target.closest("[data-quantity-step]");
    if (stepButton) {
      quantityIncrement = Number(stepButton.dataset.quantityStep);
      localStorage.setItem("sp-quantity-increment", String(quantityIncrement));
      document.querySelectorAll("[data-quantity-step]").forEach((button) => {
        const active = Number(button.dataset.quantityStep) === quantityIncrement;
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", String(active));
      });
      return;
    }
    const action = event.target.closest("[data-quantity-adjust], [data-quantity-half], [data-quantity-max]");
    if (!action) return;
    const control = action.closest("[data-quantity-control]");
    const input = control?.querySelector("[data-quantity-input]");
    if (!input) return;
    const maximum = Math.max(0, Number(input.max) || 0);
    const current = Math.max(0, Math.floor(Number(input.value) || 0));
    const next = action.matches("[data-quantity-half]") ? Math.floor(maximum / 2) : action.matches("[data-quantity-max]") ? maximum : current + Number(action.dataset.quantityAdjust) * quantityIncrement;
    input.value = String(Math.max(0, Math.min(maximum, Math.floor(next))));
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function maxRecruitable(key) {
  const unit = state.config.units[key];
  const militaryMultiplier = state.research?.economicDoctrine === "taxItAll" ? 1.1 : state.research?.economicDoctrine === "militaryState" ? 0.85 : 1;
  const resource = unit.gemheartCost ? state.me.gemhearts : state.me.spheres;
  const cost = unit.gemheartCost || Math.ceil(Number(unit.cost || 0) * militaryMultiplier);
  const byResource = cost > 0 ? Math.floor(resource / cost) : Number.MAX_SAFE_INTEGER;
  const byProvisions = Number(unit.provisionsCost || 0) > 0 ? Math.floor(state.me.provisions.remaining / Number(unit.provisionsCost)) : Number.MAX_SAFE_INTEGER;
  let maximum = Math.min(byResource, byProvisions);
  if (key === "chull" && state.research?.economicDoctrine === "gemheartBaron") {
    const owned = Number(state.me.availableUnits[key] || 0) + Number(state.me.unitsAway[key] || 0);
    maximum = Math.min(maximum, Math.max(0, 10 - owned));
  }
  return Math.max(0, maximum);
}

function attackPlannerCanSubmit(type, planner, units) {
  if (sumUnits(units) < 1) return false;
  if (Object.entries(units).some(([key, count]) => count > Number(state.me.availableUnits[key] || 0))) return false;
  if (type === "neutralSiege" && !$("neutral-plateau-target").value) return false;
  if (type === "playerSiege" && !$("player-plateau-target").value) return false;
  if (type === "plateau" && !state.plateauRun) return false;
  if (type === "deepPlains" && Number(state.worldPressure?.hostility || 0) < Number(state.config.worldPressure?.rules?.deepPlains?.unlockMinimumHostility || 68)) return false;
  return Boolean($(planner.formId));
}

function previewMarkup(units, type, planner) {
  const stats = raidStats(units, type);
  const isPlayerSiege = planner.timing === "fixed";
  const isDeepPlains = planner.timing === "deep";
  const deepRange = isDeepPlains ? deepPlainsTravelRange(stats.speed) : null;
  const travel = isPlayerSiege ? fixedSiegeTravelMinutes() : isDeepPlains ? deepRange.average : travelMinutes(stats.speed, true);
  const target = type === "spheres" ? sphereTargetPreview() : type === "deepPlains" ? deepPlainsTargetPreview() : type === "plateau" ? plateauTargetPreview(stats) : type === "neutralSiege" ? neutralSiegePreview(stats) : type === "playerSiege" ? playerSiegePreview(stats) : "Choose a target";
  const timingTitle = isPlayerSiege ? "Player sieges are fixed at one real hour. Army Speed does not shorten them." : isDeepPlains ? speedBreakdown(units, stats, travel, deepRange.baseAverage) + "\nRandomized base range: " + formatDuration(deepRange.baseMin) + "–" + formatDuration(deepRange.baseMax) + "\nAdjusted range: " + formatDuration(deepRange.min) + "–" + formatDuration(deepRange.max) : speedBreakdown(units, stats, travel);
  const rewardLabel = type === "plateau" ? "Reward capacity" : "Max Plunder";
  const conclaveAttached = Boolean(({ spheres: $("sphere-conclave"), deepPlains: $("deep-plains-conclave"), neutralSiege: $("neutral-conclave-select"), playerSiege: $("player-conclave-select"), plateau: $("plateau-conclave") })[type]?.value);
  const intelOutlook = type === "playerSiege" ? playerSiegeIntelOutlook(conclaveAttached) : null;
  if (type === "plateau") {
    return '<div class="outlook-heading"><span>Army outlook</span><strong>' + escapeHtml(target) + '</strong></div><div class="outlook-grid">' +
      outlookCell("Power", formatStat(stats.power), powerBreakdown(units, stats)) +
      outlookCell("Survive", signedStat(stats.survivability), survivabilityBreakdown(units, stats)) +
      outlookCell("Plunder", number(stats.plunder), plunderBreakdown(units, stats)) +
      outlookCell("Speed", signedStat(stats.speed), speedBreakdown(units, stats, travel)) +
      '</div>';
  }
  return '<div class="outlook-heading"><span>Mission outlook</span><strong>' + escapeHtml(target) + '</strong></div><div class="outlook-grid">' +
    outlookCell("Power", formatStat(stats.power), powerBreakdown(units, stats)) +
    outlookCell(rewardLabel, type === "plateau" ? "Event pool" : number(stats.plunder) + " Spheres", plunderBreakdown(units, stats)) +
    outlookCell("Time committed", isDeepPlains ? formatDuration(deepRange.min) + "–" + formatDuration(deepRange.max) : formatDuration(travel), timingTitle) +
    outlookCell("Survive", signedStat(stats.survivability), survivabilityBreakdown(units, stats)) +
    (intelOutlook ? outlookCell("Intelligence", intelOutlook.value, intelOutlook.details) : "") +
    (conclaveAttached ? outlookCell("Investigation", "Conclave attached", "Success follows this army's final casualty risk, with a minimum 25% and maximum 95% chance. The exact chance is revealed after resolution.") : "") +
    '</div>';
}

function outlookCell(label, value, details) {
  return '<button type="button" class="outlook-cell" title="' + escapeHtml(details) + '"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(value) + '</strong></button>';
}

function powerBreakdown(units, stats) {
  const lines = activeUnitEntries().filter(([key]) => Number(units[key] || 0) > 0).map(([key, unit]) => number(units[key]) + " × " + formatStat(unit.power) + " " + unit.name + " = " + formatStat(Number(units[key]) * Number(unit.power)));
  if (Number(units.shardbearer || 0) > 0) lines.push("Shardbearer Breakthrough: min(" + formatStat(stats.supportingPower) + " supporting Power, " + number(units.shardbearer) + " × " + number(state.config.armyRules?.shardbearerSupportPowerPerUnit || 100) + ") = +" + formatStat(stats.breakthroughPower));
  if (stats.soulcastArmorPowerBonus) lines.push("Tailored Armor: " + number(units.spearman) + " Spearmen × " + signedStat(stats.soulcastArmorPowerPerSpearman) + " = " + signedStat(stats.soulcastArmorPowerBonus));
  if (stats.conclavePowerBonus) lines.push("Deployed Conclave: +10 + 50% × max(0, min(100, " + formatStat(stats.preConclavePower) + " pre-Conclave Power)) = " + signedStat(stats.conclavePowerBonus));
  lines.push("Final Power: " + formatStat(stats.power));
  return lines.join("\n");
}

function plunderBreakdown(units, stats) {
  const lines = activeUnitEntries().filter(([key]) => Number(units[key] || 0) > 0).map(([key, unit]) => number(units[key]) + " × " + formatStat(unit.plunder || 0) + " " + unit.name + " = " + formatStat(Number(units[key]) * Number(unit.plunder || 0)));
  if (stats.researchPlunderBonus) lines.push("Pack Harnesses: " + number(units.chull) + " Chulls × " + signedStat(stats.packHarnessPlunderPerChull) + " = " + signedStat(stats.researchPlunderBonus));
  if (stats.conclavePlunderBonus) lines.push("Deployed Conclave support: " + signedStat(stats.conclavePlunderBonus));
  lines.push("Maximum recovery: " + number(stats.plunder) + " Spheres");
  return lines.join("\n");
}

function speedBreakdown(units, stats, travel, baseMinutesOverride = null) {
  const constant = configValue("statDiminishingConstant", 100);
  const baseMinutes = baseMinutesOverride ?? configValue("raidTravelGameDays", 1) * configValue("realMsPerGameDay", 3600000) / 60000;
  const speedMultiplier = stats.speed >= 0 ? constant / (constant + stats.speed) : 1 + Math.abs(stats.speed) / constant;
  const bridgedMultiplier = 1 - bridgedTravelReductionPercent() / 100;
  const lines = activeUnitEntries().filter(([key]) => Number(units[key] || 0) > 0).map(([key, unit]) => number(units[key]) + " × " + signedStat(unit.speed) + " " + unit.name + " = " + signedStat(Number(units[key]) * Number(unit.speed)));
  if (stats.bridgeSpeedBonus) lines.push("Bridge Engineering: " + signedStat(stats.bridgeSpeedBonus));
  if (stats.packHarnessSpeedBonus) lines.push("Pack Harnesses: " + number(units.chull) + " Chulls × " + signedStat(stats.packHarnessSpeedPerChull) + " = " + signedStat(stats.packHarnessSpeedBonus));
  if (stats.soulcastArmorSpeedBonus) lines.push("Tailored Armor: " + number(units.spearman) + " Spearmen × " + signedStat(stats.soulcastArmorSpeedPerSpearman) + " = " + signedStat(stats.soulcastArmorSpeedBonus));
  if (stats.conclaveSpeedBonus) lines.push("Deployed Conclave: " + signedStat(stats.conclaveSpeedBonus));
  lines.push("Final army Speed: " + signedStat(stats.speed));
  const formula = stats.speed >= 0
    ? "Base Time × " + constant + " ÷ (" + constant + " + " + formatStat(stats.speed) + ")"
    : "Base Time × (1 + " + formatStat(Math.abs(stats.speed)) + " ÷ " + constant + ")";
  lines.push("Base travel time: " + formatDuration(baseMinutes));
  lines.push("Speed formula: " + formula + " = " + formatStat(speedMultiplier) + "× base time");
  lines.push("After Speed: " + formatDuration(Math.ceil(baseMinutes * speedMultiplier)));
  lines.push("Bridged Plateaus: 1 − " + number(bridgedTravelReductionPercent()) + "% = " + formatStat(bridgedMultiplier) + "×");
  lines.push("Final duration: " + formatDuration(travel));
  return lines.join("\n");
}

function deepPlainsTravelRange(speed) {
  const rules = state.config.worldPressure?.rules?.deepPlains || {};
  const duration = rules.durationMinutes || [360, 480];
  const apply = (base) => travelMinutesForBase(speed, Number(base), true);
  return { baseMin: Number(duration[0]), baseMax: Number(duration[1]), baseAverage: (Number(duration[0]) + Number(duration[1])) / 2, min: apply(duration[0]), max: apply(duration[1]), average: apply((Number(duration[0]) + Number(duration[1])) / 2) };
}

function deepPlainsTargetPreview() {
  const rules = state.config.worldPressure?.rules?.deepPlains || {};
  const hostility = Number(state.worldPressure?.hostility || 0) / 100;
  const difficultyFactor = 1 + hostility * Number(rules.difficultyHostilityFactor || 1.25);
  const rewardFactor = 1 + hostility * Number(rules.rewardHostilityFactor || 0.4);
  const defense = rules.defensePower || [220, 320];
  const reward = rules.sphereReward || [3000, 5000];
  return "Estimated Power " + number(Math.round(defense[0] * difficultyFactor)) + "–" + number(Math.round(defense[1] * difficultyFactor)) + ", Sphere pool " + number(Math.round(reward[0] * rewardFactor)) + "–" + number(Math.round(reward[1] * rewardFactor));
}

function playerSiegeIntelOutlook(conclaveAttached) {
  return {
    value: conclaveAttached ? "Conclave selected" : "No Conclave",
    details: conclaveAttached ? "The selected Conclave will attempt a field investigation during the siege." : "Select a ready Conclave to conduct a field investigation.",
  };
  const target = state.plateaus.rivals.find((plateau) => plateau.id === $("player-plateau-target").value);
  const report = target?.ownerPlayerId
    ? state.intelligence?.kingdoms?.find((entry) => entry.targetPlayerId === target.ownerPlayerId)
    : null;
  const level = Number(report?.effectiveLevel || 0);
  return {
    value: "Level " + level + (conclaveAttached ? " · +1 possible" : ""),
    details: "Current kingdom dossier: " + intelLevelName(level) + "." + (conclaveAttached ? " A successful Conclave investigation raises the mission report by one level." : " Attach a ready Conclave to attempt a stronger report."),
  };
}

function survivabilityBreakdown(units, stats) {
  const constant = configValue("statDiminishingConstant", 100);
  const lines = activeUnitEntries().filter(([key]) => Number(units[key] || 0) > 0).map(([key, unit]) => number(units[key]) + " × " + signedStat(unit.survivability) + " " + unit.name + " = " + signedStat(Number(units[key]) * Number(unit.survivability)));
  if (stats.researchSurvivabilityBonus) lines.push("Field Surgery: " + number(units.spearman) + " Spearmen × " + signedStat(stats.painrialSurvivalPerSpearman) + " = " + signedStat(stats.researchSurvivabilityBonus));
  if (stats.conclaveSurvivabilityBonus) lines.push("Deployed Conclave: 50% × max(0, min(100, " + signedStat(stats.preConclaveSurvivability) + " pre-Conclave Survive)) = " + signedStat(stats.conclaveSurvivabilityBonus));
  lines.push("Army Survive: " + signedStat(stats.survivability));
  lines.push(stats.survivability >= 0
    ? "Final casualties = Base casualties × " + constant + " ÷ (" + constant + " + Survive)"
    : "Final casualties = Base casualties × (1 + |Survive| ÷ " + constant + ")");
  lines.push("Base casualties = 25% × Enemy Power ÷ Your Power, bounded from 3% to 80%.");
  return lines.join("\n");
}

function sphereTargetPreview() {
  const hostility = Number(state.worldPressure?.hostility || 0) / 100;
  const rules = state.config.worldPressure?.rules?.neutralRaid || {};
  const defenseFactor = 1 + hostility * Number(rules.difficultyHostilityFactor || 1);
  const minimumDefense = Math.round(configValue("parshendiSphereRaidMinDefense", 1) * defenseFactor);
  const maximumDefense = Math.round(configValue("parshendiSphereRaidMaxDefense", 4) * defenseFactor);
  const averageReward = (configValue("parshendiSphereRaidMinReward", 1200) + configValue("parshendiSphereRaidMaxReward", 2400)) / 2 * (1 + hostility * Number(rules.rewardHostilityFactor || 1));
  return "Possible enemy Power: " + minimumDefense + "–" + maximumDefense + "\nEstimated reward: " + plateauRunLootLabel(averageReward);
}

function plateauTargetPreview(stats) {
  if (!state.plateauRun) return "No plateau run is open";
  const participantCount = state.plateauRun.participants.length;
  const bonus = state.config.plateauRuns.joinOrderSpeedBonuses[participantCount] || 0;
  const effectiveSpeed = stats.speed + bridgedTravelReductionPercent();
  const speedScore = effectiveSpeed * (1 + bonus);
  return "Difficulty " + plateauRunDifficultyLabel(state.plateauRun.difficultyPower) + ", loot " + plateauRunLootLabel(state.plateauRun.spherePool) + ". Your speed score " + formatStat(speedScore) + " with " + Math.round(bonus * 100) + "% join bonus and " + number(bridgedTravelReductionPercent()) + "% Bridged travel reduction";
}

function neutralSiegePreview(stats) {
  const target = state.plateaus.neutral.find((plateau) => plateau.id === $("neutral-plateau-target").value);
  if (!target) return "Choose a neutral plateau";
  const identity = plateauIdentityPresentation(target);
  const identityText = identity.known
    ? target.name + "\n" + identity.type + (identity.traits.length ? " · " + identity.traits.join(" • ") : " · Standard terrain")
    : target.name + "\nPlateau type and traits unknown";
  const history = target.parshendiReclamationCount > 0 ? "\nParshendi Reclamations: " + number(target.parshendiReclamationCount) + " · Neutral Defense +" + number(target.parshendiReclamationCount * 10) + "%" : "";
  return identityText + "\nParshendi resistance: " + formatIntelValue(target.resistance) + history + "\nYour Power: " + formatStat(stats.power);
}

function playerSiegePreview(stats) {
  const target = state.plateaus.rivals.find((plateau) => plateau.id === $("player-plateau-target").value);
  if (!target) return "Choose an enemy plateau";
  const identity = target.type === "unknown" ? "Plateau identity unknown." : target.typeName + " identified.";
  const highground = target.highground ? " Highground terrain observed." : "";
  return target.ownerName + " holds " + target.name + ". " + identity + highground + " Your power " + formatStat(stats.power) + ".";
}

function renderRaids() {
  const outgoing = state.raids.filter((raid) => raid.attackerId === state.me.id);
  const world = state.raids.filter((raid) => raid.attackerId !== state.me.id && raid.targetId !== state.me.id);
  $("outgoing-queue").innerHTML = raidListMarkup(outgoing, "No raids underway.");
  $("world-queue").innerHTML = raidListMarkup(world, "No other visible raids.");
}

function renderPlateaus() {
  if (!$("owned-plateaus")) return;
  renderPlateauBonusSummary();
  renderGroupedHoldings();
  renderRaidPreviews();
  const urgent = state.plateaus.sieges.filter((siege) => siege.defenderId === state.me.id);
  const routine = state.plateaus.sieges.filter((siege) => siege.defenderId !== state.me.id);
  $("active-sieges").innerHTML = routine.length ? routine.map(siegeCard).join("") : '<div class="empty">No other active plateau sieges.</div>';
  $("urgent-sieges-panel").classList.toggle("hidden", urgent.length < 1);
  $("urgent-sieges").innerHTML = urgent.map(siegeCard).join("");

  document.querySelectorAll("[data-commit-siege-defenders]").forEach((button) => {
    button.addEventListener("click", async () => {
      const siegeId = button.dataset.commitSiegeDefenders;
      const units = readSiegeDefenderUnits(siegeId);
      const siege = state.plateaus.sieges.find((entry) => entry.id === siegeId);
      const plateau = state.plateaus.byId[siege?.plateauId];
      if (!await confirmConsequentialMission(consequentialMissionSummary("Commit siege defenders?", plateau?.name || "Threatened plateau", units, "", "This defensive force cannot be changed after commitment."))) return;
      action(() => client.mutation(refs.commitSiegeDefenders, {
        siegeId,
        units,
      }));
    });
  });
  document.querySelectorAll(".siege-defense-panel").forEach((panel) => bindQuantityControls(panel));
  document.querySelectorAll("[data-reinforce-siege]").forEach((button) => button.addEventListener("click", () => {
    const siegeId = button.dataset.reinforceSiege;
    const units = emptyUnits();
    document.querySelectorAll('[data-siege-reinforcement-unit][data-siege-id="' + siegeId + '"]').forEach(input => { units[input.dataset.unit] = Math.max(0, Math.floor(Number(input.value) || 0)); });
    action(() => client.mutation(refs.reinforcePlayerSiege, { siegeId, units }));
  }));
  document.querySelectorAll("[data-begin-siege-battle]").forEach((button) => button.addEventListener("click", async () => {
    const siegeId = button.dataset.beginSiegeBattle;
    if (!await confirmConsequentialMission({ title: button.textContent + "?", html: '<span>Combat will resolve immediately using all forces that have arrived.</span><span>Traveling reinforcements return home and pending investigations are refunded.</span>' })) return;
    action(() => client.mutation(refs.beginSiegeBattle, { siegeId }));
  }));
  document.querySelectorAll("[data-investigate-siege]").forEach((button) => button.addEventListener("click", async () => {
    const siegeId = button.dataset.investigateSiege;
    const operatives = { informant: 0, spy: 0, ghostblood: 0 };
    document.querySelectorAll('[data-siege-operative][data-siege-id="' + siegeId + '"]').forEach(input => { operatives[input.dataset.tier] = Math.max(0, Math.floor(Number(input.value) || 0)); });
    if (!await confirmConsequentialMission({ title: "Launch Siege Investigation?", html: '<span>50 Military Intel will be consumed.</span><span>Failure or partial success can permanently kill operatives.</span>' })) return;
    action(() => client.mutation(refs.launchSiegeInvestigation, { siegeId, operatives }));
  }));
  document.querySelectorAll("[data-siege-defense-unit]").forEach((input) => {
    input.addEventListener("input", () => {
      lastSelections.siegeDefenders = lastSelections.siegeDefenders || {};
      lastSelections.siegeDefenders[input.dataset.siegeId + ":" + input.dataset.unit] = input.value;
      renderSiegeDefenseOutlook(input.dataset.siegeId);
    });
  });
  urgent.forEach((siege) => renderSiegeDefenseOutlook(siege.id));
  document.querySelectorAll("[data-set-emergency-defense]").forEach((button) => {
    button.addEventListener("click", () => {
      const siegeId = button.dataset.setEmergencyDefense;
      const input = document.querySelector('[data-emergency-defense-range="' + siegeId + '"]');
      const percent = Math.max(0, Math.floor(Number(input?.value) || 0));
      action(() => client.mutation(refs.setEmergencyDefense, { siegeId, percent }));
    });
  });
  document.querySelectorAll("[data-emergency-defense-range]").forEach((input) => {
    input.addEventListener("input", () => renderEmergencyDefensePreview(input.dataset.siegeId));
    renderEmergencyDefensePreview(input.dataset.siegeId);
  });
}

function renderPlateauBonusSummary() {
  const container = $("plateau-bonus-summary");
  if (!container) return;
  const counts = Object.fromEntries(["sphere", "bridged", "ancient", "gemheart"].map((type) => [type, state.plateaus.mine.filter((plateau) => plateau.type === type || (type === "ancient" && plateau.type === "ancient_ruins")).length]));
  const gemheart = state.plateaus.mine.find((plateau) => plateau.gemheartProgress);
  container.innerHTML = pulseItem("Sphere income", modifierLabel(state.me.plateauBonuses.sphereIncomeBonusPercent, "+")) + pulseItem("Travel time", modifierLabel(state.me.plateauBonuses.bridgedTravelReductionPercent, "−")) + pulseItem("Provision capacity", modifierLabel(state.me.provisions.largeBonusPercent, "+")) + pulseItem("Ancient sites", number(counts.ancient)) + (gemheart ? countdownPulseItem("Next Gemheart", gemheart.gemheartProgress.nextGemheartAt) : pulseItem("Gemheart sites", number(counts.gemheart)));
}

function renderGroupedHoldings() {
  const container = $("owned-plateaus");
  if (!state.plateaus.mine.length) { container.innerHTML = '<div class="empty">No owned plateaus yet.</div>'; return; }
  if (!holdingsExpanded) {
    container.innerHTML = state.plateaus.mine.map((plateau) => {
      const threatened = Boolean(plateau.activeSiegeId);
      const timer = plateau.gemheartProgress ? ' · ' + formatCountdownAt(plateau.gemheartProgress.nextGemheartAt) : '';
      return '<details class="compact-completed-row plateau-compact-row ' + (threatened ? 'warning' : '') + '"><summary><span><strong>' + escapeHtml(plateau.name) + '</strong><small>' + escapeHtml(plateau.typeName + ' · ' + plateauBonusLabel(plateau)) + escapeHtml(timer) + '</small></span><span class="status-badge ' + (threatened ? 'blocked' : 'ready') + '">' + (threatened ? 'Threatened' : 'Secure') + '</span></summary><div class="compact-detail"><p>' + escapeHtml(plateauTooltip(plateau)) + '</p>' + (threatened ? '<button type="button" data-route-view="plains" data-route-tab="sieges" data-focus="' + escapeHtml(plateau.activeSiegeId) + '">Respond to siege</button>' : '') + '</div></details>';
    }).join("");
    $("toggle-holdings").textContent = "Expanded cards";
    $("toggle-holdings").setAttribute("aria-expanded", "false");
    bindRouteControls(container);
    return;
  }
  const groups = [
    ["sphere", "Sphere Plateaus"],
    ["bridged", "Bridged Plateaus"],
    ["ancient", "Ancient Plateaus"],
    ["gemheart", "Gemheart Plateaus"],
  ];
  container.innerHTML = groups.map(([type, label]) => {
    const plateaus = state.plateaus.mine.filter((plateau) => plateau.type === type || (type === "ancient" && plateau.type === "ancient_ruins"));
    if (!plateaus.length) return "";
    return '<section class="plateau-group"><h3>' + label + ' <span>' + number(plateaus.length) + '</span></h3><div class="plateau-card-grid">' + plateaus.map(plateauCard).join("") + '</div></section>';
  }).join("");
  container.classList.remove("hidden");
  $("toggle-holdings").textContent = "Compact rows";
  $("toggle-holdings").setAttribute("aria-expanded", String(holdingsExpanded));
}

function plateauCard(plateau) {
  const attributes = plateauAttributes(plateau).join(", ");
  const underSiege = Boolean(plateau.activeSiegeId);
  const status = underSiege ? '<small class="warning-text">Under siege</small>' : "";
  const timer = plateau.gemheartProgress
    ? '<small data-gemheart-at="' + plateau.gemheartProgress.nextGemheartAt + '" data-countdown-prefix="Next Gemheart: ">Next Gemheart: ' + formatCountdownAt(plateau.gemheartProgress.nextGemheartAt) + '</small>'
    : "";
  const origin = plateau.origin === "home" ? '<small>Home Plateau</small>' : "";
  const reclamation = plateau.parshendiReclamationCount > 0 ? '<small>Parshendi Reclamations: ' + number(plateau.parshendiReclamationCount) + ' · Neutral Defense +' + number(plateau.parshendiReclamationCount * 10) + '%</small>' : '';
  return '<article class="plateau-holding-card ' + (underSiege ? "warning" : "") + '" title="' + plateauTooltip(plateau) + '"><strong>' + escapeHtml(plateau.name) + '</strong><span>' + escapeHtml(plateau.typeName) + '</span>' + origin + '<small>' + escapeHtml(attributes) + '</small><small>' + escapeHtml(plateauBonusLabel(plateau)) + '</small>' + reclamation + timer + status + '</article>';
}

function siegeCard(siege) {
  const plateau = state.plateaus.byId[siege.plateauId];
  const plateauName = plateau?.name || siege.plateauName || "Unknown plateau";
  const remaining = Math.max(0, Math.ceil((siege.resolveAt - Date.now()) / 60000));
  const isAttacker = siege.attackerId === state.me.id;
  const isDefender = siege.defenderId === state.me.id;
  const title = siege.targetType === "parshendi_retaliation"
    ? "Parshendi retaliation against " + escapeHtml(siege.defenderName)
    : siege.targetType === "player"
      ? escapeHtml(siege.attackerName) + " vs " + escapeHtml(siege.defenderName)
      : escapeHtml(siege.attackerName) + " vs Parshendi";
  const attackerText = isAttacker
    ? "Your attack power " + formatStat(siege.attackerPower)
    : "Attacker force " + formatIntelValue(siege.attackerIntel);
  const committedText = siege.targetType === "player" || siege.targetType === "parshendi_retaliation"
    ? isDefender
      ? (siege.defenderCommittedAt ? "Your defenders are committed" : "No defenders committed yet")
      : "Defensive response unknown"
    : "Neutral expedition";
  const defensePower = siegeDefensePower(siege, plateau);
  const finalDefense = siegeFinalDefense(siege, plateau, siege.emergencyDefensePercent);
  const defenseText = isDefender
    ? "Committed defense " + formatStat(defensePower) + ", Emergency +" + number(siege.emergencyDefensePercent) + "%, Final " + formatStat(finalDefense)
    : siege.targetType === "player" || siege.targetType === "parshendi_retaliation"
      ? "Defenses unknown"
      : "Parshendi hold " + neutralDefenseLabel(plateau?.neutralDefenseRemaining || 0);
  const defenderPanel = isDefender && (siege.targetType === "player" || siege.targetType === "parshendi_retaliation") ? siegeDefenderPanel(siege, plateau) : "";
  const v2Panel = siege.siegeVersion >= 2 && siege.targetType === "player" ? siegeV2Panel(siege) : "";
  const conclaveText = isAttacker && siege.ardentiaConclave ? ' Ardentia Scout Conclave attached.' : '';
  return '<article class="list-item raid-item siege-card" data-entity-id="' + escapeHtml(siege.id) + '"><strong>' + title + '</strong><span>' + escapeHtml(plateauName) + '</span><small>' + attackerText + '. ' + committedText + '. ' + defenseText + '.' + conclaveText + ' Resolves in <span data-local-countdown-at="' + Number(siege.resolveAt) + '">' + formatDuration(remaining) + '</span>.</small>' + defenderPanel + v2Panel + '</article>';
}

function siegeV2Panel(siege) {
  const now = Date.now();
  const encircling = now < Number(siege.encircleEndsAt || 0);
  const phase = encircling ? 'Encirclement ends in <span data-local-countdown-at="' + Number(siege.encircleEndsAt) + '">' + formatCountdownAt(siege.encircleEndsAt) + '</span>' : 'Active Siege · deadline <span data-local-countdown-at="' + Number(siege.resolveAt) + '">' + formatCountdownAt(siege.resolveAt) + '</span>';
  const battleLabel = siege.role === "defender" ? "Sally Forth" : "Launch Assault";
  const battle = !encircling ? '<button type="button" data-begin-siege-battle="' + siege.id + '">' + battleLabel + '</button>' : '';
  const reinforcement = !encircling ? '<details><summary>Send reinforcements</summary><div class="unit-input-grid siege-defense-grid">' + siegeActionUnitInputs(siege.id) + '</div><button type="button" data-reinforce-siege="' + siege.id + '">Dispatch reinforcements</button></details>' : '';
  const pending = (siege.investigations || []).find((entry) => entry.status === "pending");
  const report = [...(siege.investigations || [])].reverse().find((entry) => entry.report);
  const investigation = pending
    ? '<small>Siege Investigation resolves in <span data-local-countdown-at="' + Number(pending.resolveAt) + '">' + formatCountdownAt(pending.resolveAt) + '</span>.</small>'
    : '<details><summary>Siege Investigation · 50 Military Intel</summary><div class="operative-input-grid">' + siegeOperativeInputs(siege.id) + '</div><button type="button" data-investigate-siege="' + siege.id + '"' + (siege.militaryIntel < 50 ? ' disabled' : '') + '>Investigate enemy force</button></details>';
  const reportText = report ? '<small><strong>' + escapeHtml(String(report.outcome || "Report")) + ':</strong> ' + escapeHtml(JSON.stringify(report.report)) + '</small>' : '';
  const inbound = (siege.reinforcements || []).map(row => '<small>Reinforcements arrive <span data-local-countdown-at="' + Number(row.arriveAt) + '">' + formatCountdownAt(row.arriveAt) + '</span>' + (row.power !== undefined ? ' · Power ' + formatStat(row.power) : '') + '.</small>').join('');
  return '<div class="siege-defense-panel"><strong>' + phase + '</strong><small>Military Intel against this rival: ' + number(siege.militaryIntel) + '/100.</small>' + inbound + reinforcement + investigation + reportText + battle + '</div>';
}

function siegeActionUnitInputs(siegeId) {
  return Object.entries(state.config.unlockedUnits).map(([key, unit]) => '<div class="unit-input mission-unit-input"><strong>' + escapeHtml(unit.name) + '</strong>' + quantityControlMarkup('data-siege-reinforcement-unit data-siege-id="' + siegeId + '" data-unit="' + key + '"', '0', state.me.availableUnits[key] || 0, { half: true, max: true }) + '</div>').join('');
}

function siegeOperativeInputs(siegeId) {
  return Object.entries(state.espionage?.rules?.operatives || {}).map(([tier, rule]) => '<label>' + escapeHtml(rule.name) + '<input type="number" min="0" max="' + number(state.espionage?.available?.[tier] || 0) + '" value="0" data-siege-operative data-siege-id="' + siegeId + '" data-tier="' + tier + '"></label>').join('');
}

function siegeDefenderPanel(siege, plateau) {
  const commitPanel = siege.defenderCommittedAt
    ? '<div class="siege-defense-note">Defending army locked: ' + escapeHtml(unitSummary(siege.defenderUnits, state.config.units)) + '.</div>'
    : '<div class="siege-defense-panel"><strong>Commit defenders</strong><div class="unit-input-grid siege-defense-grid">' + siegeDefenderUnitInputs(siege) + '</div><div class="attack-outlook" data-siege-defense-outlook="' + siege.id + '"></div><button type="button" data-commit-siege-defenders="' + siege.id + '">Commit defending army</button></div>';
  const currentPercent = Math.max(0, Number(siege.emergencyDefensePercent || 0));
  const storedTarget = Number(lastSelections.emergencyDefense?.[siege.id]);
  const targetPercent = Number.isFinite(storedTarget) && storedTarget >= currentPercent ? storedTarget : currentPercent;
  const basePower = siegeDefensePower(siege, plateau);
  const currentFinal = siegeFinalDefense(siege, plateau, currentPercent);
  return commitPanel +
    '<div class="siege-defense-panel emergency-defense-panel">' +
    '<strong>Emergency Defenses</strong>' +
    '<small>Temporary bonus for this siege only. It multiplies your committed defending army, so no defenders still means 0 defense.</small>' +
    '<label class="slider-row"><span>Target bonus <b data-emergency-defense-percent="' + siege.id + '">' + number(targetPercent) + '%</b></span><input data-emergency-defense-range="' + siege.id + '" data-siege-id="' + siege.id + '" type="range" min="' + currentPercent + '" max="100" step="1" value="' + targetPercent + '"></label>' +
    '<div class="siege-defense-preview" data-emergency-defense-preview="' + siege.id + '">' +
    '<span>Defending Army Power <strong>' + formatStat(basePower) + '</strong></span>' +
    '<span>Current Effective Defense <strong>' + formatStat(currentFinal) + '</strong></span>' +
    '<span>Sphere Cost <strong>0</strong></span>' +
    '</div>' +
    '<button type="button" data-set-emergency-defense="' + siege.id + '">Prepare Emergency Defenses</button>' +
    '</div>';
}

function siegeDefenderUnitInputs(siege) {
  return Object.entries(state.config.unlockedUnits).map(([key, unit]) => {
    const available = state.me.availableUnits[key] || 0;
    const stored = lastSelections.siegeDefenders?.[siege.id + ":" + key];
    const existing = stored ?? "0";
    return '<div class="unit-input mission-unit-input"><div class="mission-unit-heading"><strong>' + escapeHtml(unit.name) + '</strong><small>Available ' + number(available) + ' · Power ' + formatStat(unit.power) + ' · Speed ' + signedStat(unit.speed) + ' · Plunder ' + formatStat(unit.plunder || 0) + ' · Survive ' + signedStat(unit.survivability) + '</small></div>' + quantityControlMarkup('data-siege-defense-unit data-siege-id="' + siege.id + '" data-unit="' + key + '" aria-label="' + escapeHtml(unit.name) + ' defenders"', existing, available, { half: true, max: true }) + '</div>';
  }).join("");
}

function readSiegeDefenderUnits(siegeId) {
  const units = emptyUnits();
  document.querySelectorAll('[data-siege-defense-unit][data-siege-id="' + siegeId + '"]').forEach((input) => {
    units[input.dataset.unit] = Math.max(0, Math.floor(Number(input.value) || 0));
  });
  return units;
}

function renderEmergencyDefensePreview(siegeId) {
  const siege = state?.plateaus?.sieges?.find((entry) => entry.id === siegeId);
  const preview = document.querySelector('[data-emergency-defense-preview="' + siegeId + '"]');
  const input = document.querySelector('[data-emergency-defense-range="' + siegeId + '"]');
  const label = document.querySelector('[data-emergency-defense-percent="' + siegeId + '"]');
  if (!siege || !preview || !input) return;
  const plateau = state.plateaus.byId[siege.plateauId];
  const currentPercent = Math.max(0, Number(siege.emergencyDefensePercent || 0));
  const targetPercent = Math.max(currentPercent, Math.min(100, Math.floor(Number(input.value) || 0)));
  if (label) label.textContent = number(targetPercent) + "%";
  lastSelections.emergencyDefense = lastSelections.emergencyDefense || {};
  lastSelections.emergencyDefense[siegeId] = String(targetPercent);
  const basePower = siegeDefensePower(siege, plateau);
  const finalDefense = siegeFinalDefense(siege, plateau, targetPercent);
  const cost = emergencyDefenseIncrementalCost(currentPercent, targetPercent);
  preview.innerHTML = '<span>Defending Army Power <strong>' + formatStat(basePower) + '</strong></span>' +
    '<span>Final Effective Defense <strong>' + formatStat(finalDefense) + '</strong></span>' +
    '<span>Sphere Cost <strong>' + number(cost) + '</strong></span>';
  renderSiegeDefenseOutlook(siegeId);
}

function raidListMarkup(raids, emptyText) {
  return raids.length ? raids.map((raid) => {
    const arrival = new Date(raid.arrivalAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const remaining = Math.max(0, Math.ceil((raid.arrivalAt - Date.now()) / 60000));
    const direction = raid.attackerId === state.me.id ? "Outgoing" : raid.targetId === state.me.id ? "Incoming" : "Observed";
    const isMine = raid.attackerId === state.me.id;
    const prize = raid.targetType === "parshendi_spheres"
      ? (raid.rewardIntel?.label || "Estimated") + " sphere loot"
      : raid.targetType === "deep_plains"
        ? plateauRunLootLabel(raid.rewardSpheres || 0) + " sphere loot"
      : "land pressure";
    const force = isMine
      ? escapeHtml(raid.unitSummary) + ' for ' + prize
      : 'Force appears ' + operationPowerLabel(raid.power) + ' with ' + operationSpeedLabel(raid.speed) + ' pace';
    const details = isMine
      ? 'Power ' + formatStat(raid.power) + ', Speed ' + formatStat(raid.speed) + ', travel ' + formatDuration(raid.travelMinutes) + '.'
      : 'Estimated strength ' + operationPowerLabel(raid.power) + ', travel ' + formatDuration(raid.travelMinutes) + '.';
    const defenseMarkup = raidDefenseMarkup(raid.defenseIntel);
    const activityLabel = direction === "Outgoing" ? "My Raid" : "World Raid";
    return '<article class="list-item raid-item ' + direction.toLowerCase() + '"><strong>' + activityLabel + ':</strong> ' + escapeHtml(raid.attackerName) + ' to <strong>' + escapeHtml(raid.targetName) + '</strong><span>' + force + '</span>' + defenseMarkup + '<small>' + details + ' Resolves ' + arrival + ' (<span data-local-countdown-at="' + Number(raid.arrivalAt) + '">' + formatDuration(remaining) + '</span> left).</small></article>';
  }).join("") : '<div class="empty">' + emptyText + '</div>';
}

function renderPlateau() {
  const status = $("plateau-status");
  const participants = $("plateau-participants");
  if (!status || !participants) return;
  const run = state.plateauRun;
  if (!run) {
    loadedPlateauCommitmentId = null;
    const next = nextPlateauRunOpening();
    status.innerHTML = '<div class="plateau-card schedule-card"><strong>Next Plateau Run</strong><span>' + escapeHtml(next.label) + '</span><small>Opens in ' + formatDuration(next.minutes) + '. Daily schedule: ' + plateauRunSchedule().map((entry) => entry.label).join(" · ") + ' Mountain.</small></div>';
    participants.innerHTML = '<div class="empty">No committed warcamps.</div>';
    $("plateau-run-commit-panel").classList.add("hidden");
    $("plateau-run-roster-panel").classList.add("hidden");
    return;
  }
  $("plateau-run-commit-panel").classList.remove("hidden");
  $("plateau-run-roster-panel").classList.remove("hidden");
  const remaining = Math.max(0, Math.ceil((run.joinUntil - Date.now()) / 60000));
  const myCommitment = run.participants.find((entry) => entry.playerId === state.me.id) || null;
  if (myCommitment && loadedPlateauCommitmentId !== myCommitment.id) {
    lastSelections.attackUnits.plateau = { ...myCommitment.units };
    loadedPlateauCommitmentId = myCommitment.id;
    $("plateau-run-units").querySelectorAll("input[data-unit]").forEach((input) => {
      input.value = String(Number(myCommitment.units?.[input.dataset.unit] || 0));
    });
    renderRaidPreviews();
  } else if (!myCommitment) {
    loadedPlateauCommitmentId = null;
  }
  $("plateau-run-submit").textContent = myCommitment ? "Update commitment" : "Commit to plateau run";
  $("cancel-plateau-commitment").classList.toggle("hidden", !myCommitment);
  status.innerHTML = '<div class="plateau-card"><strong>Join window open</strong><span><b data-local-countdown-at="' + Number(run.joinUntil) + '">' + formatDuration(remaining) + '</b> left</span><small>Difficulty ' + plateauRunDifficultyLabel(run.difficultyPower) + '. Loot: ' + number(run.gemheartReward) + ' Gemheart and a ' + plateauRunLootLabel(run.spherePool) + ' sphere pool.</small></div>';
  participants.innerHTML = run.participants.length ? run.participants.map((entry) => {
    const bonus = entry.joinOrderSpeedBonus ? " +" + Math.round(entry.joinOrderSpeedBonus * 100) + "% join speed" : "";
    const isMine = entry.playerId === state.me.id;
    const forceText = isMine
      ? escapeHtml(entry.unitSummary)
      : "Committed force appears " + operationPowerLabel(entry.power);
    const detailText = isMine
      ? "Power " + formatStat(entry.power) + ", speed " + formatStat(entry.speed) + ", speed score " + formatStat(entry.speedScore) + (entry.travelMinutes ? ", travel " + formatDuration(entry.travelMinutes) : "")
      : "Estimated strength " + operationPowerLabel(entry.power) + ", pace " + operationSpeedLabel(entry.speedScore);
    return '<article class="list-item"><strong>' + escapeHtml(entry.playerName) + '</strong><span>' + forceText + '</span><small>' + detailText + bonus + ', joined #' + entry.joinOrder + '.</small></article>';
  }).join("") : '<div class="empty">No committed warcamps yet.</div>';
}

function plateauRunSchedule() {
  return state?.config?.plateauRunSchedule || [
    { hour: 9, minute: 0, label: "9 AM" },
    { hour: 12, minute: 0, label: "Noon" },
    { hour: 20, minute: 0, label: "8 PM" },
  ];
}

function nextPlateauRunOpening() {
  const now = new Date();
  const mountainParts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(now);
  const value = (type) => Number(mountainParts.find((part) => part.type === type)?.value || 0);
  const currentMinutes = value("hour") * 60 + value("minute");
  const schedule = plateauRunSchedule();
  const today = schedule.find((entry) => entry.hour * 60 + (entry.minute || 0) > currentMinutes);
  const target = today || schedule[0];
  const targetMinutes = target.hour * 60 + (target.minute || 0) + (today ? 0 : 24 * 60);
  return { label: (today ? "Today at " : "Tomorrow at ") + target.label + " Mountain", minutes: targetMinutes - currentMinutes };
}

function renderInboxBadge() {
  const badge = $("inbox-badge");
  if (!badge) return;
  const count = Number(state.unreadCount || 0);
  badge.textContent = count;
  badge.classList.toggle("hidden", count < 1);
}

function renderSiegeDefenseOutlook(siegeId) {
  const preview = document.querySelector('[data-siege-defense-outlook="' + siegeId + '"]');
  const siege = state?.plateaus?.sieges?.find((entry) => entry.id === siegeId);
  if (!preview || !siege) return;
  const units = readSiegeDefenderUnits(siegeId);
  const stats = raidStats(units, "siegeDefense");
  const plateau = state.plateaus.byId[siege.plateauId];
  const highgroundMultiplier = plateau?.highground ? 1 + plateauRuleValue("highgroundDefenseBonus", 0.2) : 1;
  const plannedEmergency = Number(document.querySelector('[data-emergency-defense-range="' + siegeId + '"]')?.value ?? siege.emergencyDefensePercent ?? 0);
  const emergencyMultiplier = 1 + plannedEmergency / 100;
  const effectiveDefense = stats.power * highgroundMultiplier * emergencyMultiplier;
  preview.innerHTML = '<div class="outlook-heading"><span>Mission outlook</span><strong>' + escapeHtml(plateau?.name || "Siege defense") + '</strong></div><div class="outlook-grid">' +
    outlookCell("Power", formatStat(stats.power), powerBreakdown(units, stats)) +
    outlookCell("Effective defense", formatStat(effectiveDefense), "Army Power " + formatStat(stats.power) + " × terrain " + formatStat(highgroundMultiplier) + " × Emergency Defenses " + formatStat(emergencyMultiplier)) +
    outlookCell("Survive", signedStat(stats.survivability), survivabilityBreakdown(units, stats)) +
    outlookCell("Speed", signedStat(stats.speed), speedBreakdown(units, stats, travelMinutes(stats.speed, false))) +
    outlookCell("Plunder", number(stats.plunder), plunderBreakdown(units, stats)) +
    '</div>';
}

function routeForMessage(message) {
  if (message.destinationView) {
    const route = normalizeRoute({
      view: message.destinationView,
      tab: message.destinationTab,
      focus: message.entityId,
      kingdom: message.kingdomId,
      category: message.intelligenceCategory,
    });
    return route;
  }
  const subject = String(message.subject || "").toLowerCase();
  if (subject.includes("plateau run") || subject.includes("gemheart claimed")) return { view: "plains", tab: "plateau-runs" };
  if (subject.includes("siege") || subject.includes("plateau lost") || subject.includes("retaliation")) return { view: "plains", tab: "sieges" };
  if (subject.includes("raid")) return { view: "plains", tab: "raids" };
  if (subject.includes("investigation") || subject.includes("espionage")) return { view: "intelligence", tab: "operations" };
  if (subject.includes("research") || subject.includes("ardent")) return { view: "research", tab: "current" };
  if (subject.includes("hostility")) return { view: "home", focus: "home-hostility" };
  return null;
}

function renderInbox() {
  const list = $("inbox-list");
  if (!list) return;
  const expandedMessageIds = new Set(
    [...list.querySelectorAll("details[open][data-message-id]")].map((details) => details.dataset.messageId),
  );
  const inbox = (state.inbox || []).filter((message) => inboxFilter === "all" || (inboxFilter === "players" ? message.kind === "player" : message.kind !== "player")).sort((a, b) => Number(a.read) - Number(b.read) || b.at - a.at);
  $("toggle-compose").classList.toggle("secondary", inboxFilter !== "players");
  list.innerHTML = inbox.length ? inbox.map((message) => {
    const from = message.fromPlayerId ? playerName(message.fromPlayerId) : "System";
    const readClass = message.read ? "read" : "unread";
    const category = message.fromPlayerId ? "Player" : "Report";
    const preview = message.text.length > 110 ? message.text.slice(0, 107) + "…" : message.text;
    const route = routeForMessage(message);
    const action = route ? '<button type="button" class="message-action" data-message-action="' + message.id + '">Open where this happened</button>' : '';
    return '<details class="list-item message-item ' + readClass + '" data-message-id="' + message.id + '"' + (message.read ? '' : ' data-unread="true"') + '><summary><div><span class="event-kind">' + category + '</span><strong>' + escapeHtml(message.subject) + '</strong><small>' + escapeHtml(preview) + '</small></div><time>' + relativeTime(message.at) + '</time></summary><div class="message-body"><p>' + escapeHtml(message.text) + '</p><small>From ' + escapeHtml(from) + ' · ' + new Date(message.at).toLocaleString() + '</small>' + action + '</div></details>';
  }).join("") : '<div class="empty">No messages yet.</div>';
  list.querySelectorAll("details[data-message-id]").forEach((details) => {
    if (expandedMessageIds.has(details.dataset.messageId)) details.open = true;
  });
  list.querySelectorAll("[data-message-action]").forEach((button) => button.addEventListener("click", (event) => {
    event.preventDefault();
    const message = state.inbox.find((entry) => String(entry.id) === button.dataset.messageAction);
    const route = message ? routeForMessage(message) : null;
    if (route) showRoute(route);
  }));
  list.querySelectorAll("details[data-unread='true']").forEach((details) => details.addEventListener("toggle", async () => {
    if (!details.open) return;
    details.removeAttribute("data-unread");
    details.classList.remove("unread");
    details.classList.add("read");

    const message = state.inbox.find((entry) => entry.id === details.dataset.messageId);
    const wasUnread = Boolean(message && !message.read);
    if (wasUnread) {
      message.read = true;
      state.unreadCount = Math.max(0, Number(state.unreadCount || 0) - 1);
      renderInboxBadge();
    }

    try {
      await client.mutation(refs.markMessageRead, { messageId: details.dataset.messageId });
    } catch (error) {
      details.setAttribute("data-unread", "true");
      details.classList.remove("read");
      details.classList.add("unread");
      if (wasUnread) {
        message.read = false;
        state.unreadCount = Number(state.unreadCount || 0) + 1;
      }
      renderInboxBadge();
      alert(friendlyError(error));
    }
  }, { once: true }));
}

function notificationRelativeTime(at) {
  const minutes = Math.max(0, Math.floor((Date.now() - Number(at)) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return minutes + "m ago";
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + "h ago";
  return Math.floor(hours / 24) + "d ago";
}

function renderNotifications() {
  const badge = $("notification-badge");
  const count = Number(state.notificationUnreadCount || 0);
  if (badge) { badge.textContent = count > 99 ? "99+" : String(count); badge.classList.toggle("hidden", count < 1); }
  if (navigator.setAppBadge) count > 0 ? navigator.setAppBadge(count).catch(() => {}) : navigator.clearAppBadge?.().catch(() => {});
  const list = $("notification-list");
  if (list) {
    const activeAlerts = state.notifications.filter((item) => !item.readAt).slice(0, 8);
    list.innerHTML = activeAlerts.length ? activeAlerts.map((item) =>
      `<button type="button" class="notification-item ${item.readAt ? "" : "unread"}" data-notification-id="${item._id}" data-notification-view="${escapeHtml(item.destinationView)}"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.body)}</span><small>${escapeHtml(item.category.replace("_", " "))} · ${notificationRelativeTime(item.createdAt)}</small></button>`
    ).join("") : '<div class="empty">No active alerts.</div>';
    list.querySelectorAll("[data-notification-id]").forEach((button) => button.addEventListener("click", async () => {
      const item = state.notifications.find((entry) => String(entry._id) === button.dataset.notificationId);
      if (item && !item.readAt) await client.mutation(refs.markNotificationRead, { notificationId: item._id }).catch(() => null);
      setNotificationPanelOpen(false);
      showRoute({ view: item?.destinationView || "home", tab: item?.destinationTab, focus: item?.entityId, kingdom: item?.kingdomId, category: item?.intelligenceCategory });
      await load();
    }));
  }
  document.querySelectorAll("[data-notification-preference]").forEach((input) => { input.checked = Boolean(state.notificationPreferences[input.dataset.notificationPreference]); });
  updatePushControls();
}

async function currentPushSubscription() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return null;
  const registration = await navigator.serviceWorker.ready;
  return await registration.pushManager.getSubscription();
}

function urlBase64ToUint8Array(value) {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const raw = atob((value + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((character) => character.charCodeAt(0)));
}

async function enablePushNotifications() {
  if (!state.vapidPublicKey) throw new Error("Push delivery is not configured on the server yet.");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Notification permission was not granted.");
  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(state.vapidPublicKey) });
  const json = subscription.toJSON();
  await client.mutation(refs.registerPushDevice, {
    endpoint: subscription.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth,
    deviceLabel: `${navigator.platform || "Device"} · ${navigator.userAgent.includes("Mobile") ? "Mobile" : "Browser"}`,
    soundEnabled: $("notification-sound").checked,
  });
}

async function disablePushNotifications() {
  const subscription = await currentPushSubscription();
  if (!subscription) return;
  await client.mutation(refs.removePushDevice, { endpoint: subscription.endpoint });
  await subscription.unsubscribe();
}

async function updatePushControls() {
  const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const subscription = supported ? await currentPushSubscription().catch(() => null) : null;
  $("enable-push")?.classList.toggle("hidden", !supported || Boolean(subscription));
  $("disable-push")?.classList.toggle("hidden", !subscription);
  const support = $("notification-support");
  if (support) support.textContent = !supported ? "This browser does not support background web notifications." : subscription ? "Background notifications are enabled on this device." : /iPad|iPhone|iPod/.test(navigator.userAgent) && !navigator.standalone ? "On iPhone or iPad, add the game to your Home Screen before enabling notifications." : state.vapidPublicKey ? "Enable this device to receive alerts while the game is closed." : "Push keys must be configured by the game administrator before devices can be enabled.";
  if (subscription) {
    const device = state.notificationDevices.find((entry) => entry.endpoint === subscription.endpoint);
    if (device) $("notification-sound").checked = device.soundEnabled;
  }
  renderFabrialSelectors();
}

function renderFabrialSelectors() {
  const inventory = state.fabrials?.inventory || [];
  const definitions = {
    painrial: "Disposable · 25% casualty protection",
    soulcaster: "Reusable · recovers half of excess Sphere rewards",
    halfShard: "Reusable · 50% casualty protection · may be lost on severe failure",
  };
  const configs = [
    ["sphere-fabrial", true], ["deep-plains-fabrial", true],
    ["neutral-fabrial", false], ["player-fabrial", false],
  ];
  configs.forEach(([id, sphereProducing]) => {
    const select = $(id);
    if (!select) return;
    const wrapper = select.closest(".fabrial-deployment");
    wrapper?.classList.toggle("hidden", inventory.length < 1);
    const previous = lastSelections.fabrials[id] || select.value;
    select.innerHTML = '<option value="">None</option>' + inventory.map((item) => {
      const applicable = sphereProducing || item.kind !== "soulcaster";
      const enabled = applicable && item.available > 0;
      const suffix = !applicable ? " · Not applicable" : item.available < 1 ? " · Unavailable" : " · " + item.available + " available";
      return '<option value="' + item.kind + '"' + (enabled ? '' : ' disabled') + ' title="' + escapeHtml(definitions[item.kind]) + '">' + escapeHtml(item.name + ' — ' + definitions[item.kind] + suffix) + '</option>';
    }).join('');
    if ([...select.options].some((option) => option.value === previous && !option.disabled)) select.value = previous;
    select.onchange = () => { lastSelections.fabrials[id] = select.value; };
  });
}

function renderLog() {
  let currentDay = "";
  const markup = state.log.map((entry) => {
    const date = new Date(entry.at);
    const day = date.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
    const heading = day !== currentDay ? (currentDay = day, '<h3 class="chronicle-day">' + day + '</h3>') : "";
    return heading + '<article class="list-item chronicle-item"><span class="event-kind">' + escapeHtml(eventKindLabel(entry.kind)) + '</span><strong>' + escapeHtml(entry.text) + '</strong><small>' + escapeHtml(entry.gameDate || state.gameDate) + ' · ' + date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) + '</small></article>';
  }).join("");
  $("log").innerHTML = markup || '<div class="empty">No events yet.</div>';
}

function renderOverview() {
  renderCommandBriefing();
  const bonusLines = [
    ["Income", modifierLabel(state.me.plateauBonuses.sphereIncomeBonusPercent, "+")],
    ["Travel time", modifierLabel(state.me.plateauBonuses.bridgedTravelReductionPercent, "−")],
    ["Provision capacity", modifierLabel(state.me.provisions.largeBonusPercent, "+")],
  ];
  const establishedBuildings = Object.values(state.me.buildings || {}).reduce((sum, level) => sum + Math.max(0, Number(level) || 0), 0);
  const kingdomSummary = $("kingdom-summary");
  if (kingdomSummary) kingdomSummary.innerHTML =
    '<button type="button" class="compact-status-row" data-route-view="warcamp" data-route-tab="recruitment"><span><strong>' + number(state.me.totalAvailableUnits) + ' units ready</strong><small>' + formatStat(state.me.power) + ' ready Power · ' + number(sumUnits(state.me.unitsAway)) + ' units away</small></span><span class="status-badge">Recruitment</span></button>' +
    '<button type="button" class="compact-status-row" data-route-view="warcamp" data-route-tab="buildings"><span><strong>' + number(state.me.totalIncomePerDay) + ' Spheres / day</strong><small>' + number(establishedBuildings) + ' established building levels · ' + modifierLabel(state.me.plateauBonuses.sphereIncomeBonusPercent, "+") + ' plateau income</small></span><span class="status-badge">Warcamp</span></button>' +
    '<button type="button" class="compact-status-row" data-route-view="research" data-route-tab="ardents"><span><strong>' + number(state.ardentia?.owned || 0) + ' Scout Conclave' + (Number(state.ardentia?.owned || 0) === 1 ? '' : 's') + '</strong><small>' + number(state.ardentia?.ready || 0) + ' ready · +' + number(state.research?.speed?.conclave || 0) + '% active Research speed</small></span><span class="status-badge">Ardents</span></button>' +
    '<button type="button" class="compact-status-row" data-route-view="home" data-focus="owned-plateaus"><span><strong>' + number(state.plateaus.mine.length) + ' plateaus held</strong><small>' + bonusLines.map(([name, value]) => name + ' ' + value).join(' · ') + '</small></span><span class="status-badge">Territory</span></button>';
  const operations = [];
  if (state.research?.active) operations.push({ label: "Active Research", detail: state.research.active.kind === "project" ? (state.research.rules?.projects?.[state.research.active.project]?.name || "Research") : (state.research.doctrines?.[state.research.active.doctrine]?.name || "Doctrine"), at: state.research.active.projectedCompletionAt || Date.now(), view: "research" });
  state.raids.filter((raid) => raid.attackerId === state.me.id).forEach((raid) => operations.push({ label: "Sphere raid", detail: raid.targetName, at: raid.arrivalAt, view: "raids" }));
  state.plateaus.sieges.filter((siege) => siege.attackerId === state.me.id || siege.defenderId === state.me.id).forEach((siege) => operations.push({ label: siege.defenderId === state.me.id ? "Defending siege" : "Plateau siege", detail: state.plateaus.byId[siege.plateauId]?.name || siege.plateauName || "Plateau", at: siege.resolveAt, view: "plateaus" }));
  (state.espionage?.missions || []).filter((mission) => mission.status === "pending").forEach((mission) => operations.push({ label: mission.operation === "sphere_heist" ? "Sphere Heist" : "Espionage investigation", detail: mission.targetName + " · " + mission.category, at: mission.resolveAt, view: "intelligence" }));
  if (state.plateauRun?.participants.some((entry) => entry.playerId === state.me.id)) operations.push({ label: "Plateau Run", detail: "Warcamp committed", at: state.plateauRun.joinUntil, view: "plateau" });
  operations.sort((a, b) => a.at - b.at);
  $("overview-operations").innerHTML = operations.length ? operations.map((item) => '<button type="button" class="operation-row" data-operation-view="' + item.view + '"><span><strong>' + escapeHtml(item.label) + '</strong><small>' + escapeHtml(item.detail) + '</small></span><b data-local-countdown-at="' + Number(item.at) + '">' + formatDuration(Math.max(0, Math.ceil((item.at - Date.now()) / 60000))) + '</b></button>').join("") : '<div class="empty">No armies are currently committed. Your next move is yours.</div>';
  $("overview-operations").querySelectorAll("[data-operation-view]").forEach((button) => button.addEventListener("click", () => showView(button.dataset.operationView)));
}

function renderCommandBriefing() {
  const panel = $("command-briefing");
  const container = $("command-priorities");
  const priorities = [];
  const urgentSieges = state.plateaus.sieges.filter((siege) => siege.defenderId === state.me.id && !siege.defenderCommittedAt);
  if (urgentSieges.length) priorities.push({ label: "Defensive siege", text: urgentSieges.length + " plateau" + (urgentSieges.length === 1 ? " needs" : "s need") + " defenders", view: "plateaus" });
  if (state.worldPressure?.warning) priorities.push({ label: "Parshendi pressure", text: state.worldPressure.warning.message, view: "plateaus" });
  if (state.plateauRun) priorities.push({ label: "Plateau Run open", text: formatDuration(Math.max(0, Math.ceil((state.plateauRun.joinUntil - Date.now()) / 60000))) + " left to commit", view: "plateau" });
  if (state.research?.unlocked && !state.research?.active) priorities.push({ label: "Research slot empty", text: "Choose the kingdom's next study", view: "research" });
  if (Number(state.unreadCount || 0) > 0) priorities.push({ label: "Unread Spanreeds", text: number(state.unreadCount) + " report" + (state.unreadCount === 1 ? "" : "s") + " waiting", view: "inbox" });
  if (state.me.provisions.used > state.me.provisions.capacity) priorities.push({ label: "Over Provisions", text: "Recruitment is blocked until capacity recovers", view: "buildings" });
  panel.classList.toggle("hidden", priorities.length < 1);
  container.innerHTML = priorities.map((item) => '<button type="button" class="priority-item" data-priority-view="' + item.view + '"><span>' + escapeHtml(item.label) + '</span><strong>' + escapeHtml(item.text) + '</strong></button>').join("");
  container.querySelectorAll("[data-priority-view]").forEach((button) => button.addEventListener("click", () => showView(button.dataset.priorityView)));
}

function pulseItem(label, value, title = "", expandable = false) {
  return '<article class="pulse-item' + (expandable ? ' expandable' : '') + '"' + (title ? ' title="' + escapeHtml(title) + '" tabindex="0"' : '') + '><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(value) + '</strong></article>';
}

function renderHostility() {
  const pressure = state.worldPressure || { hostility: 0, state: { label: "Quiet" }, progressPercent: 0 };
  const hostility = Number(pressure.hostility || 0);
  const stateLabel = pressure.state?.label || "Quiet";
  if ($("res-hostility")) $("res-hostility").textContent = number(hostility) + " · " + stateLabel;
  $("res-hostility-card")?.classList.toggle("warning", hostility >= 34);
  if ($("hostility-value")) $("hostility-value").textContent = number(hostility) + " / 100 · " + stateLabel;
  const fill = $("hostility-meter-fill");
  if (fill) fill.style.width = Math.max(0, Math.min(100, hostility)) + "%";
  fill?.parentElement?.setAttribute("aria-valuenow", String(hostility));
  const nextState = pressure.nextState?.label
    ? number(Math.max(0, Number(pressure.nextState.min) - hostility)) + " points to " + pressure.nextState.label
    : "Maximum Hostility reached";
  const decay = pressure.nextDecayAt
    ? ' Peaceful decay in <b data-local-countdown-at="' + Number(pressure.nextDecayAt) + '">' + formatDuration(Math.max(0, Math.ceil((pressure.nextDecayAt - Date.now()) / 60000))) + '</b>.'
    : "";
  if ($("hostility-summary")) $("hostility-summary").innerHTML = '<strong>' + escapeHtml(nextState) + '</strong><span>Neutral conquest, raids, Plateau Run victories, and Deep Plains operations raise Hostility.' + decay + '</span>';

  const warning = pressure.warning;
  const warningPanel = $("retaliation-warning-panel");
  warningPanel?.classList.toggle("hidden", !warning);
  const intelPanel = $("retaliation-intelligence-panel");
  intelPanel?.classList.toggle("hidden", !warning);
  if (warning) {
    const details = warning.targetName
      ? ' Likely target: ' + warning.targetName + '. Estimated strength: ' + formatIntelValue(warning.estimatedStrength) + (warning.launchWindowStartAt ? '. Expected launch in ' + formatDuration(Math.max(0, Math.ceil((warning.launchWindowStartAt - Date.now()) / 60000))) + '–' + formatDuration(Math.max(0, Math.ceil((warning.launchWindowEndAt - Date.now()) / 60000))) : '') + '.'
      : '';
    if ($("retaliation-warning")) $("retaliation-warning").innerHTML = '<strong>' + escapeHtml(warning.phase === "launched" ? "Retaliation launched" : "Force gathering") + '</strong><span>' + escapeHtml(warning.message + details) + '</span>';
    if ($("retaliation-intelligence")) $("retaliation-intelligence").innerHTML = '<strong>' + escapeHtml(warning.targetName || "Parshendi movements") + '</strong><p>' + escapeHtml(warning.message + details) + '</p><small>Knowledge supplied by existing Watchtower and Territory Intelligence coverage.</small>';
  }
  $("deep-plains-panel")?.classList.toggle("hidden", hostility < Number(state.config.worldPressure?.rules?.deepPlains?.unlockMinimumHostility || 68));
}

function countdownPulseItem(label, nextAt) {
  return '<article class="pulse-item"><span>' + escapeHtml(label) + '</span><strong data-gemheart-at="' + Number(nextAt) + '">' + formatCountdownAt(nextAt) + '</strong></article>';
}

function pulseBreakdownItem(label, lines) {
  return '<article class="pulse-item"><span>' + escapeHtml(label) + '</span><div class="pulse-lines">' + lines.map(([name, value]) => '<div><small>' + escapeHtml(name) + '</small><strong>' + escapeHtml(value) + '</strong></div>').join("") + '</div></article>';
}

function relativeTime(at) {
  const minutes = Math.max(0, Math.floor((Date.now() - at) / 60000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return minutes + "m ago";
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + "h ago";
  return Math.floor(hours / 24) + "d ago";
}

function eventKindLabel(kind) {
  return ({ territory: "Territory", siege: "Siege", raid: "Raid", plateau_run: "Plateau Run", gemheart: "Gemheart", warcamp: "Warcamp", economy: "Economy" })[kind] || "World";
}

function activeUnitEntries() {
  return orderedActiveUnits(state.config.units);
}

function unitStatsTooltip(unit) {
  return escapeHtml(
    "Provisions: " + number(unit.provisionsCost || 0) + " per unit\n" +
    "Power: " + formatStat(unit.power) + " - " + statTooltip("power") + "\n" +
    "Speed: " + formatStat(unit.speed) + " - " + statTooltip("speed") + "\n" +
    "Plunder: " + formatStat(unit.plunder || 0) + " - " + statTooltip("plunder") + "\n" +
    "Survive: " + signedStat(unit.survivability) + " - " + statTooltip("survivability")
  );
}

function incomeTooltip() {
  const stats = state.me.buildingStats || {};
  const bonusPercent = stats.sphereBonusPercent || state.me.plateauBonuses?.sphereIncomeBonusPercent || 0;
  return [
    number(stats.baseKingdomIncomePerDay || state.config.baseSphereIncomePerGameDay || 0) + "/day - Base Kingdom",
    number(stats.marketIncomePerDay || 0) + "/day - Markets",
    number(stats.sphereBonusIncomePerDay || 0) + "/day - Sphere Plateau bonus (+" + number(bonusPercent) + "%)",
    number(stats.totalIncomePerDay || state.me.totalIncomePerDay || 0) + "/day - Total",
  ].join("\n");
}

function plateauTooltip(plateau) {
  const effects = [];
  if (plateau.origin === "home") effects.push("Home Plateau: created as part of a starting package; it can still be conquered.");
  if (plateau.type === "sphere") effects.push("Sphere Plateau: +10% passive Sphere income, stacking to +30%.");
  if (plateau.type === "bridged" || plateau.type === "training") effects.push("Bridged Plateau: -10% normal Raid and Plateau Run travel time, stacking to -30%.");
  if (plateau.type === "gemheart") effects.push("Grants 1 Gemheart every 12 real hours if held.");
  if (plateau.type === "ancient" || plateau.type === "ancient_ruins") effects.push(Number(state.me.buildings.ardentMonastery || 0) > 0 ? "Ancient Plateau: counts toward visible Research territory requirements and supports scholarship." : "Ancient markings: ??? The surveyors lack an institution capable of interpreting them.");
  if (plateau.highground) effects.push("Highground: +20% defense when this plateau is attacked.");
  if (plateau.large) effects.push("Large: +10% Soulcast Bunker Provisions capacity, stacking to +30%.");
  if (plateau.gemheartProgress) {
    effects.push("Next Gemheart: " + formatCountdownAt(plateau.gemheartProgress.nextGemheartAt) + ".");
  }
  if (!effects.length) effects.push("No special effect yet.");
  return escapeHtml(effects.join("\n"));
}

function plateauAttributes(plateau) {
  const attributes = [];
  if (plateau.highground) attributes.push("Highground");
  if (plateau.large) attributes.push("Large");
  return attributes.length ? attributes : ["Standard"];
}

function plateauBonusLabel(plateau) {
  if (plateau.type === "sphere") return "+10% passive Sphere income";
  if (plateau.type === "bridged" || plateau.type === "training") return "-10% Raid and Plateau Run travel";
  if (plateau.type === "gemheart") return "1 Gemheart every 12 real hours";
  if (plateau.type === "ancient" || plateau.type === "ancient_ruins") return Number(state.me.buildings.ardentMonastery || 0) > 0 ? "Research requirements and scholarship" : "???";
  return "No active bonus";
}

function neutralDefenseLabel(power) {
  const bands = state.config.militaryResistanceBands || [];
  return bands.find((band) => power >= band.min && (band.max === null || power <= band.max))?.label || "Impregnable";
}

function operationPowerLabel(power) {
  return neutralDefenseLabel(power);
}

function operationSpeedLabel(speed) {
  if (speed <= 0) return "burdened";
  if (speed <= 8) return "slow";
  if (speed <= 18) return "steady";
  if (speed <= 35) return "fast";
  return "swift";
}

function formatIntelValue(presentation) {
  if (!presentation) return "Unknown";
  const value = formatDisclosedPower(presentation);
  if (presentation.mode === "estimate") return "about " + value;
  if (presentation.mode === "exact") return value + " (snapshot)";
  return value;
}

function intelLevelName(level) {
  return ["Rumor", "Survey", "Assessment", "Confirmed report", "Operational intelligence", "Active dossier"][Math.max(0, Math.min(5, level))];
}

function intelligenceSourceName(source) {
  return ({ player_raid: "Raid observations", neutral_expedition: "Expedition report", watchtower: "Watchtower", ardent: "Ardent report" })[source] || "Unknown source";
}

function intelligenceReportAge(timestamp) {
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
  if (minutes < 60) return minutes + "m ago";
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + "h ago";
  return Math.floor(hours / 24) + "d ago";
}

function intelligenceTooltip(report) {
  return "Effective intelligence: " + report.effectiveLevel + " — " + intelLevelName(report.effectiveLevel) + "\n" +
    "Your source: " + intelligenceSourceName(report.source) + "\n" +
    "Observed: " + new Date(report.observedAt).toLocaleString() + "\n" +
    "Freshness: " + report.freshness + "\n" +
    "Reports lose one precision level every 6 hours. Opposing counter-intelligence is not disclosed.";
}

function intelMarkers(level) {
  return '<span class="intel-markers" aria-label="Intel level ' + level + ' of 2"><i class="' + (level >= 1 ? 'filled' : '') + '"></i><i class="' + (level >= 2 ? 'filled' : '') + '"></i></span>';
}

function renderKingdomIntelligence() {
  const container = $("kingdom-intelligence-table");
  if (!container) return;
  if (state.kingdomLedger?.loadError) {
    container.innerHTML = '<div class="empty-intelligence error-state"><strong>Kingdom Intelligence is temporarily unavailable.</strong><span>The ledger service could not be reached. Your season data has not been lost; reload after the backend deployment completes.</span></div>';
    return;
  }
  const rows = state.kingdomLedger?.rows || [];
  if (!rows.length) {
    container.innerHTML = '<div class="empty-intelligence"><strong>No active Season Ledger.</strong><span>Kingdom intelligence will appear when the season is initialized.</span></div>';
    return;
  }
  const categoryKeys = ["military", "economy", "research", "territory"];
  container.innerHTML = '<table class="kingdom-intelligence-table"><thead><tr><th>Kingdom</th>' + categoryKeys.map((category) => '<th>' + escapeHtml(category[0].toUpperCase() + category.slice(1)) + '</th>').join("") + '<th>Total</th></tr></thead><tbody>' + rows.map((row) => {
    const cells = categoryKeys.map((category) => {
      const cell = row.cells[category];
      const body = '<strong>' + escapeHtml(cell.presentation.display) + '</strong>' + (row.own && cell.presentation.label ? '<small class="score-quality">' + escapeHtml(cell.presentation.label) + '</small>' : '') + intelMarkers(cell.currentLevel);
      return '<td>' + (row.own ? '<div class="intel-cell own">' + body + '</div>' : '<button type="button" class="intel-cell" data-kingdom-intel-player="' + escapeHtml(row.playerId) + '" data-kingdom-intel-category="' + category + '">' + body + '</button>') + '</td>';
    }).join("");
    const totalBody = '<strong>' + escapeHtml(row.total.display) + '</strong>' + intelMarkers(row.total.currentLevel);
    const total = row.own ? '<div class="intel-cell own">' + totalBody + '</div>' : '<button type="button" class="intel-cell" data-kingdom-intel-player="' + escapeHtml(row.playerId) + '" data-kingdom-intel-category="total">' + totalBody + '</button>';
    return '<tr class="' + (row.own ? 'own-row' : '') + '"><th scope="row">' + escapeHtml(row.kingdomName) + (row.own ? '<small>Your kingdom</small>' : '') + '</th>' + cells + '<td>' + total + '</td></tr>';
  }).join("") + '</tbody></table>';
  container.querySelectorAll("[data-kingdom-intel-player]").forEach((button) => button.addEventListener("click", () => openKingdomIntelDetail(button.dataset.kingdomIntelPlayer, button.dataset.kingdomIntelCategory)));
}

function openKingdomIntelDetail(playerId, category) {
  const row = (state.kingdomLedger?.rows || []).find((entry) => entry.playerId === playerId);
  const dialog = $("kingdom-intel-dialog");
  if (!row || !dialog) return;
  if (category === "total") {
    $("kingdom-intel-dialog-title").textContent = row.kingdomName + " — Total Intelligence";
    $("kingdom-intel-dialog-content").innerHTML = '<div class="intel-detail-grid"><span>Current Intel</span><strong>Level ' + row.total.currentLevel + ' / 2</strong><span>Displayed information</span><strong>' + escapeHtml(row.total.display) + '</strong></div><p class="hint">A numerical Total is shown only when every category has sufficient intelligence. Hidden values are never used to fill arithmetic gaps.</p>';
  } else {
    const cell = row.cells[category];
    if (!cell) return;
    const next = cell.nextDecayAt ? formatDuration(Math.max(0, Math.ceil((cell.nextDecayAt - Date.now()) / 60000))) : "No further decay scheduled";
    const observed = cell.observedAt ? intelligenceReportAge(cell.observedAt) : "Never investigated";
    const timingRows = kingdomIntelTimingRows(category, { freshness: cell.freshness || "Unknown", updated: observed, next })
      .map((entry) => '<span>' + escapeHtml(entry.label) + '</span><strong>' + escapeHtml(entry.value) + '</strong>')
      .join("");
    const discoveries = (cell.discoveries || []).map((fact) => '<article class="bonus-discovery"><strong>Bonus Discovery</strong><p>' + escapeHtml(fact.text) + '</p><small>Observed ' + escapeHtml(new Date(fact.observedAt).toLocaleString()) + '</small></article>').join("");
    $("kingdom-intel-dialog-title").textContent = row.kingdomName + " — " + cell.categoryName + " Intelligence";
    const economyResource = category === "economy" && !row.own ? '<span>Economy Intel</span><strong>' + number(cell.economyIntel || 0) + '/' + number(cell.economyIntelCap || 100) + '</strong>' : '';
    $("kingdom-intel-dialog-content").innerHTML = '<div class="intel-detail-grid"><span>Current Intel</span><strong>Level ' + cell.currentLevel + ' / 2</strong><span>Best achieved</span><strong>Level ' + cell.bestLevel + ' / 2</strong>' + economyResource + '<span>Current information</span><strong>' + escapeHtml(cell.presentation.display) + '</strong>' + timingRows + '<span>Source</span><strong>' + escapeHtml(cell.source) + '</strong></div>' + discoveries + (row.own ? '' : '<button type="button" class="investigate-category" data-investigate-kingdom="' + escapeHtml(row.playerId) + '" data-investigate-category="' + escapeHtml(category) + '">Investigate this category</button>');
    $("kingdom-intel-dialog-content").querySelector("[data-investigate-kingdom]")?.addEventListener("click", (event) => {
      dialog.close();
      showRoute({ view: "intelligence", tab: "operations", kingdom: event.currentTarget.dataset.investigateKingdom, category: event.currentTarget.dataset.investigateCategory });
    });
  }
  if (typeof dialog.showModal === "function") dialog.showModal(); else dialog.setAttribute("open", "");
}

function operativeDraft(group, tier, fallback) {
  const value = lastSelections[group]?.[tier];
  return Math.max(0, Math.floor(Number(value === undefined ? fallback : value) || 0));
}

function selectedEspionageOperatives() {
  const result = { informant: 0, spy: 0, ghostblood: 0 };
  document.querySelectorAll("[data-espionage-mission-tier]").forEach((input) => { result[input.dataset.espionageMissionTier] = Math.max(0, Math.floor(Number(input.value) || 0)); });
  return result;
}

function updateEspionagePreview() {
  const preview = $("espionage-mission-preview");
  if (!preview) return;
  const rules = state.espionage?.rules || {};
  const counts = selectedEspionageOperatives();
  const base = Object.entries(counts).reduce((sum, [tier, count]) => sum + count * Number(rules.operatives?.[tier]?.spyPower || 0), 0);
  const target = (state.espionage?.targets || []).find((entry) => entry.playerId === $("espionage-target")?.value);
  const operation = $("espionage-operation")?.value || "investigation";
  const boost = operation === "sphere_heist" ? 0 : Math.max(0, Math.floor(Number($("espionage-intel-spend")?.value) || 0));
  const selected = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const launch = $("launch-espionage-mission");
  const heistRules = rules.sphereHeist || ESPIONAGE_UI_DEFAULTS.sphereHeist;
  const heistAvailability = sphereHeistAvailability(target?.economyIntel, heistRules.economyIntelCost);
  if (launch) {
    launch.disabled = !espionageMissionAvailability({
      selectedOperatives: selected,
      hasTarget: Boolean(target),
      heistIntelAvailable: operation !== "sphere_heist" || heistAvailability.available,
    }).available;
  }
  if (operation === "sphere_heist") {
    const availability = heistAvailability;
    preview.innerHTML = '<div class="outlook-heading"><span>Sphere Heist outlook</span><strong>' + escapeHtml(target?.name || "Choose a rival") + '</strong></div><div class="outlook-grid">' +
      outlookCell("Selected", number(selected) + " operatives", Object.entries(counts).map(([tier, count]) => number(count) + " " + (rules.operatives?.[tier]?.name || tier)).join("\n")) +
      outlookCell("Spy Power", number(base), "Compared with hidden target Counter-Intelligence at resolution") +
      outlookCell("Economy Intel", number(availability.availableIntel) + " → " + number(availability.remainingIntel), number(availability.requiredIntel) + " is consumed at launch") +
      outlookCell("Potential haul", number(heistRules.minimumHaul) + "–" + number(heistRules.maximumHaul), "5% of the target's current treasury, bounded at resolution") +
      outlookCell("Target treasury", "Hidden", "Sphere Heist does not reveal an unauthorized exact balance") +
      '</div>';
    return;
  }
  preview.innerHTML = '<div class="outlook-heading"><span>Operation outlook</span><strong>' + escapeHtml(target?.name || "Choose a rival") + '</strong></div><div class="outlook-grid">' +
    outlookCell("Selected", number(selected) + " operatives", Object.entries(counts).map(([tier, count]) => number(count) + " " + (rules.operatives?.[tier]?.name || tier)).join("\n")) +
    outlookCell("Spy Power", number(base + boost), number(base) + " from operatives\n+" + number(boost) + " from Intel") +
    outlookCell("Intel spent", number(boost), number(target?.intel || 0) + "/" + number(target?.intelCap || 0) + " rival Intel available") +
    outlookCell("Target Counter-Intel", "Unknown", "An exact rival Counter-Intelligence value is not revealed by the current rules.") +
    '</div>';
}

function renderEspionage() {
  const espionage = state.espionage || {};
  const rules = espionage.rules || { operatives: {}, network: {} };
  const heistRules = rules.sphereHeist || ESPIONAGE_UI_DEFAULTS.sphereHeist;
  const networkLocked = Number(espionage.networkLevel || 0) < 1;
  const status = $("espionage-network-status");
  if (status) status.innerHTML = pulseItem("Ghostblood Network", "Level " + Number(espionage.networkLevel || 0)) + pulseItem("Counter-Intelligence", number(espionage.counterIntelligence || 0)) + pulseItem("Intel capacity", number(rules.network?.currentIntelCap || 0) + " per rival") + pulseItem("Mission boost cap", "+" + number(rules.network?.currentMissionIntelSpendCap || 0));
  $("espionage-network-locked")?.classList.toggle("hidden", !networkLocked);
  const roster = $("espionage-roster");
  if (roster) roster.innerHTML = Object.entries(rules.operatives || {}).map(([tier, rule]) => {
    const unlocked = Number(espionage.networkLevel || 0) >= Number(rule.networkLevel || 0);
    const available = Number(espionage.available?.[tier] || 0), defending = Number(espionage.defending?.[tier] || 0), away = Number(espionage.onMission?.[tier] || 0);
    return '<article class="operative-card"><div class="card-heading"><div><strong>' + escapeHtml(rule.name) + '</strong><span>Requires Ghostblood Network ' + number(rule.networkLevel) + '</span></div><span class="status-badge ' + (unlocked ? 'ready' : 'blocked') + '">' + (unlocked ? number(available) + ' available' : 'Locked') + '</span></div><div class="operative-state-line"><span>Available <b>' + number(available) + '</b></span><span>On Mission <b>' + number(away) + '</b></span><span>Defending <b>' + number(defending) + '</b></span></div><div class="unit-costs"><span><small>Spy Power</small><strong>' + number(rule.spyPower) + '</strong></span><span><small>Provision</small><strong>' + number(rule.provisionsCost) + '</strong></span></div></article>';
  }).join("") || '<div class="empty-intelligence"><strong>Construct a Ghostblood Network.</strong><span>The Network unlocks operatives and investigations.</span></div>';
  const tiers = Object.entries(rules.operatives || {});
  const defenseInputs = $("espionage-defense-inputs");
  if (defenseInputs) defenseInputs.innerHTML = tiers.map(([tier, rule]) => {
    const pool = Number(espionage.available?.[tier] || 0) + Number(espionage.defending?.[tier] || 0);
    return '<div class="operative-input mission-unit-input"><div class="mission-unit-heading"><strong>' + escapeHtml(rule.name) + '</strong><small>' + number(pool) + ' at home · ' + number(rule.spyPower) + ' Spy Power each</small></div>' + quantityControlMarkup('data-espionage-defense-tier="' + tier + '" aria-label="' + escapeHtml(rule.name) + ' defenders"', operativeDraft("espionageDefense", tier, espionage.defending?.[tier] || 0), pool, { half: true, max: true }) + '</div>';
  }).join("");
  const missionInputs = $("espionage-mission-operatives");
  if (missionInputs) missionInputs.innerHTML = tiers.map(([tier, rule]) => '<div class="operative-input mission-unit-input"><div class="mission-unit-heading"><strong>' + escapeHtml(rule.name) + '</strong><small>' + number(espionage.available?.[tier] || 0) + ' available · ' + number(rule.spyPower) + ' Spy Power each</small></div>' + quantityControlMarkup('data-espionage-mission-tier="' + tier + '" aria-label="' + escapeHtml(rule.name) + ' mission quantity"', operativeDraft("espionageMission", tier, 0), Number(espionage.available?.[tier] || 0), { half: true, max: true }) + '</div>').join("");
  bindQuantityControls(defenseInputs);
  bindQuantityControls(missionInputs);
  const targetSelect = $("espionage-target");
  if (targetSelect) {
    targetSelect.innerHTML = (espionage.targets || []).map((target) => '<option value="' + escapeHtml(target.playerId) + '">' + escapeHtml(target.name) + ' · Economy ' + number(target.economyIntel || 0) + '/' + number(target.economyIntelCap || heistRules.economyIntelCap) + ' · Intel ' + number(target.intel) + '/' + number(target.intelCap) + '</option>').join("") || '<option value="">No rival kingdoms</option>';
    if ((espionage.targets || []).some((target) => target.playerId === lastSelections.espionageTarget)) targetSelect.value = lastSelections.espionageTarget;
  }
  const operationSelect = $("espionage-operation");
  if (operationSelect) operationSelect.value = lastSelections.espionageOperation === "sphere_heist" ? "sphere_heist" : "investigation";
  const operation = operationSelect?.value || "investigation";
  const isHeist = operation === "sphere_heist";
  if ($("espionage-category") && lastSelections.espionageCategory) $("espionage-category").value = lastSelections.espionageCategory;
  const selectedTarget = (espionage.targets || []).find((target) => target.playerId === targetSelect?.value);
  if ($("espionage-intel-spend")) {
    $("espionage-intel-spend").max = String(Math.min(Number(selectedTarget?.intel || 0), Number(rules.network?.currentMissionIntelSpendCap || 0)));
    $("espionage-intel-spend").value = String(Math.min(Number($("espionage-intel-spend").max), Math.max(0, Math.floor(Number(lastSelections.espionageIntelSpend) || 0))));
  }
  $("espionage-category-field")?.classList.toggle("hidden", isHeist);
  $("espionage-intel-boost-field")?.classList.toggle("hidden", isHeist);
  if ($("espionage-operation-heading")) $("espionage-operation-heading").textContent = isHeist ? "Launch Sphere Heist" : "Launch investigation";
  if ($("espionage-operation-hint")) $("espionage-operation-hint").textContent = isHeist ? "Spend Economy Intel to attempt an authoritative Sphere transfer. Failure can kill committed operatives." : "Investigations gather seasonal knowledge and rival-specific Intel.";
  const heistAvailability = sphereHeistAvailability(selectedTarget?.economyIntel, heistRules.economyIntelCost);
  const heistRequirement = $("sphere-heist-requirement");
  if (heistRequirement) {
    heistRequirement.classList.toggle("hidden", !isHeist);
    heistRequirement.innerHTML = heistAvailability.available
      ? '<strong>Ready: ' + number(heistAvailability.requiredIntel) + ' Economy Intel</strong><span>' + number(heistAvailability.availableIntel) + '/' + number(heistRules.economyIntelCap) + ' available against ' + escapeHtml(selectedTarget?.name || "this rival") + '; ' + number(heistAvailability.remainingIntel) + ' will remain after launch.</span>'
      : '<strong>Requires ' + number(heistAvailability.requiredIntel) + ' Economy Intel</strong><span>' + number(heistAvailability.availableIntel) + '/' + number(heistRules.economyIntelCap) + ' available against ' + escapeHtml(selectedTarget?.name || "this rival") + '. Economy investigations can improve this access.</span>';
  }
  document.querySelectorAll("[data-espionage-mission-tier], #espionage-intel-spend").forEach((input) => input.addEventListener("input", updateEspionagePreview));
  if (targetSelect) targetSelect.onchange = () => { captureSelections(); lastSelections.espionageTarget = targetSelect.value; lastSelections.espionageIntelSpend = "0"; renderEspionage(); };
  if (operationSelect) operationSelect.onchange = () => { captureSelections(); lastSelections.espionageOperation = operationSelect.value; lastSelections.espionageIntelSpend = "0"; renderEspionage(); };
  updateEspionagePreview();
  const missions = $("espionage-missions");
  if (missions) missions.innerHTML = (espionage.missions || []).map((mission) => {
    const pending = mission.status === "pending";
    const time = pending ? 'Resolves in <span data-local-countdown-at="' + Number(mission.resolveAt) + '">' + formatDuration(Math.max(0, Math.ceil((mission.resolveAt - Date.now()) / 60000))) + '</span>' : 'Resolved ' + escapeHtml(intelligenceReportAge(mission.resolvedAt));
    const casualties = Object.values(mission.casualties || {}).reduce((sum, count) => sum + Number(count || 0), 0);
    const result = pending ? number(mission.finalSpyPower) + ' Spy Power committed' : mission.operation === "sphere_heist"
      ? (mission.outcome || "resolved").replace(/^./, (letter) => letter.toUpperCase()) + ' · ' + number(mission.spheresStolen || 0) + ' Spheres stolen · ' + number(casualties) + ' lost · Identity ' + (mission.identityExposed ? 'exposed' : 'hidden')
      : (mission.outcome || 'resolved').replace(/^./, (letter) => letter.toUpperCase()) + (mission.incidentalCategory ? ' · Incidental ' + mission.incidentalCategory : '') + (mission.bonusDiscoveryId ? ' · Bonus Discovery' : '');
    const missionName = mission.operation === "sphere_heist" ? "Sphere Heist" : mission.category[0].toUpperCase() + mission.category.slice(1) + " Investigation";
    return '<article class="list-item espionage-mission-row"><strong>' + escapeHtml(mission.targetName) + ' — ' + escapeHtml(missionName) + '</strong><span>' + escapeHtml(result) + '</span><small>' + time + '</small></article>';
  }).join("") || '<div class="empty">No espionage missions launched yet.</div>';
  const controls = $("espionage-controls");
  syncEspionageControlLock(controls, networkLocked);
  if (!networkLocked) updateEspionagePreview();
  if ($("launch-espionage-mission")) $("launch-espionage-mission").textContent = isHeist ? "Launch 2-hour Sphere Heist" : "Launch 2-hour investigation";
}

function renderIntelligence() {
  renderKingdomIntelligence();
  renderEspionage();
  const territoryContainer = $("territory-reports");
  if (!territoryContainer) return;
  const territories = state.intelligence?.territories || [];
  const watchtower = state.intelligence?.watchtower || { level: 0, territoryLevel: 0, counterIntelligence: 0 };
  const watchtowerStatus = $("watchtower-intelligence-status");
  if (watchtowerStatus) {
    const coverage = ["No passive surveys", "Identities, traits, and broad ranges", "Narrow resistance estimates", "Narrow estimates and Counter-Intelligence"][Math.min(3, watchtower.level)] || "No passive surveys";
    watchtowerStatus.innerHTML = pulseItem("Watchtower", "Level " + watchtower.level) + pulseItem("Territory coverage", coverage) + pulseItem("Counter-Intelligence", watchtower.counterIntelligence ? "+" + watchtower.counterIntelligence : "None");
  }

  territoryContainer.innerHTML = territories.length ? territories.map((report) => {
    const resistance = formatIntelValue(report.resistance);
    const attributes = [report.highground ? "Highground" : "", report.large ? "Large" : ""].filter(Boolean).join(", ") || "No unusual attributes observed";
    const narrative = "The expedition reported " + (report.resistance?.label || "uncertain").toLowerCase() + " resistance at " + report.targetName + ".";
    const destination = report.plateauId
      ? ' data-territory-plateau="' + escapeHtml(report.plateauId) + '" role="link"'
      : '';
    const actionHint = report.plateauId ? ' · Open in Plateaus' : '';
    const bonusFact = report.bonusFactText ? '<p class="rule-callout"><strong>Spren observation:</strong> ' + escapeHtml(report.bonusFactText) + '</p>' : '';
    return '<article class="dossier-card territory-report-link" tabindex="0"' + destination + ' title="' + escapeHtml(intelligenceTooltip(report)) + '"><div class="card-heading"><div><strong>' + escapeHtml(report.targetName) + '</strong><span>' + escapeHtml(intelLevelName(report.effectiveLevel)) + '</span></div><span class="freshness-badge ' + report.freshness + '">' + intelligenceReportAge(report.observedAt) + '</span></div><p>' + escapeHtml(narrative) + '</p>' + bonusFact + '<div class="dossier-facts"><span>Resistance</span><strong>' + escapeHtml(resistance) + '</strong><span>Observed identity</span><strong>' + escapeHtml(report.plateauType || "Unknown") + '</strong><span>Attributes</span><strong>' + escapeHtml(attributes) + '</strong></div><small>Source: ' + escapeHtml(intelligenceSourceName(report.source)) + actionHint + '</small></article>';
  }).join("") : '<div class="empty-intelligence"><strong>No territory reports yet.</strong><span>Completed neutral expeditions will be recorded here.</span></div>';

  territoryContainer.querySelectorAll("[data-territory-plateau]").forEach((card) => {
    const openReport = (event) => {
      event.preventDefault();
      event.stopPropagation();
      openPlateauTarget(card.dataset.territoryPlateau);
    };
    card.addEventListener("click", openReport);
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") openReport(event);
    });
  });
}

function openPlateauTarget(plateauId) {
  if (!plateauId) return;
  const neutral = state.plateaus.neutral.some((plateau) => plateau.id === plateauId);
  const rival = state.plateaus.rivals.some((plateau) => plateau.id === plateauId);
  if (neutral) lastSelections.neutralPlateau = plateauId;
  if (rival) lastSelections.playerPlateau = plateauId;
  if (!neutral && !rival) holdingsExpanded = true;
  showView("plateaus");
  renderSelects();
  renderPlateaus();
  const select = neutral ? $("neutral-plateau-target") : rival ? $("player-plateau-target") : null;
  if (select) {
    select.value = plateauId;
    select.focus();
  }
}

function plateauRunDifficultyLabel(power) {
  if (power <= 20) return "Manageable";
  if (power <= 36) return "Dangerous";
  if (power <= 56) return "Brutal";
  return "Overwhelming";
}

function plateauRunLootLabel(spheres) {
  if (spheres <= 1200) return "Small";
  if (spheres <= 2600) return "Rich";
  return "Massive";
}

async function action(work, options = {}) {
  try {
    captureSelections();
    return await runMutationAction(work, {
      refresh: options.refresh,
      requestFullLoad: () => requestLoad({ reason: "post-mutation" }),
    });
  } catch (error) {
    alert(friendlyError(error));
    return null;
  }
}

function decorateBuildings(rules, levels) {
  return Object.fromEntries(Object.entries(rules).map(([key, rule]) => {
    const level = levels[key] || 0;
    return [key, { ...rule, level, nextCost: buildingCost(rule, level) }];
  }));
}

function normalizeBuildingObject(buildings, rules) {
  return Object.fromEntries(Object.keys(rules || {}).map((key) => [
    key,
    Math.max(0, Math.floor(Number(buildings?.[key]) || 0)),
  ]));
}

function buildingCost(rule, currentLevel) {
  if (Array.isArray(rule.levelCosts)) {
    return rule.levelCosts[currentLevel] || rule.levelCosts[rule.levelCosts.length - 1] || rule.baseCost || 0;
  }
  if (Number(rule.costMultiplier) > 0) {
    return Math.round((rule.baseCost || 0) * Math.pow(Number(rule.costMultiplier), currentLevel));
  }
  return (rule.baseCost || 0) * (currentLevel + 1);
}

function soulcastBunkerLevelCapacity(level) {
  const rule = state.config.buildings.soulcastBunker || {};
  const values = rule.provisionsByLevel || [];
  if (level < 1) return 0;
  return values[level - 1] || values[values.length - 1] || 0;
}

function soulcastBunkerCapacity(level) {
  let total = 0;
  for (let current = 1; current <= level; current += 1) {
    total += soulcastBunkerLevelCapacity(current);
  }
  return total;
}

function unlockedUnits(units, buildings) {
  return Object.fromEntries(Object.entries(units).filter(([, rule]) => {
    return rule.active !== false && (buildings.barracks || 0) >= rule.barracksLevel;
  }));
}

function decorateRaids(raids, players, unitsConfig) {
  const playerMap = Object.fromEntries(players.map((player) => [player.id, player]));
  return raids.map((raid) => ({
    id: raid._id,
    attackerId: raid.attackerId,
    targetId: raid.targetPlayerId || null,
    targetType: raid.targetType,
    attackerName: playerMap[raid.attackerId]?.name || "Unknown",
    targetName: raid.targetType === "open_acres" ? "Open acres" : raid.targetType === "parshendi_spheres" ? "Parshendi sphere stores" : raid.targetType === "deep_plains" ? "Deep Plains" : playerMap[raid.targetPlayerId]?.name || "Unknown",
    units: raid.units,
    unitSummary: unitSummary(raid.units, unitsConfig),
    power: raid.power,
    speed: raid.speed,
    acres: raid.acres || 0,
    defenseIntel: raid.defenseIntel,
    rewardSpheres: raid.rewardSpheres,
    rewardIntel: raid.rewardIntel,
    arrivalAt: raid.arriveAt,
    travelMinutes: Math.max(1, Math.round((raid.arriveAt - raid.departAt) / 60000)),
  }));
}

function decoratePlateaus(plateaus, players, unitsConfig) {
  const typeNames = {
    sphere: "Sphere Plateau",
    training: "Bridged Plateau",
    gemheart: "Gemheart Plateau",
    ancient_ruins: "Ancient Plateau",
    bridged: "Bridged Plateau",
    ancient: "Ancient Plateau",
  };
  const normalizePlateauType = (type) => type === "training" ? "bridged" : type === "ancient_ruins" ? "ancient" : type;
  const decorate = (plateau, visible = true) => ({
    id: plateau._id,
    name: plateau.name || (visible ? "Unknown Plateau" : "Unsurveyed Plateau"),
    type: visible ? normalizePlateauType(plateau.type) : "unknown",
    typeName: visible ? (plateau.typeName || typeNames[normalizePlateauType(plateau.type)] || plateau.type) : "Unknown reward",
    ownerName: plateau.ownerName || "Neutral",
    ownerPlayerId: plateau.ownerPlayerId || null,
    origin: plateau.origin || null,
    highground: Boolean(plateau.highground),
    large: Boolean(plateau.large),
    gemheartProgress: plateau.gemheartProgress || null,
    neutralDefenseRemaining: plateau.neutralDefenseRemaining || 0,
    activeSiegeId: plateau.activeSiegeId || null,
    resistance: plateau.resistance || null,
    intelligenceLevel: Number(plateau.intelligenceLevel || 0),
    parshendiReclamationCount: Number(plateau.parshendiReclamationCount || 0),
    baseNeutralDefense: Number(plateau.baseNeutralDefense ?? plateau.neutralDefenseInitial ?? 0),
  });
  const mine = (plateaus?.mine || []).map((plateau) => decorate(plateau, true));
  const neutral = (plateaus?.neutral || []).map((plateau, index) => {
    const identityVisible = Boolean(plateau.type);
    const decorated = decorate(plateau, identityVisible);
    return {
      ...decorated,
      label: (identityVisible ? decorated.name : "Neutral Plateau " + (index + 1)) + " — " + formatIntelValue(plateau.resistance),
      resistance: plateau.resistance,
    };
  });
  const rivals = (plateaus?.rivals || []).map((plateau) => decorate(plateau, Boolean(plateau.type)));
  const all = [...mine, ...neutral, ...rivals];
  const byId = Object.fromEntries(all.map((plateau) => [plateau.id, plateau]));

  return {
    counts: plateaus?.counts || {},
    mine,
    neutral,
    rivals,
    byId,
    sieges: (plateaus?.sieges || []).map((siege) => {
      const attackerUnitsKnown = Boolean(siege.attackerUnits);
      const attackerUnits = normalizeUnitObject(siege.attackerUnits || {}, Object.keys(unitsConfig));
      return {
        id: siege._id,
        plateauId: siege.plateauId,
        plateauName: siege.plateauName || null,
        attackerId: siege.attackerId,
        defenderId: siege.defenderId || null,
        targetType: siege.targetType,
        attackerName: siege.attackerName,
        defenderName: siege.defenderName,
        attackerUnits,
        attackerUnitsKnown,
        unitSummary: attackerUnitsKnown ? unitSummary(attackerUnits, unitsConfig) : "Force details unknown",
        attackerPower: siege.attackerPower || 0,
        attackerIntel: siege.attackerIntel || null,
        attackerSpeed: siege.attackerSpeed || 0,
        defenderUnits: normalizeUnitObject(siege.defenderUnits || {}, Object.keys(unitsConfig)),
        defenderPower: siege.defenderPower || 0,
        defenderSpeed: siege.defenderSpeed || 0,
        defenderCommittedAt: siege.defenderCommittedAt || null,
        fortifyPercent: siege.fortifyPercent,
        emergencyDefensePercent: siege.emergencyDefensePercent || 0,
        emergencyDefenseSpheresSpent: siege.emergencyDefenseSpheresSpent || 0,
        ardentiaConclave: Boolean(siege.ardentiaConclave),
        siegeVersion: Number(siege.siegeVersion || 1),
        encircleEndsAt: siege.encircleEndsAt || null,
        battleStartedAt: siege.battleStartedAt || null,
        role: siege.role || "observer",
        militaryIntel: Number(siege.militaryIntel || 0),
        reinforcements: siege.reinforcements || [],
        investigations: siege.investigations || [],
        resolveAt: siege.resolveAt,
      };
    }),
  };
}

function decoratePlateauRun(plateauRun, unitsConfig) {
  if (!plateauRun) return null;
  return {
    id: plateauRun.run._id,
    joinUntil: plateauRun.run.closesAt,
    difficultyPower: plateauRun.run.difficulty,
    spherePool: plateauRun.run.spherePool,
    gemheartReward: plateauRun.run.gemheartReward,
    participants: plateauRun.commitments.map((entry) => ({
      id: entry._id,
      playerId: entry.playerId,
      playerName: entry.playerName,
      units: normalizeUnitObject(entry.units || {}, Object.keys(unitsConfig)),
      unitSummary: unitSummary(entry.units, unitsConfig),
      power: entry.power,
      speed: entry.speed,
      speedScore: entry.speedScore,
      travelMinutes: entry.travelMinutes || null,
      bridgedTravelReductionPercent: entry.bridgedTravelReductionPercent || 0,
      joinOrder: entry.joinOrder,
      joinOrderSpeedBonus: entry.joinOrderSpeedBonus,
    })),
  };
}

function unitSummary(units = {}, unitsConfig = {}) {
  const parts = Object.entries(units || {})
    .filter(([, count]) => count > 0)
    .map(([key, count]) => number(count) + " " + (unitsConfig[key]?.name || key));
  return parts.length ? parts.join(", ") : "No units";
}

function raidStats(units, missionType = "") {
  const stats = Object.entries(units).reduce((total, [key, count]) => {
    const unit = state.config.units[key];
    if (!unit) return total;
    total.power += count * unit.power;
    if (key !== "shardbearer") total.supportingPower += count * unit.power;
    total.speed += count * unit.speed;
    total.plunder += count * (unit.plunder || 0);
    total.survivability += count * (unit.survivability || 0);
    total.total += count;
    return total;
  }, { power: 0, supportingPower: 0, breakthroughPower: 0, speed: 0, plunder: 0, survivability: 0, total: 0 });
  stats.breakthroughPower = Math.min(
    stats.supportingPower,
    Number(units.shardbearer || 0) * Number(state.config.armyRules?.shardbearerSupportPowerPerUnit || 100),
  );
  stats.power += stats.breakthroughPower;
  const completed = state.me.completedResearch || {};
  const value = currentResearchValue;
  stats.soulcastArmorPowerPerSpearman = value("soulcastArmor");
  stats.soulcastArmorPowerBonus = Number(units.spearman || 0) * stats.soulcastArmorPowerPerSpearman;
  stats.researchPowerBonus = stats.soulcastArmorPowerBonus;
  stats.packHarnessPlunderPerChull = value("packHarnessDesign");
  stats.researchPlunderBonus = Number(units.chull || 0) * stats.packHarnessPlunderPerChull;
  stats.painrialSurvivalPerSpearman = value("painrialMedicine");
  stats.researchSurvivabilityBonus = Number(units.spearman || 0) * stats.painrialSurvivalPerSpearman;
  stats.bridgeSpeedBonus = value("bridgeEngineering");
  stats.packHarnessSpeedPerChull = value("packHarnessDesign", "speedEffects");
  stats.packHarnessSpeedBonus = Number(units.chull || 0) * stats.packHarnessSpeedPerChull;
  stats.soulcastArmorSpeedPerSpearman = value("soulcastArmor", "speedEffects");
  stats.soulcastArmorSpeedBonus = Number(units.spearman || 0) * stats.soulcastArmorSpeedPerSpearman;
  stats.conclavePowerBonus = 0;
  stats.conclavePlunderBonus = 0;
  stats.conclaveSurvivabilityBonus = 0;
  stats.conclaveSpeedBonus = 0;
  stats.power += stats.researchPowerBonus;
  stats.speed += stats.bridgeSpeedBonus + stats.packHarnessSpeedBonus + stats.soulcastArmorSpeedBonus;
  stats.plunder += stats.researchPlunderBonus;
  stats.survivability += stats.researchSurvivabilityBonus;
  const conclaveSelected = missionType === "spheres" ? Boolean($("sphere-conclave")?.value) : missionType === "deepPlains" ? Boolean($("deep-plains-conclave")?.value) : missionType === "neutralSiege" ? Boolean($("neutral-conclave-select")?.value) : missionType === "playerSiege" ? Boolean($("player-conclave-select")?.value) : missionType === "plateau" ? Boolean($("plateau-conclave")?.value) : false;
  if (conclaveSelected && Number(completed.religiousStudies || 0) >= 3) {
    stats.preConclavePower = stats.power;
    stats.preConclaveSurvivability = stats.survivability;
    stats.conclavePowerBonus = 10 + Math.min(100, Math.max(0, stats.power)) * 0.5;
    stats.conclaveSurvivabilityBonus = Math.min(100, Math.max(0, stats.survivability)) * 0.5;
    stats.conclavePlunderBonus = 25;
    stats.power += stats.conclavePowerBonus;
    stats.survivability += stats.conclaveSurvivabilityBonus;
    stats.conclaveSpeedBonus = 1;
    stats.speed += stats.conclaveSpeedBonus;
    stats.plunder += stats.conclavePlunderBonus;
  }
  return stats;
}

function currentResearchValue(project, field = "effects") {
  const completed = state?.me?.completedResearch || state?.research?.completedLevels || {};
  const level = Number(completed[project] || 0);
  return level > 0 ? Number(state?.config?.researchRules?.projects?.[project]?.[field]?.[level - 1] || 0) : 0;
}

function unitResearchBonuses(unitKey) {
  if (unitKey === "spearman") {
    return {
      power: currentResearchValue("soulcastArmor"),
      plunder: 0,
      survivability: currentResearchValue("painrialMedicine"),
    };
  }
  if (unitKey === "chull") return { power: 0, plunder: currentResearchValue("packHarnessDesign"), survivability: 0 };
  return { power: 0, plunder: 0, survivability: 0 };
}

function unitResearchMath(unitKey, stat, base, bonus) {
  if (!bonus) return "";
  const lines = ["", "Base " + stat + ": " + formatStat(base)];
  if (unitKey === "spearman" && stat === "power") {
    const armor = currentResearchValue("soulcastArmor");
    if (armor) lines.push("Tailored Armor: " + signedStat(armor));
    lines.push(formatStat(base) + " + " + formatStat(armor) + " = " + formatStat(Number(base || 0) + bonus) + " effective Power per Spearman");
  } else if (unitKey === "spearman" && stat === "survivability") {
    lines.push("Field Surgery: " + signedStat(bonus));
    lines.push(formatStat(base) + " + " + formatStat(bonus) + " = " + formatStat(Number(base || 0) + bonus) + " effective Survive per Spearman");
  } else if (unitKey === "chull" && stat === "plunder") {
    lines.push("Pack Harnesses: " + signedStat(bonus));
    lines.push(formatStat(base) + " + " + formatStat(bonus) + " = " + formatStat(Number(base || 0) + bonus) + " effective Plunder per Chull");
  }
  return lines.join("\n");
}

function bridgedTravelReductionPercent() {
  return Math.max(0, Math.min(30, Number(state?.me?.plateauBonuses?.bridgedTravelReductionPercent || 0)));
}

function travelMinutes(speed, includeBridged = false) {
  const base = configValue("raidTravelGameDays", 1) * configValue("realMsPerGameDay", 3600000);
  return travelMinutesForBase(speed, base / 60000, includeBridged);
}

function travelMinutesForBase(speed, baseMinutes, includeBridged = false) {
  const constant = configValue("statDiminishingConstant", 100);
  const multiplier = speed >= 0
    ? constant / (constant + speed)
    : 1 + Math.abs(speed) / constant;
  const bridgedMultiplier = includeBridged ? 1 - bridgedTravelReductionPercent() / 100 : 1;
  return Math.max(1, Math.ceil(baseMinutes * multiplier * bridgedMultiplier));
}

function fixedSiegeTravelMinutes() {
  const base = configValue("raidTravelGameDays", 1) * configValue("realMsPerGameDay", 3600000);
  return Math.ceil(base / 60000);
}

function playerName(id) {
  return state.playerMap[id]?.name || "Unknown";
}

function emptyUnits(keys = null) {
  const unitKeys = keys || Object.keys(state?.config?.units || {
    bridgeman: true,
    spearman: true,
    chull: true,
    scout: true,
    heavy: true,
    shardbearer: true,
  });
  return Object.fromEntries(unitKeys.map((key) => [key, 0]));
}

function normalizeUnitObject(units, keys = null) {
  const normalized = emptyUnits(keys);
  Object.keys(normalized).forEach((key) => {
    normalized[key] = Math.max(0, Math.floor(Number(units?.[key]) || 0));
  });
  return normalized;
}

function addUnitObjects(left, right) {
  const next = normalizeUnitObject(left);
  const normalizedRight = normalizeUnitObject(right);
  Object.keys(next).forEach((key) => {
    next[key] += normalizedRight[key] || 0;
  });
  return next;
}

function number(value) {
  const numeric = Number(value) || 0;
  return numeric.toLocaleString(undefined, {
    maximumFractionDigits: Number.isInteger(numeric) ? 0 : 2,
  });
}

function configValue(key, fallback) {
  return Number.isFinite(Number(state.config[key])) ? Number(state.config[key]) : fallback;
}

function plateauRuleValue(key, fallback) {
  const value = state?.config?.plateauRules?.[key];
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function emergencyDefenseTotalCost(percent) {
  const maxPercent = plateauRuleValue("emergencyDefenseMaxPercent", 100);
  const maxCost = plateauRuleValue("emergencyDefenseMaxCost", 12000);
  const exponent = plateauRuleValue("emergencyDefenseCostExponent", 2);
  const cappedPercent = Math.max(0, Math.min(maxPercent, Math.floor(Number(percent) || 0)));
  const siegeDiscount = [0, 10, 15, 20][Number(state.research?.completedLevels?.siegeEngineering || 0)] || 0;
  const doctrineMultiplier = state.research?.economicDoctrine === "taxItAll" ? 1.1 : state.research?.economicDoctrine === "militaryState" ? 0.85 : 1;
  return Math.round(maxCost * Math.pow(cappedPercent / maxPercent, exponent) * (1 - siegeDiscount / 100) * doctrineMultiplier);
}

function emergencyDefenseIncrementalCost(currentPercent, targetPercent) {
  return Math.max(0, emergencyDefenseTotalCost(targetPercent) - emergencyDefenseTotalCost(currentPercent));
}

function siegeDefensePower(siege, plateau) {
  const terrainBonus = plateau?.highground ? 1 + plateauRuleValue("highgroundDefenseBonus", 0.2) : 1;
  return Number(siege.defenderPower || 0) * terrainBonus;
}

function siegeFinalDefense(siege, plateau, percent = null) {
  const defensePercent = percent ?? siege.emergencyDefensePercent ?? 0;
  return siegeDefensePower(siege, plateau) * (1 + Number(defensePercent || 0) / 100);
}

function formatStat(value) {
  return Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function signedStat(value) {
  const numeric = Number(value || 0);
  return (numeric > 0 ? "+" : "") + formatStat(numeric);
}

function formatPercent(value) {
  return ((Number(value || 0) * 100).toLocaleString(undefined, { maximumFractionDigits: 1 })) + "%";
}

function modifierLabel(value, prefix) {
  const numeric = Number(value || 0);
  return numeric > 0 ? prefix + number(numeric) + "%" : "No bonus";
}

function statTooltip(stat) {
  const tips = {
    power: "Add every unit's Power. Shardbearers also add a bounded Breakthrough bonus by doubling up to 100 supporting Power each.",
    speed: "Add every unit's Speed. Positive Speed shortens missions with diminishing returns; negative Speed lengthens them.",
    plunder: "Add every unit's Plunder. The total is the maximum number of Spheres the army can carry home.",
    survivability: "Add every unit's Survive. It changes casualties after relative Power determines the base casualty rate.",
  };
  return tips[stat] || "";
}

function formatDuration(minutes) {
  if (minutes < 1) return "under 1 min";
  if (minutes < 60) return minutes + " min";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? hours + " hr " + rest + " min" : hours + " hr";
}

function sumUnits(units) {
  return Object.values(units).reduce((sum, count) => sum + count, 0);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function isMobileLayout() {
  return window.matchMedia("(max-width: 680px)").matches;
}

function syncGlobalShellHeight() {
  const shell = $("global-shell");
  const height = shell && !shell.classList.contains("hidden") ? Math.ceil(shell.getBoundingClientRect().height) : 0;
  document.documentElement.style.setProperty("--global-shell-height", height + "px");
}

function showTapTooltip(text, anchor = null) {
  const tooltip = $("tap-tooltip");
  if (!tooltip || !text) return;
  if (anchor && activePopoverAnchor === anchor && !tooltip.classList.contains("hidden")) {
    hideTapTooltip();
    return;
  }
  activePopoverAnchor = anchor;
  $("tap-tooltip-content").textContent = text;
  tooltip.classList.remove("hidden");
}

function hideTapTooltip() {
  const tooltip = $("tap-tooltip");
  if (!tooltip) return;
  activePopoverAnchor = null;
  tooltip.classList.add("hidden");
}

function friendlyError(error) {
  return error?.data?.message || error?.message || "Something went wrong.";
}

let pendingMissionConfirmation = null;

function consequentialMissionSummary(title, target, units, conclaveId, extra = "") {
  const conclave = (state.ardentia?.conclaves || []).find((entry) => entry._id === conclaveId);
  const researchTradeoff = conclave && Number(state.research?.completedLevels?.religiousStudies || 0) >= 3
    ? '<span class="warning-text">' + escapeHtml(conclave.name) + ' stops contributing Research speed until this mission returns.</span>'
    : conclave ? '<span>' + escapeHtml(conclave.name) + ' will accompany the force as scouts.</span>' : '';
  return { title, html: '<strong>' + escapeHtml(target) + '</strong><span>Force: ' + escapeHtml(unitSummary(units, state.config.units)) + '</span>' + (extra ? '<span>' + escapeHtml(extra) + '</span>' : '') + researchTradeoff };
}

function selectedFabrial(id) {
  const kind = $(id)?.value || "";
  const item = (state.fabrials?.inventory || []).find((entry) => entry.kind === kind);
  return { kind, summary: item ? item.name + " will accompany this operation (" + (item.reusable ? "reusable" : "consumed on launch") + ")." : "" };
}

function confirmConsequentialMission(summary) {
  if (state.playerSettings?.confirmConsequentialMissions === false) return Promise.resolve(true);
  const dialog = $("mission-confirmation");
  $("mission-confirmation-title").textContent = summary.title || "Confirm mission";
  $("mission-confirmation-content").innerHTML = summary.html;
  if (typeof dialog.showModal === "function") dialog.showModal(); else dialog.setAttribute("open", "");
  return new Promise((resolve) => { pendingMissionConfirmation = resolve; });
}

function settleMissionConfirmation(accepted) {
  const dialog = $("mission-confirmation");
  if (dialog.open && typeof dialog.close === "function") dialog.close(); else dialog.removeAttribute("open");
  const resolve = pendingMissionConfirmation;
  pendingMissionConfirmation = null;
  if (resolve) resolve(accepted);
}

$("create-account-form").addEventListener("submit", (event) => {
  event.preventDefault();
  createAccount();
});
document.querySelectorAll("[data-account-mode]").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll("[data-account-mode]").forEach((entry) => { const active = entry === button; entry.classList.toggle("active", active); entry.setAttribute("aria-selected", String(active)); });
    document.querySelectorAll("[data-account-panel]").forEach((panel) => panel.classList.toggle("active", panel.dataset.accountPanel === button.dataset.accountMode));
  });
});
$("sign-in-form").addEventListener("submit", (event) => {
  event.preventDefault();
  signIn();
});
$("logout").addEventListener("click", () => {
  action(async () => {
    try {
      await disablePushNotifications().catch(() => null);
      await client.action(refs.signOut, {});
    } finally {
      clearAuthTokens();
      signedOut();
    }
  });
});
["sphere-form", "deep-plains-form", "neutral-siege-form", "player-siege-form", "plateau-form", "espionage-mission-form"].forEach((formId) => {
  $(formId)?.addEventListener("submit", (event) => event.preventDefault());
  $(formId)?.addEventListener("keydown", (event) => {
    if (!shouldBlockMissionKey(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
  });
});
$("launch-sphere-raid").addEventListener("click", async () => {
  try {
    const units = validatedRaidUnits("sphere-raid-units");
    const conclaveId = $("sphere-conclave")?.value || "";
    const fabrial = selectedFabrial("sphere-fabrial");
    if (!await confirmConsequentialMission(consequentialMissionSummary("Initiate sphere raid?", "Parshendi sphere stores", units, conclaveId, fabrial.summary))) return;
    action(() => client.mutation(refs.launchSphereRaid, { units, ...(conclaveId ? { conclaveId } : {}), ...(fabrial.kind ? { fabrial: fabrial.kind } : {}) }));
  } catch (error) { alert(friendlyError(error)); }
});
$("launch-deep-plains-raid")?.addEventListener("click", async () => {
  try {
    const units = validatedRaidUnits("deep-plains-units");
    const conclaveId = $("deep-plains-conclave")?.value || "";
    const fabrial = selectedFabrial("deep-plains-fabrial");
    const deepRange = deepPlainsTravelRange(raidStats(units, "deepPlains").speed);
    if (!await confirmConsequentialMission(consequentialMissionSummary("Launch Deep Plains raid?", "The Deep Plains", units, conclaveId, "This force will be committed for approximately " + formatDuration(deepRange.min) + "–" + formatDuration(deepRange.max) + " after Speed modifiers." + (fabrial.summary ? " " + fabrial.summary : "")))) return;
    action(() => client.mutation(refs.launchDeepPlainsRaid, { units, ...(conclaveId ? { conclaveId } : {}), ...(fabrial.kind ? { fabrial: fabrial.kind } : {}) }));
  } catch (error) { alert(friendlyError(error)); }
});
$("launch-neutral-siege").addEventListener("click", async () => {
  try {
    const plateauId = $("neutral-plateau-target").value;
    if (!plateauId) return alert("Choose a neutral plateau.");
    const units = validatedRaidUnits("neutral-siege-units");
    const conclaveId = $("neutral-conclave-select")?.value || "";
    const fabrial = selectedFabrial("neutral-fabrial");
    const target = state.plateaus.neutral.find((plateau) => plateau.id === plateauId);
    if (!await confirmConsequentialMission(consequentialMissionSummary("Initiate expedition?", target?.name || "Neutral plateau", units, conclaveId, fabrial.summary))) return;
    action(() => client.mutation(refs.launchNeutralSiege, { plateauId, units, ...(conclaveId ? { conclaveId } : {}), ...(fabrial.kind ? { fabrial: fabrial.kind } : {}) }));
  } catch (error) { alert(friendlyError(error)); }
});
$("launch-player-siege").addEventListener("click", async () => {
  try {
    const plateauId = $("player-plateau-target").value;
    if (!plateauId) return alert("Choose an enemy plateau.");
    const units = validatedRaidUnits("player-siege-units");
    const conclaveId = $("player-conclave-select")?.value || "";
    const fabrial = selectedFabrial("player-fabrial");
    const target = state.plateaus.rivals.find((plateau) => plateau.id === plateauId);
    if (!await confirmConsequentialMission(consequentialMissionSummary("Initiate rival siege?", target ? target.ownerName + " · " + target.name : "Rival plateau", units, conclaveId, "Encirclement lasts one hour; either side may then begin battle before the 24-hour deadline." + (fabrial.summary ? " " + fabrial.summary : "")))) return;
    action(() => client.mutation(refs.launchPlayerSiege, { plateauId, units, ...(conclaveId ? { conclaveId } : {}), ...(fabrial.kind ? { fabrial: fabrial.kind } : {}) }));
  } catch (error) { alert(friendlyError(error)); }
});
$("plateau-run-submit").addEventListener("click", () => {
  if (!state.plateauRun) return alert("No Plateau Run is open.");
  try {
    const units = validatedRaidUnits("plateau-run-units");
    const conclaveId = $("plateau-conclave")?.value || "";
    action(() => client.mutation(refs.joinPlateauRun, { plateauRunId: state.plateauRun.id, units, ...(conclaveId ? { conclaveId } : {}) }));
  } catch (error) { alert(friendlyError(error)); }
});
$("close-kingdom-intel-dialog")?.addEventListener("click", () => $("kingdom-intel-dialog").close());
$("kingdom-intel-dialog")?.addEventListener("click", (event) => {
  if (event.target === $("kingdom-intel-dialog")) $("kingdom-intel-dialog").close();
});
$("accept-mission-confirmation")?.addEventListener("click", () => settleMissionConfirmation(true));
$("cancel-mission-confirmation")?.addEventListener("click", () => settleMissionConfirmation(false));
$("close-mission-confirmation")?.addEventListener("click", () => settleMissionConfirmation(false));
$("mission-confirmation")?.addEventListener("cancel", (event) => { event.preventDefault(); settleMissionConfirmation(false); });
$("open-ghostblood-building")?.addEventListener("click", () => {
  showView("buildings");
  document.querySelector('[data-building="espionageNetwork"]')?.scrollIntoView({ behavior: "smooth", block: "center" });
});
$("espionage-defense-form")?.addEventListener("submit", (event) => {
  event.preventDefault();
  const operatives = { informant: 0, spy: 0, ghostblood: 0 };
  document.querySelectorAll("[data-espionage-defense-tier]").forEach((input) => { operatives[input.dataset.espionageDefenseTier] = Math.max(0, Math.floor(Number(input.value) || 0)); });
  action(() => client.mutation(refs.setEspionageDefense, { operatives }));
});
$("launch-espionage-mission")?.addEventListener("click", async () => {
  const targetPlayerId = $("espionage-target").value;
  if (!targetPlayerId) return alert("Choose a rival kingdom.");
  const operatives = selectedEspionageOperatives();
  const operation = $("espionage-operation")?.value || "investigation";
  const intelSpend = Math.max(0, Math.floor(Number($("espionage-intel-spend").value) || 0));
  const category = $("espionage-category").value;
  const basePower = Object.entries(operatives).reduce((sum, [tier, count]) => sum + count * Number(state.espionage?.rules?.operatives?.[tier]?.spyPower || 0), 0);
  const power = basePower + (operation === "sphere_heist" ? 0 : intelSpend);
  const target = (state.espionage?.targets || []).find((entry) => entry.playerId === targetPlayerId);
  if (operation === "sphere_heist") {
    const heistRules = state.espionage?.rules?.sphereHeist || ESPIONAGE_UI_DEFAULTS.sphereHeist;
    const availability = sphereHeistAvailability(target?.economyIntel, heistRules.economyIntelCost);
    if (!availability.available) return alert(`Sphere Heist requires ${availability.requiredIntel} Economy Intel against this rival.`);
    if (!await confirmConsequentialMission({ title: "Launch Sphere Heist?", html: '<strong>' + escapeHtml(target?.name || "Rival kingdom") + '</strong><span>' + number(power) + ' Spy Power will contest hidden Counter-Intelligence.</span><span>' + number(availability.requiredIntel) + ' Economy Intel will be consumed immediately.</span><span>Failure can permanently kill committed operatives.</span>' })) return;
    lastSelections.espionageMission = {};
    action(() => client.mutation(refs.launchSphereHeist, { targetPlayerId, operatives }));
    return;
  }
  if (!await confirmConsequentialMission({ title: "Launch investigation?", html: '<strong>' + escapeHtml(target?.name || "Rival kingdom") + ' · ' + escapeHtml(category) + '</strong><span>' + number(power) + ' final Spy Power</span><span>' + number(intelSpend) + ' Intel will be consumed immediately.</span>' })) return;
  lastSelections.espionageMission = {};
  lastSelections.espionageIntelSpend = "0";
  action(() => client.mutation(refs.launchInvestigation, { targetPlayerId, category, operatives, intelSpend }));
});
["espionage-defense-form"].forEach((formId) => $(formId)?.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.target.closest("button")) event.preventDefault();
}));
$("cancel-plateau-commitment").addEventListener("click", () => {
  if (!state.plateauRun) return;
  if (!window.confirm("Withdraw your army from this Plateau Run? All committed units will return immediately.")) return;
  lastSelections.attackUnits.plateau = {};
  loadedPlateauCommitmentId = null;
  $("plateau-run-units").querySelectorAll("input[data-unit]").forEach((input) => { input.value = "0"; });
  action(() => client.mutation(refs.cancelPlateauRunCommitment, { plateauRunId: state.plateauRun.id }));
});
$("message-form").addEventListener("submit", (event) => {
  event.preventDefault();
  action(async () => {
    await client.mutation(refs.sendMessage, {
      toPlayerId: $("message-target").value,
      subject: $("message-subject").value,
      body: $("message-text").value,
    });
    $("message-text").value = "";
    $("compose-panel").classList.add("hidden");
    $("toggle-compose").setAttribute("aria-expanded", "false");
  });
});
$("mark-inbox-read").addEventListener("click", () => action(() => client.mutation(refs.markInboxRead, {})));
$("toggle-compose").addEventListener("click", () => {
  const open = $("compose-panel").classList.toggle("hidden") === false;
  $("toggle-compose").setAttribute("aria-expanded", String(open));
});
document.querySelectorAll("[data-inbox-filter]").forEach((button) => button.addEventListener("click", () => {
  inboxFilter = button.dataset.inboxFilter;
  document.querySelectorAll("[data-inbox-filter]").forEach((entry) => entry.classList.toggle("active", entry === button));
  renderInbox();
}));
$("auto-read-inbox").checked = localStorage.getItem("sp-auto-read-inbox") === "true";
$("auto-read-inbox").addEventListener("change", () => localStorage.setItem("sp-auto-read-inbox", String($("auto-read-inbox").checked)));

function setNotificationPanelOpen(open) {
  placeNotificationPanelForLayout();
  $("notification-panel").classList.toggle("hidden", !open);
  $("notification-backdrop").classList.toggle("hidden", !open);
  $("notification-bell").setAttribute("aria-expanded", String(open));
  document.body.classList.toggle("notification-modal-open", open && isMobileLayout());
  if (open && isMobileLayout()) $("close-notifications").focus();
}

const notificationShell = $("notification-bell").closest(".notification-shell");
function placeNotificationPanelForLayout() {
  const parent = window.matchMedia("(max-width: 720px)").matches ? document.body : notificationShell;
  if (!parent || $("notification-panel").parentElement === parent) return;
  parent.append($("notification-backdrop"), $("notification-panel"));
}

$("notification-bell").addEventListener("click", (event) => {
  event.stopPropagation();
  setNotificationPanelOpen($("notification-panel").classList.contains("hidden"));
});
$("account-toggle")?.addEventListener("click", (event) => {
  event.stopPropagation();
  const panel = $("account-panel");
  const open = panel.classList.toggle("hidden") === false;
  $("account-toggle").setAttribute("aria-expanded", String(open));
});
$("account-panel")?.addEventListener("click", (event) => event.stopPropagation());
$("mission-confirmations")?.addEventListener("change", () => {
  const confirmConsequentialMissions = $("mission-confirmations").checked;
  state.playerSettings.confirmConsequentialMissions = confirmConsequentialMissions;
  sessionQueries.invalidate("settings");
  action(async () => {
    const updated = await client.mutation(refs.updatePlayerSettings, { confirmConsequentialMissions });
    sessionQueries.set("settings", { ...(state.playerSettings || {}), ...updated });
    return updated;
  }, { refresh: false });
});
$("notification-panel").addEventListener("click", (event) => event.stopPropagation());
$("notification-backdrop").addEventListener("click", () => setNotificationPanelOpen(false));
$("close-notifications").addEventListener("click", () => setNotificationPanelOpen(false));
document.addEventListener("click", () => {
  setNotificationPanelOpen(false);
  $("account-panel")?.classList.add("hidden");
  $("account-toggle")?.setAttribute("aria-expanded", "false");
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !$("notification-panel").classList.contains("hidden")) setNotificationPanelOpen(false);
});
$("mark-notifications-read").addEventListener("click", () => action(() => client.mutation(refs.markAllNotificationsRead, {})));
document.querySelectorAll("[data-notification-preference]").forEach((input) => input.addEventListener("change", () => {
  const preferences = {};
  document.querySelectorAll("[data-notification-preference]").forEach((entry) => { preferences[entry.dataset.notificationPreference] = entry.checked; });
  action(() => client.mutation(refs.updateNotificationPreferences, preferences));
}));
$("enable-push").addEventListener("click", () => action(enablePushNotifications));
$("disable-push").addEventListener("click", () => action(disablePushNotifications));
$("notification-sound").addEventListener("change", async () => {
  const subscription = await currentPushSubscription().catch(() => null);
  if (subscription) action(() => client.mutation(refs.setPushDeviceSound, { endpoint: subscription.endpoint, soundEnabled: $("notification-sound").checked }));
});
$("install-app").addEventListener("click", async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  $("install-app").classList.add("hidden");
});
$("toggle-holdings").addEventListener("click", () => { holdingsExpanded = !holdingsExpanded; renderGroupedHoldings(); });
document.querySelectorAll("[data-expedition-mode]").forEach((button) => button.addEventListener("click", () => {
  document.querySelectorAll("[data-expedition-mode]").forEach((entry) => entry.classList.toggle("active", entry === button));
  document.querySelectorAll("[data-expedition-panel]").forEach((panel) => panel.classList.toggle("active", panel.dataset.expeditionPanel === button.dataset.expeditionMode));
}));
$("finish-raids").addEventListener("click", () => {
  action(async () => {
    const result = await client.mutation(refs.forceResolveAllRaids, {});
    if (!result.scheduled) alert("No pending raids to finish.");
  });
});
$("finish-sieges").addEventListener("click", () => {
  action(async () => {
    const result = await client.mutation(refs.forceResolveAllSieges, {});
    if (!result.scheduled) alert("No active plateau sieges to finish.");
  });
});
$("start-plateau").addEventListener("click", () => action(() => client.mutation(refs.startPlateauRun, {})));
$("finish-plateau").addEventListener("click", () => {
  if (!state.plateauRun) return alert("No Plateau Run is open.");
  action(() => client.mutation(refs.forceResolvePlateauRun, { plateauRunId: state.plateauRun.id }));
});
$("backfill-plateaus").addEventListener("click", () => action(async () => {
  const result = await client.mutation(refs.backfillPlateaus, {});
  alert("Plateau maintenance complete. " + number(result.defensesRetuned || 0) + " neutral defenses retuned; " + number(result.neutralCreated || 0) + " neutral plateaus created.");
}));
$("finish-research").addEventListener("click", () => action(() => client.mutation(refs.finishActiveResearch, {})));
$("backfill-research").addEventListener("click", () => action(() => client.mutation(refs.backfillResearchSystem, {})));
if ($("rollover-season")) {
  $("rollover-season").addEventListener("click", async () => {
    const confirmText = window.prompt('This archives the current Ledger and starts a zero-score season without resetting gameplay. Resolve active operations first. Type "START NEW SEASON" to continue.');
    if (confirmText !== "START NEW SEASON") return;
    const result = await action(() => client.mutation(refs.rolloverSeason, { confirm: confirmText }));
    if (result) alert(result.name + " is now active. Existing territory is the new baseline and hold timers restart now.");
  });
}
if ($("reset-world-keep-accounts")) {
  $("reset-world-keep-accounts").addEventListener("click", async () => {
    const confirmText = window.prompt(
      'This wipes raids, sieges, Plateau Runs, messages, plateaus, kingdom progress, and all Season Ledger history, but keeps login accounts and warcamp names. Type "RESET WORLD" to continue.',
    );
    if (confirmText !== "RESET WORLD") return;

    const result = await action(() => client.mutation(refs.resetWorldKeepAccounts, {
      confirm: confirmText,
    }));
    if (result) {
      alert(
        "World reset complete. " +
          number(result.playersReset) +
          " warcamps were given fresh starter kingdoms.",
      );
    }
  });
}

function formatCountdownAt(timestamp) {
  const remaining = Math.max(0, Number(timestamp || 0) - Date.now());
  if (remaining <= 0) return "Ready";
  const totalMinutes = Math.max(1, Math.ceil(remaining / 60000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  return [days ? days + "d" : "", hours ? hours + "h" : "", minutes ? minutes + "m" : ""].filter(Boolean).join(" ");
}

function updateGemheartCountdowns() {
  document.querySelectorAll("[data-gemheart-at]").forEach((element) => {
    const countdown = formatCountdownAt(element.dataset.gemheartAt);
    if (element.tagName === "OPTION") {
      element.textContent = (element.dataset.countdownLabel || "Gemheart Plateau") + " · Next Gemheart: " + countdown;
    } else {
      element.textContent = (element.dataset.countdownPrefix || "") + countdown;
    }
  });
}

function updateLocalTimePresentation() {
  updateGemheartCountdowns();
  document.querySelectorAll("[data-local-countdown-at]").forEach((element) => {
    const minutes = Math.max(0, Math.ceil((Number(element.dataset.localCountdownAt) - Date.now()) / 60000));
    element.textContent = formatDuration(minutes);
  });
  if (state?.gameClock) {
    const projected = projectGameClock(state.gameClock, state.config?.realMsPerGameDay);
    if (projected) {
      state.gameDate = projected.label;
      if ($("game-date")) $("game-date").textContent = projected.label;
    }
  }
  if (state?.me?.sphereEconomy) {
    const economy = state.me.sphereEconomy;
    state.me.spheres = projectPlayerSpheres(economy.player, economy.accounting, economy.realMsPerGameDay);
    if ($("res-spheres")) $("res-spheres").textContent = number(state.me.spheres);
  }
}
document.addEventListener("click", (event) => {
  if (event.target.closest("#tap-tooltip")) return;
  const calculation = event.target.closest(".stat-cell[title], .outlook-cell[title], .research-time-cell[title]");
  if (calculation) {
    showTapTooltip(calculation.getAttribute("title"), calculation);
    return;
  }
  if (event.target.closest("button, input, select, textarea, [data-route-view]")) {
    hideTapTooltip();
    return;
  }
  const target = event.target.closest("[title]");
  if (!target) {
    hideTapTooltip();
    return;
  }
  const text = target.getAttribute("title");
  if (!text) return;
  showTapTooltip(text, target);
});
$("close-tap-tooltip")?.addEventListener("click", hideTapTooltip);
document.addEventListener("keydown", (event) => { if (event.key === "Escape") hideTapTooltip(); });
window.addEventListener("resize", () => {
  const notificationsOpen = !$("notification-panel")?.classList.contains("hidden");
  if (notificationsOpen) placeNotificationPanelForLayout();
  document.body.classList.toggle("notification-modal-open", Boolean(notificationsOpen && isMobileLayout()));
  syncGlobalShellHeight();
});

if ("ResizeObserver" in window && $("global-shell")) {
  new ResizeObserver(syncGlobalShellHeight).observe($("global-shell"));
}
window.requestAnimationFrame(syncGlobalShellHeight);

window.addEventListener("popstate", (event) => {
  if (!state) return;
  showRoute(event.state || routeFromLocation(), { history: "none" });
});

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  $("install-app")?.classList.remove("hidden");
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("service-worker.js").catch((error) => console.warn("Service worker registration failed.", error));
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type === "open-route" && state) showRoute(event.data.route || { view: "home" });
    if (event.data?.type === "open-view" && state) showView(event.data.view || "home");
  });
}

if (authToken) requestLoad();
else signedOut();
createReconciliationLifecycle({
  reconcile: (reason) => requestLoad({ reason }),
  isAuthenticated: () => Boolean(authToken),
  isVisible: () => document.visibilityState !== "hidden",
});
setInterval(updateLocalTimePresentation, 1000);
