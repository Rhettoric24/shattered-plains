import { ConvexHttpClient } from "convex/browser";

const CONVEX_URL =
  window.SHATTERED_PLAINS_CONFIG?.convexUrl ||
  "https://clean-yak-51.convex.cloud";
const client = new ConvexHttpClient(CONVEX_URL);
const AUTH_TOKEN_KEY = "sp-convex-auth-token";
const AUTH_REFRESH_KEY = "sp-convex-auth-refresh-token";
const DASHBOARD_REFRESH_MS = 30000;

let authToken = localStorage.getItem(AUTH_TOKEN_KEY);
let refreshToken = localStorage.getItem(AUTH_REFRESH_KEY);
if (authToken) client.setAuth(authToken);
let state = null;
let currentView = localStorage.getItem("sp-current-view") || "overview";
let lastSelections = { trainUnit: "", target: "", attackUnits: {}, recruitment: {} };
let previewListenersReady = false;
let tooltipTimer = null;
let inboxFilter = "all";
let holdingsExpanded = false;
let latestLoadRequest = 0;
let loadedPlateauCommitmentId = null;

const $ = (id) => document.getElementById(id);

/**
 * Shared attack-planner contract. Every mission uses the same unit controls,
 * outlook renderer, stat explanations, validation path, and confirmation shape.
 * Mission configuration changes only timing and intelligence presentation.
 */
const ATTACK_PLANNERS = {
  spheres: { formId: "sphere-form", unitsId: "sphere-raid-units", previewId: "sphere-raid-preview", timing: "speed", intelligence: "estimated" },
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
  bootstrapWorld: "game:bootstrapWorld",
  getClock: "game:getClock",
  getGameConfig: "config:getGameConfig",
  getDashboard: "players:getDashboard",
  createPlayer: "players:createPlayer",
  listPlayers: "players:listPlayers",
  upgradeBuilding: "buildings:upgradeBuilding",
  trainUnit: "army:trainUnit",
  getArdentiaStatus: "ardentia:getStatus",
  recruitConclave: "ardentia:recruitConclave",
  launchSphereRaid: "raids:launchSphereRaid",
  listVisibleRaids: "raids:listVisibleRaids",
  forceResolveRaid: "raids:forceResolveRaid",
  forceResolveAllRaids: "raids:forceResolveAllRaids",
  listPlateaus: "plateaus:listPlateaus",
  launchNeutralSiege: "plateaus:launchNeutralSiege",
  launchPlayerSiege: "plateaus:launchPlayerSiege",
  commitSiegeDefenders: "plateaus:commitSiegeDefenders",
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
  listEvents: "game:listEvents",
  listDossiers: "intelligence:listDossiers",
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
  setAuthTokens(result.tokens);
  return true;
}

function setAuthTokens(tokens) {
  authToken = tokens.token;
  refreshToken = tokens.refreshToken;
  client.setAuth(authToken);
  localStorage.setItem(AUTH_TOKEN_KEY, authToken);
  localStorage.setItem(AUTH_REFRESH_KEY, refreshToken);
}

function clearAuthTokens() {
  authToken = null;
  refreshToken = null;
  client.clearAuth();
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(AUTH_REFRESH_KEY);
}

async function load(options = {}) {
  const requestId = ++latestLoadRequest;
  const allowRefresh = options.allowRefresh ?? true;
  if (!authToken) return signedOut();
  captureSelections();

  try {
    const [
      config,
      dashboard,
      players,
      events,
      clock,
      adminStatus,
    ] = await Promise.all([
      client.query(refs.getGameConfig, {}),
      client.query(refs.getDashboard, {}),
      client.query(refs.listPlayers, {}),
      client.query(refs.listEvents, {}),
      client.query(refs.getClock, {}),
      client.query(refs.isAdmin, {}),
    ]);

    if (requestId !== latestLoadRequest) return;

    if (!dashboard || !dashboard.player) {
      state = null;
      signedOut();
      showAccountMessage("This login worked, but no warcamp is attached to it. Create a new account with a warcamp, or delete this test auth account and start fresh.");
      return;
    }

    const [raids, plateaus, plateauRun, inbox, intelligence, ardentia] = await Promise.all([
      client.query(refs.listVisibleRaids, {}),
      client.query(refs.listPlateaus, {}),
      client.query(refs.getCurrentPlateauRun, {}),
      client.query(refs.listInbox, {}),
      // Keep the rest of the dashboard usable while a local frontend build is
      // briefly ahead of the Convex deployment during development.
      client.query(refs.listDossiers, {}).catch((error) => {
        console.warn("Intelligence backend is not available yet.", error);
        return { kingdoms: [], territories: [], watchtower: { level: 0, territoryLevel: 0, counterIntelligence: 0 } };
      }),
      client.query(refs.getArdentiaStatus, {}).catch(() => ({ owned: 0, away: 0, ready: 0, capacity: 0, provisionsEach: 10 })),
    ]);

    if (requestId !== latestLoadRequest) return;

    state = buildState({
      config,
      dashboard,
      players,
      raids,
      plateaus,
      plateauRun,
      inbox,
      intelligence,
      ardentia,
      events,
      clock,
      adminStatus,
    });
    render();
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
  const player = data.dashboard.player;
  const playerUnits = normalizeUnitObject(player.units);
  const playerBuildings = normalizeBuildingObject(player.buildings, data.config.buildings);
  const config = {
    ...data.config,
    buildings: decorateBuildings(data.config.buildings, playerBuildings),
    unlockedUnits: unlockedUnits(data.config.units, playerBuildings),
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
  const availableStats = data.dashboard.armyStats;
  const playerRows = data.players.map((entry) => ({
    id: entry._id,
    _id: entry._id,
    name: entry.name,
    acres: entry.acres,
    homePower: entry._id === player._id ? availableStats.power : null,
  }));

  return {
    config,
    gameDate: data.clock?.label || "World clock unavailable",
    me: {
      id: player._id,
      name: player.name,
      acres: data.dashboard.ownedPlateauCount || 0,
      spheres: data.dashboard.effectiveSpheres,
      gemhearts: player.gemhearts,
      units: playerUnits,
      availableUnits: playerUnits,
      unitsAway,
      buildings: playerBuildings,
      buildingStats: data.dashboard.buildingStats,
      provisions: data.dashboard.provisions || { used: 0, capacity: 0, remaining: 0 },
      plateauBonuses: data.dashboard.plateauBonuses || { sphereIncomeBonusPercent: 0, bridgedTravelReductionPercent: 0 },
      plateauAttributes: data.dashboard.plateauAttributes || { large: 0, highground: 0 },
      totalIncomePerDay: data.dashboard.buildingStats.totalIncomePerDay,
      totalUnits: totalUnitsOwned,
      totalAvailableUnits: totalUnitsAtHome,
      power: availableStats.power,
      homePower: availableStats.power,
    },
    players: playerRows,
    playerMap: Object.fromEntries(playerRows.map((entry) => [entry.id, entry])),
    openAcres: data.dashboard.neutralPlateauCount || 0,
    plateaus: decoratePlateaus(data.plateaus, playerRows, data.config.units),
    raids: decorateRaids(data.raids, playerRows, data.config.units),
    plateauRun: decoratePlateauRun(data.plateauRun, data.config.units),
    inbox: (data.inbox?.messages || []).map((message) => ({
      id: message._id,
      fromPlayerId: message.fromPlayerId,
      kind: message.kind || (message.fromPlayerId ? "player" : "report"),
      subject: message.subject,
      text: message.body,
      read: Boolean(message.readAt),
      at: message.createdAt,
    })),
    unreadCount: data.inbox?.unreadCount || 0,
    isAdmin: Boolean(data.adminStatus?.isAdmin),
    adminEmail: data.adminStatus?.email || null,
    alerts: [],
    intelligence: data.intelligence || { kingdoms: [], territories: [], watchtower: { level: 0, territoryLevel: 0, counterIntelligence: 0 } },
    ardentia: data.ardentia || { owned: 0, away: 0, ready: 0, capacity: 0, provisionsEach: 10 },
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
  $("res-acres").textContent = number(me.acres);
  $("res-spheres").textContent = number(me.spheres);
  $("res-gemhearts").textContent = number(me.gemhearts || 0);
  $("res-units").textContent = number(me.totalAvailableUnits) + " / " + number(me.totalUnits);
  renderTopProvisions();
  renderBuildings();
  renderUnits();
  renderConclaveControls();
  renderSelects();
  renderInboxBadge();
  renderRaidUnitInputs("sphere-raid-units");
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
  renderWorldAlerts();
  renderAdminAccess();
  renderNavStates();
  showView(currentView);
}

function renderWorldAlerts() {
  const alerts = buildWorldAlerts();
  const container = $("world-alerts");
  if (!container) return;
  container.innerHTML = alerts.map((alert) => {
    const action = alert.view
      ? '<button type="button" data-alert-view="' + alert.view + '">' + escapeHtml(alert.action) + '</button>'
      : "";
    return '<article class="world-alert ' + alert.kind + '"><div><strong>' + escapeHtml(alert.title) + '</strong><span>' + escapeHtml(alert.text) + '</span></div>' + action + '</article>';
  }).join("");
  container.querySelectorAll("[data-alert-view]").forEach((button) => {
    button.addEventListener("click", () => showView(button.dataset.alertView));
  });
}

function buildWorldAlerts() {
  const alerts = [];
  const incoming = state.raids.filter((raid) => raid.targetId === state.me.id);
  const outgoing = state.raids.filter((raid) => raid.attackerId === state.me.id);
  const mySieges = state.plateaus.sieges.filter((siege) => siege.attackerId === state.me.id || siege.defenderId === state.me.id);

  if (state.plateauRun) {
    const remaining = Math.max(0, Math.ceil((state.plateauRun.joinUntil - Date.now()) / 60000));
    alerts.push({
      kind: "critical",
      title: "Plateau Run Open",
      text: formatDuration(remaining) + " left to join. Difficulty " + plateauRunDifficultyLabel(state.plateauRun.difficultyPower) + ", loot " + plateauRunLootLabel(state.plateauRun.spherePool) + ".",
      action: "Open Plateau",
      view: "plateau",
    });
  }

  if (incoming.length) {
    const soonest = incoming.reduce((next, raid) => Math.min(next, raid.arrivalAt), incoming[0].arrivalAt);
    const remaining = Math.max(0, Math.ceil((soonest - Date.now()) / 60000));
    alerts.push({
      kind: "warning",
      title: incoming.length + " Incoming Raid" + (incoming.length === 1 ? "" : "s"),
      text: "Soonest arrival in " + formatDuration(remaining) + ".",
      action: "Open Raids",
      view: "raids",
    });
  }

  if (mySieges.length) {
    const soonest = mySieges.reduce((next, siege) => Math.min(next, siege.resolveAt), mySieges[0].resolveAt);
    const remaining = Math.max(0, Math.ceil((soonest - Date.now()) / 60000));
    alerts.push({
      kind: "warning",
      title: mySieges.length + " Active Siege" + (mySieges.length === 1 ? "" : "s"),
      text: "Soonest plateau siege resolves in " + formatDuration(remaining) + ".",
      action: "Open Plateaus",
      view: "plateaus",
    });
  }

  if (state.unreadCount > 0) {
    alerts.push({
      kind: "info",
      title: state.unreadCount + " Unread Message" + (state.unreadCount === 1 ? "" : "s"),
      text: "New reports or player messages are waiting.",
      action: "Open Inbox",
      view: "inbox",
    });
  }

  if (outgoing.length) {
    alerts.push({
      kind: "info",
      title: outgoing.length + " Outgoing Raid" + (outgoing.length === 1 ? "" : "s"),
      text: "Forces are committed away from your warcamp.",
      action: "Open Raids",
      view: "raids",
    });
  }

  return alerts;
}

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
  if (!isAdmin && (currentView === "testing" || currentView === "chronicle")) {
    currentView = "overview";
  }
}

function renderNavStates() {
  const runState = $("run-nav-state");
  const siegeState = $("siege-nav-state");
  if (runState) runState.classList.toggle("hidden", !state.plateauRun);
  const needsDefense = state.plateaus.sieges.some((siege) => siege.defenderId === state.me.id && !siege.defenderCommittedAt);
  if (siegeState) siegeState.classList.toggle("hidden", !needsDefense);
}

function captureSelections() {
  if ($("target")) lastSelections.target = $("target").value;
  if ($("neutral-plateau-target")) lastSelections.neutralPlateau = $("neutral-plateau-target").value;
  if ($("player-plateau-target")) lastSelections.playerPlateau = $("player-plateau-target").value;
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

function showView(view) {
  if ((view === "testing" || view === "chronicle") && !state?.isAdmin) view = "overview";
  currentView = view;
  localStorage.setItem("sp-current-view", view);
  closeMobileMenu();
  document.querySelectorAll(".view").forEach((section) => {
    section.classList.toggle("active", section.id === "view-" + view);
  });
  document.querySelectorAll(".nav-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === view);
  });
  const active = $("view-" + view);
  if (active) {
    $("view-title").textContent = active.dataset.title || "Dashboard";
    $("view-eyebrow").textContent = active.dataset.eyebrow || "Command";
  }
  if (view === "inbox" && localStorage.getItem("sp-auto-read-inbox") === "true" && state?.unreadCount > 0) {
    action(() => client.mutation(refs.markInboxRead, {}));
  }
}

function renderBuildings() {
  const visibleBuildings = Object.entries(state.config.buildings).filter(([key]) => key === "market" || key === "watchtower" || key === "ardentMonastery" || key === "soulcastBunker");
  $("buildings").innerHTML = visibleBuildings.map(([key, building]) => {
    const level = state.me.buildings[key] ?? building.level ?? 0;
    const nextCost = Number(building?.nextCost || 0);
    const affordable = state.me.spheres >= nextCost;
    const values = buildingEffectValues(key, level);
    const name = key === "market" ? "Warcamp Market" : building?.name || key;
    const maxed = Number(building.maxLevel || 0) > 0 && level >= Number(building.maxLevel);
    const status = maxed ? "Mastered" : affordable ? "Affordable" : "Need " + number(nextCost - state.me.spheres);
    return '<article class="upgrade-card investment-card"><div class="card-heading"><div><strong>' + escapeHtml(name) + '</strong><span>Level ' + level + '</span></div><span class="status-badge ' + (!maxed && affordable ? 'ready' : 'blocked') + '">' + status + '</span></div><small>' + escapeHtml(building?.description || "") + '</small><div class="effect-comparison"><div><span>Current effect</span><strong>' + escapeHtml(values.current) + '</strong></div><div><span>' + (maxed ? 'Status' : 'After upgrade') + '</span><strong>' + escapeHtml(maxed ? 'Maximum level' : values.next) + '</strong></div></div>' + (maxed ? '' : '<div class="cost-line"><span>Upgrade cost</span><strong>' + number(nextCost) + ' Spheres</strong></div><button data-building="' + key + '" data-building-name="' + escapeHtml(name) + '" data-building-cost="' + nextCost + '"' + (affordable ? '' : ' disabled') + '>Upgrade to Level ' + (level + 1) + '</button>') + '</article>';
  }).join("");
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
      "No passive territory survey",
      "Reveals neutral plateau types and attributes",
      "Adds broad resistance ranges",
      "Adds narrow resistance estimates and +1 Counter-Intelligence",
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
    const resourceCost = unit.gemheartCost || unit.cost || 0;
    const resourceName = unit.gemheartCost ? "Gemheart" + (resourceCost === 1 ? "" : "s") : "Spheres";
    const provisionCost = unit.provisionsCost || 0;
    const draft = Math.max(0, Math.floor(Number(lastSelections.recruitment[key]) || 0));
    const contribution = (value) => Number(value || 0) > 0 ? "+" + formatStat(value) : formatStat(value);
    const shardbearerSupportPower = Number(state.config.armyRules?.shardbearerSupportPowerPerUnit || 100);
    const breakthrough = key === "shardbearer"
      ? '<p class="rule-callout">Breakthrough: doubles up to ' + number(shardbearerSupportPower) + ' supporting Power per Shardbearer.</p>'
      : '';
    return '<article class="upgrade-card unit-card unit-' + key + ' ' + (unlocked ? "" : "locked") + '" data-recruit-card="' + key + '"><div class="card-heading"><div><strong>' + escapeHtml(unit.name) + '</strong><span>' + escapeHtml(unit.role || "") + '</span></div><span class="status-badge">Ready: ' + number(available) + ' · Away: ' + number(away) + ' · Owned: ' + number(count) + '</span></div><div class="unit-identity"><p>' + escapeHtml(unit.identity || "") + '</p><small><strong>Best for:</strong> ' + escapeHtml(unit.bestFor || "General operations.") + '</small></div><div class="unit-stat-grid"><button type="button" class="stat-cell" title="' + statTooltip("power") + '"><span>Power</span><strong>' + contribution(unit.power) + '</strong></button><button type="button" class="stat-cell" title="' + statTooltip("speed") + '"><span>Speed</span><strong>' + contribution(unit.speed) + '</strong></button><button type="button" class="stat-cell" title="' + statTooltip("plunder") + '"><span>Plunder</span><strong>' + contribution(unit.plunder) + '</strong></button><button type="button" class="stat-cell" title="' + statTooltip("survivability") + '"><span>Survivability</span><strong>' + contribution(unit.survivability) + '</strong></button></div>' + breakthrough + '<div class="unit-costs"><span><small>Recruitment cost</small><strong>' + number(resourceCost) + ' ' + escapeHtml(resourceName) + '</strong></span><span><small>Provision cost</small><strong>' + number(provisionCost) + ' each</strong></span></div><div class="quantity-builder"><div class="quick-add"><button type="button" data-recruit-add="1">+1</button><button type="button" data-recruit-add="10">+10</button><button type="button" data-recruit-add="50">+50</button><button type="button" data-recruit-add="100">+100</button></div><label>Quantity<input data-recruit-quantity type="number" min="0" value="' + draft + '"></label><div class="quantity-corrections"><button type="button" class="secondary" data-recruit-minus>−1</button><button type="button" class="secondary" data-recruit-clear>Clear</button></div></div><div data-recruit-preview class="recruit-preview"></div><button type="button" data-recruit-submit>Recruit ' + escapeHtml(unit.name) + '</button></article>';
  }).join("");
  const monasteryLevel = Number(state.me.buildings.ardentMonastery || 0);
  const ardentia = state.ardentia;
  const rules = state.config.ardentiaRules || { recruitmentCost: 2000, provisionsCost: 10 };
  const canRecruit = monasteryLevel > 0 && ardentia.owned < ardentia.capacity && state.me.spheres >= rules.recruitmentCost && state.me.provisions.remaining >= rules.provisionsCost;
  const conclaveCard = monasteryLevel > 0
    ? '<article class="upgrade-card unit-card conclave-card"><div class="card-heading"><div><strong>Ardentia Scout Conclave</strong><span>Field intelligence specialists</span></div><span class="status-badge">' + number(ardentia.ready) + ' ready / ' + number(ardentia.owned) + ' formed</span></div><div class="unit-identity"><p>Accompanies an army to improve the resulting intelligence report. The Conclave does not add combat Power.</p><small><strong>Capacity:</strong> ' + number(ardentia.owned) + ' / ' + number(ardentia.capacity) + ' supported by Ardent Monastery level ' + monasteryLevel + '.</small></div><div class="unit-costs"><span><small>Formation cost</small><strong>' + number(rules.recruitmentCost) + ' Spheres</strong></span><span><small>Provision cost</small><strong>' + number(rules.provisionsCost) + '</strong></span></div><p class="rule-callout">One Conclave may accompany each expedition. It always has at least a 25% chance to complete its investigation and is never permanently destroyed.</p><button type="button" data-recruit-conclave' + (canRecruit ? '' : ' disabled') + '>' + (ardentia.owned >= ardentia.capacity ? 'Monastery capacity reached' : 'Form Scout Conclave') + '</button></article>'
    : '';
  $("unit-roster").innerHTML = unitCards + conclaveCard;
  attachRecruitmentControls();
  const recruitConclave = document.querySelector("[data-recruit-conclave]");
  if (recruitConclave) {
    recruitConclave.addEventListener("click", () => action(() => client.mutation(refs.recruitConclave, {})));
  }
}

function renderConclaveControls() {
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
    const update = (value) => { input.value = String(Math.max(0, Math.floor(Number(value) || 0))); lastSelections.recruitment[key] = input.value; renderRecruitmentPreview(card, key); };
    card.querySelectorAll("[data-recruit-add]").forEach((button) => button.addEventListener("click", () => update(Number(input.value) + Number(button.dataset.recruitAdd))));
    card.querySelector("[data-recruit-minus]").addEventListener("click", () => update(Number(input.value) - 1));
    card.querySelector("[data-recruit-clear]").addEventListener("click", () => update(0));
    input.addEventListener("input", () => update(input.value));
    card.querySelector("[data-recruit-submit]").addEventListener("click", () => action(async () => { await client.mutation(refs.trainUnit, { unit: key, count: Number(input.value) }); lastSelections.recruitment[key] = 0; }));
    renderRecruitmentPreview(card, key);
  });
}

function renderRecruitmentPreview(card, key) {
  const unit = state.config.units[key];
  const count = Math.max(0, Math.floor(Number(card.querySelector("[data-recruit-quantity]").value) || 0));
  const resourceName = unit.gemheartCost ? "Gemhearts" : "Spheres";
  const unitCost = unit.gemheartCost || unit.cost || 0;
  const availableResource = unit.gemheartCost ? state.me.gemhearts : state.me.spheres;
  const totalCost = count * unitCost;
  const provisionCost = count * (unit.provisionsCost || 0);
  const after = state.me.provisions.used + provisionCost;
  const shortages = [];
  if (totalCost > availableResource) shortages.push("Needs " + number(totalCost - availableResource) + " more " + resourceName);
  if (after > state.me.provisions.capacity) shortages.push("Needs " + number(after - state.me.provisions.capacity) + " more Provisions");
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
    $("neutral-plateau-target").innerHTML = state.plateaus.neutral.map((plateau) => {
      return '<option value="' + plateau.id + '">' + escapeHtml(plateau.label) + '</option>';
    }).join("");
    if (lastSelections.neutralPlateau && state.plateaus.neutral.some((plateau) => plateau.id === lastSelections.neutralPlateau)) $("neutral-plateau-target").value = lastSelections.neutralPlateau;
  }
  if ($("player-plateau-target")) {
    $("player-plateau-target").innerHTML = state.plateaus.rivals.map((plateau) => {
      return '<option value="' + plateau.id + '">' + escapeHtml(plateau.ownerName + " - " + plateau.name) + '</option>';
    }).join("");
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
    return '<label class="unit-input" title="' + unitStatsTooltip(unit) + '"><span>' + escapeHtml(unit.name) + '<small>Available ' + number(available) + '</small></span><input data-unit="' + key + '" type="number" min="0" max="' + available + '" value="' + existing + '"></label>';
  }).join("");
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
  ["sphere-raid-units", "neutral-siege-units", "player-siege-units", "plateau-run-units"].forEach((containerId) => {
    if ($(containerId)) $(containerId).addEventListener("input", renderRaidPreviews);
  });
  ["neutral-plateau-target", "player-plateau-target"].forEach((id) => {
    if (!$(id)) return;
    $(id).addEventListener("input", renderRaidPreviews);
    $(id).addEventListener("change", renderRaidPreviews);
  });
  ["neutral-conclave", "player-conclave"].forEach((id) => {
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
    const submit = $(planner.formId)?.querySelector('button[type="submit"], button:not([type])');
    if (submit) submit.disabled = !attackPlannerCanSubmit(type, planner, units);
  });
}

function attackPlannerCanSubmit(type, planner, units) {
  if (sumUnits(units) < 1) return false;
  if (Object.entries(units).some(([key, count]) => count > Number(state.me.availableUnits[key] || 0))) return false;
  if (type === "neutralSiege" && !$("neutral-plateau-target").value) return false;
  if (type === "playerSiege" && !$("player-plateau-target").value) return false;
  if (type === "plateau" && !state.plateauRun) return false;
  return Boolean($(planner.formId));
}

function previewMarkup(units, type, planner) {
  const stats = raidStats(units);
  const isPlayerSiege = planner.timing === "fixed";
  const travel = isPlayerSiege ? fixedSiegeTravelMinutes() : travelMinutes(stats.speed, true);
  const target = type === "spheres" ? sphereTargetPreview() : type === "plateau" ? plateauTargetPreview(stats) : type === "neutralSiege" ? neutralSiegePreview(stats) : type === "playerSiege" ? playerSiegePreview(stats) : "Choose a target";
  const timingTitle = isPlayerSiege ? "Player sieges are fixed at one real hour. Army Speed does not shorten them." : speedBreakdown(units, stats, travel);
  const rewardLabel = type === "plateau" ? "Reward capacity" : "Max Plunder";
  const conclaveAttached = type === "neutralSiege"
    ? Boolean($("neutral-conclave")?.checked)
    : type === "playerSiege"
      ? Boolean($("player-conclave")?.checked)
      : false;
  const intelOutlook = type === "playerSiege" ? playerSiegeIntelOutlook(conclaveAttached) : null;
  return '<div class="outlook-heading"><span>Mission outlook</span><strong>' + escapeHtml(target) + '</strong></div><div class="outlook-grid">' +
    outlookCell("Power", formatStat(stats.power), powerBreakdown(units, stats)) +
    outlookCell(rewardLabel, type === "plateau" ? "Event pool" : number(stats.plunder) + " Spheres", plunderBreakdown(units, stats)) +
    outlookCell("Time committed", formatDuration(travel), timingTitle) +
    outlookCell("Survivability", signedStat(stats.survivability), survivabilityBreakdown(units, stats)) +
    (intelOutlook ? outlookCell("Intelligence", intelOutlook.value, intelOutlook.details) : "") +
    (conclaveAttached ? outlookCell("Investigation", "Conclave attached", "Success follows this army's final casualty risk, with a minimum 25% and maximum 95% chance. The exact chance is revealed after resolution.") : "") +
    '</div>';
}

function outlookCell(label, value, details) {
  return '<button type="button" class="outlook-cell" title="' + escapeHtml(details) + '"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(value) + '</strong></button>';
}

function powerBreakdown(units, stats) {
  const lines = activeUnitEntries().filter(([key]) => Number(units[key] || 0) > 0).map(([key, unit]) => number(units[key]) + " × " + formatStat(unit.power) + " " + unit.name);
  if (Number(units.shardbearer || 0) > 0) lines.push("Bounded Breakthrough bonus: +" + formatStat(stats.breakthroughPower));
  lines.push("Final Power: " + formatStat(stats.power));
  return lines.join("\n");
}

function plunderBreakdown(units, stats) {
  const lines = activeUnitEntries().filter(([key]) => Number(units[key] || 0) > 0).map(([key, unit]) => number(units[key]) + " × " + formatStat(unit.plunder || 0) + " from " + unit.name);
  lines.push("Maximum recovery: " + number(stats.plunder) + " Spheres");
  return lines.join("\n");
}

function speedBreakdown(units, stats, travel) {
  const constant = configValue("statDiminishingConstant", 100);
  const formula = stats.speed >= 0
    ? "Base Time × " + constant + " ÷ (" + constant + " + " + formatStat(stats.speed) + ")"
    : "Base Time × (1 + " + formatStat(Math.abs(stats.speed)) + " ÷ " + constant + ")";
  return "Speed contributions sum to " + signedStat(stats.speed) + ".\nFormula: " + formula + "\nBridged Plateau reduction: " + number(bridgedTravelReductionPercent()) + "%\nFinal duration: " + formatDuration(travel);
}

function playerSiegeIntelOutlook(conclaveAttached) {
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
  const lines = activeUnitEntries().filter(([key]) => Number(units[key] || 0) > 0).map(([key, unit]) => number(units[key]) + " × " + signedStat(unit.survivability) + " from " + unit.name);
  lines.push("Army Survivability: " + signedStat(stats.survivability));
  lines.push(stats.survivability >= 0
    ? "Final casualties = Base casualties × " + constant + " ÷ (" + constant + " + Survivability)"
    : "Final casualties = Base casualties × (1 + |Survivability| ÷ " + constant + ")");
  lines.push("Base casualties = 25% × Enemy Power ÷ Your Power, bounded from 3% to 80%.");
  return lines.join("\n");
}

function sphereTargetPreview() {
  const averageDefense = (configValue("parshendiSphereRaidMinDefense", 1) + configValue("parshendiSphereRaidMaxDefense", 4)) / 2;
  const averageReward = (configValue("parshendiSphereRaidMinReward", 250) + configValue("parshendiSphereRaidMaxReward", 650)) / 2;
  return "Estimated resistance: " + neutralDefenseLabel(averageDefense) + "\nEstimated reward: " + plateauRunLootLabel(averageReward);
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
  return "Parshendi resistance: " + formatIntelValue(target.resistance) + "\nYour Power: " + formatStat(stats.power);
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
    button.addEventListener("click", () => {
      const siegeId = button.dataset.commitSiegeDefenders;
      action(() => client.mutation(refs.commitSiegeDefenders, {
        siegeId,
        units: readSiegeDefenderUnits(siegeId),
      }));
    });
  });
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
  container.innerHTML = pulseItem("Sphere income", modifierLabel(state.me.plateauBonuses.sphereIncomeBonusPercent, "+")) + pulseItem("Travel time", modifierLabel(state.me.plateauBonuses.bridgedTravelReductionPercent, "−")) + pulseItem("Provision capacity", modifierLabel(state.me.provisions.largeBonusPercent, "+")) + pulseItem("Ancient sites", number(counts.ancient)) + (gemheart ? pulseItem("Next Gemheart", number(gemheart.gemheartProgress.progressPercent) + "%") : pulseItem("Gemheart sites", number(counts.gemheart)));
}

function renderGroupedHoldings() {
  const container = $("owned-plateaus");
  if (!state.plateaus.mine.length) { container.innerHTML = '<div class="empty">No owned plateaus yet.</div>'; return; }
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
  container.classList.toggle("hidden", !holdingsExpanded);
  $("toggle-holdings").textContent = holdingsExpanded ? "Hide individual plateaus" : "Show all plateaus (" + number(state.plateaus.mine.length) + ")";
  $("toggle-holdings").setAttribute("aria-expanded", String(holdingsExpanded));
}

function plateauCard(plateau) {
  const attributes = plateauAttributes(plateau).join(", ");
  const underSiege = Boolean(plateau.activeSiegeId);
  const status = underSiege ? '<small class="warning-text">Under siege</small>' : "";
  const timer = plateau.gemheartProgress
    ? '<small>Gemheart: ' + number(plateau.gemheartProgress.progressPercent) + '% toward next</small>'
    : "";
  const origin = plateau.origin === "home" ? '<small>Home Plateau</small>' : "";
  return '<article class="plateau-holding-card ' + (underSiege ? "warning" : "") + '" title="' + plateauTooltip(plateau) + '"><strong>' + escapeHtml(plateau.name) + '</strong><span>' + escapeHtml(plateau.typeName) + '</span>' + origin + '<small>' + escapeHtml(attributes) + '</small><small>' + escapeHtml(plateauBonusLabel(plateau)) + '</small>' + timer + status + '</article>';
}

function siegeCard(siege) {
  const plateau = state.plateaus.byId[siege.plateauId];
  const remaining = Math.max(0, Math.ceil((siege.resolveAt - Date.now()) / 60000));
  const isAttacker = siege.attackerId === state.me.id;
  const isDefender = siege.defenderId === state.me.id;
  const title = siege.targetType === "player"
    ? escapeHtml(siege.attackerName) + " vs " + escapeHtml(siege.defenderName)
    : escapeHtml(siege.attackerName) + " vs Parshendi";
  const attackerText = isAttacker
    ? "Your attack power " + formatStat(siege.attackerPower)
    : "Attacker force " + formatIntelValue(siege.attackerIntel);
  const committedText = siege.targetType === "player"
    ? isDefender
      ? (siege.defenderCommittedAt ? "Your defenders are committed" : "No defenders committed yet")
      : "Defensive response unknown"
    : "Neutral expedition";
  const defensePower = siegeDefensePower(siege, plateau);
  const finalDefense = siegeFinalDefense(siege, plateau, siege.emergencyDefensePercent);
  const defenseText = isDefender
    ? "Committed defense " + formatStat(defensePower) + ", Emergency +" + number(siege.emergencyDefensePercent) + "%, Final " + formatStat(finalDefense)
    : siege.targetType === "player"
      ? "Defenses unknown"
      : "Parshendi hold " + neutralDefenseLabel(plateau?.neutralDefenseRemaining || 0);
  const defenderPanel = isDefender && siege.targetType === "player" ? siegeDefenderPanel(siege, plateau) : "";
  const conclaveText = isAttacker && siege.ardentiaConclave ? ' Ardentia Scout Conclave attached.' : '';
  return '<article class="list-item raid-item siege-card"><strong>' + title + '</strong><span>' + escapeHtml(plateau?.name || "Unknown plateau") + '</span><small>' + attackerText + '. ' + committedText + '. ' + defenseText + '.' + conclaveText + ' Resolves in ' + formatDuration(remaining) + '.</small>' + defenderPanel + '</article>';
}

function siegeDefenderPanel(siege, plateau) {
  const commitPanel = siege.defenderCommittedAt
    ? '<div class="siege-defense-note">Defending army locked: ' + escapeHtml(unitSummary(siege.defenderUnits, state.config.units)) + '.</div>'
    : '<div class="siege-defense-panel"><strong>Commit defenders</strong><div class="unit-input-grid siege-defense-grid">' + siegeDefenderUnitInputs(siege) + '</div><button type="button" data-commit-siege-defenders="' + siege.id + '">Commit defending army</button></div>';
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
    return '<label class="unit-input" title="' + unitStatsTooltip(unit) + '"><span>' + escapeHtml(unit.name) + '<small>Available ' + number(available) + '</small></span><input data-siege-defense-unit data-siege-id="' + siege.id + '" data-unit="' + key + '" type="number" min="0" max="' + available + '" value="' + existing + '"></label>';
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
}

function raidListMarkup(raids, emptyText) {
  return raids.length ? raids.map((raid) => {
    const arrival = new Date(raid.arrivalAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const remaining = Math.max(0, Math.ceil((raid.arrivalAt - Date.now()) / 60000));
    const direction = raid.attackerId === state.me.id ? "Outgoing" : raid.targetId === state.me.id ? "Incoming" : "Observed";
    const isMine = raid.attackerId === state.me.id;
    const prize = raid.targetType === "parshendi_spheres"
      ? plateauRunLootLabel(raid.rewardSpheres || 0) + " sphere loot"
      : "land pressure";
    const force = isMine
      ? escapeHtml(raid.unitSummary) + ' for ' + prize
      : 'Force appears ' + operationPowerLabel(raid.power) + ' with ' + operationSpeedLabel(raid.speed) + ' pace';
    const details = isMine
      ? 'Power ' + formatStat(raid.power) + ', Speed ' + formatStat(raid.speed) + externalDefenseText(raid) + ', travel ' + formatDuration(raid.travelMinutes) + '.'
      : 'Estimated strength ' + operationPowerLabel(raid.power) + externalDefenseText(raid) + ', travel ' + formatDuration(raid.travelMinutes) + '.';
    const activityLabel = direction === "Outgoing" ? "My Raid" : "World Raid";
    return '<article class="list-item raid-item ' + direction.toLowerCase() + '"><strong>' + activityLabel + ':</strong> ' + escapeHtml(raid.attackerName) + ' to <strong>' + escapeHtml(raid.targetName) + '</strong><span>' + force + '</span><small>' + details + ' Resolves ' + arrival + ' (' + formatDuration(remaining) + ' left).</small></article>';
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
  status.innerHTML = '<div class="plateau-card"><strong>Join window open</strong><span>' + formatDuration(remaining) + ' left</span><small>Difficulty ' + plateauRunDifficultyLabel(run.difficultyPower) + '. Loot: ' + number(run.gemheartReward) + ' Gemheart and a ' + plateauRunLootLabel(run.spherePool) + ' sphere pool.</small></div>';
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

function renderInbox() {
  const list = $("inbox-list");
  if (!list) return;
  const inbox = (state.inbox || []).filter((message) => inboxFilter === "all" || (inboxFilter === "players" ? message.kind === "player" : message.kind !== "player")).sort((a, b) => Number(a.read) - Number(b.read) || b.at - a.at);
  $("toggle-compose").classList.toggle("secondary", inboxFilter !== "players");
  list.innerHTML = inbox.length ? inbox.map((message) => {
    const from = message.fromPlayerId ? playerName(message.fromPlayerId) : "System";
    const readClass = message.read ? "read" : "unread";
    const category = message.fromPlayerId ? "Player" : "Report";
    const preview = message.text.length > 110 ? message.text.slice(0, 107) + "…" : message.text;
    return '<details class="list-item message-item ' + readClass + '" data-message-id="' + message.id + '"' + (message.read ? '' : ' data-unread="true"') + '><summary><div><span class="event-kind">' + category + '</span><strong>' + escapeHtml(message.subject) + '</strong><small>' + escapeHtml(preview) + '</small></div><time>' + relativeTime(message.at) + '</time></summary><div class="message-body"><p>' + escapeHtml(message.text) + '</p><small>From ' + escapeHtml(from) + ' · ' + new Date(message.at).toLocaleString() + '</small></div></details>';
  }).join("") : '<div class="empty">No messages yet.</div>';
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
  const operationCount = state.raids.filter((raid) => raid.attackerId === state.me.id).length + state.plateaus.sieges.filter((siege) => siege.attackerId === state.me.id || siege.defenderId === state.me.id).length + (state.plateauRun?.participants.some((entry) => entry.playerId === state.me.id) ? 1 : 0);
  $("kingdom-pulse").innerHTML = pulseItem("Income / day", number(state.me.totalIncomePerDay), incomeTooltip(), true) + pulseItem("Ready Power", formatStat(state.me.power)) + pulseBreakdownItem("Plateau bonuses", bonusLines) + pulseItem("Active operations", number(operationCount));
  const operations = [];
  state.raids.filter((raid) => raid.attackerId === state.me.id).forEach((raid) => operations.push({ label: "Sphere raid", detail: raid.targetName, at: raid.arrivalAt, view: "raids" }));
  state.plateaus.sieges.filter((siege) => siege.attackerId === state.me.id || siege.defenderId === state.me.id).forEach((siege) => operations.push({ label: siege.defenderId === state.me.id ? "Defending siege" : "Plateau siege", detail: state.plateaus.byId[siege.plateauId]?.name || "Plateau", at: siege.resolveAt, view: "plateaus" }));
  if (state.plateauRun?.participants.some((entry) => entry.playerId === state.me.id)) operations.push({ label: "Plateau Run", detail: "Warcamp committed", at: state.plateauRun.joinUntil, view: "plateau" });
  operations.sort((a, b) => a.at - b.at);
  $("overview-operations").innerHTML = operations.length ? operations.map((item) => '<button type="button" class="operation-row" data-operation-view="' + item.view + '"><span><strong>' + escapeHtml(item.label) + '</strong><small>' + escapeHtml(item.detail) + '</small></span><b>' + formatDuration(Math.max(0, Math.ceil((item.at - Date.now()) / 60000))) + '</b></button>').join("") : '<div class="empty">No armies are currently committed. Your next move is yours.</div>';
  $("overview-operations").querySelectorAll("[data-operation-view]").forEach((button) => button.addEventListener("click", () => showView(button.dataset.operationView)));
}

function renderCommandBriefing() {
  const panel = $("command-briefing");
  const container = $("command-priorities");
  const priorities = [];
  const urgentSieges = state.plateaus.sieges.filter((siege) => siege.defenderId === state.me.id && !siege.defenderCommittedAt);
  if (urgentSieges.length) priorities.push({ label: "Defensive siege", text: urgentSieges.length + " plateau" + (urgentSieges.length === 1 ? " needs" : "s need") + " defenders", view: "plateaus" });
  if (state.plateauRun) priorities.push({ label: "Plateau Run open", text: formatDuration(Math.max(0, Math.ceil((state.plateauRun.joinUntil - Date.now()) / 60000))) + " left to commit", view: "plateau" });
  if (state.me.provisions.used > state.me.provisions.capacity) priorities.push({ label: "Over Provisions", text: "Recruitment is blocked until capacity recovers", view: "buildings" });
  panel.classList.toggle("hidden", priorities.length < 1);
  container.innerHTML = priorities.map((item) => '<button type="button" class="priority-item" data-priority-view="' + item.view + '"><span>' + escapeHtml(item.label) + '</span><strong>' + escapeHtml(item.text) + '</strong></button>').join("");
  container.querySelectorAll("[data-priority-view]").forEach((button) => button.addEventListener("click", () => showView(button.dataset.priorityView)));
}

function pulseItem(label, value, title = "", expandable = false) {
  return '<article class="pulse-item' + (expandable ? ' expandable' : '') + '"' + (title ? ' title="' + escapeHtml(title) + '" tabindex="0"' : '') + '><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(value) + '</strong></article>';
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
  const order = ["bridgeman", "spearman", "chull", "shardbearer"];
  return Object.entries(state.config.units)
    .filter(([, unit]) => unit.active !== false)
    .sort(([left], [right]) => {
      const leftIndex = order.indexOf(left);
      const rightIndex = order.indexOf(right);
      return (leftIndex < 0 ? order.length : leftIndex) - (rightIndex < 0 ? order.length : rightIndex);
    });
}

function unitStatsTooltip(unit) {
  return escapeHtml(
    "Provisions: " + number(unit.provisionsCost || 0) + " per unit\n" +
    "Power: " + formatStat(unit.power) + " - " + statTooltip("power") + "\n" +
    "Speed: " + formatStat(unit.speed) + " - " + statTooltip("speed") + "\n" +
    "Plunder: " + formatStat(unit.plunder || 0) + " - " + statTooltip("plunder") + "\n" +
    "Survivability: " + signedStat(unit.survivability) + " - " + statTooltip("survivability")
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
  if (plateau.type === "ancient" || plateau.type === "ancient_ruins") effects.push("Ancient Plateau: future Research and Fabrial site. Dormant for now.");
  if (plateau.highground) effects.push("Highground: +20% defense when this plateau is attacked.");
  if (plateau.large) effects.push("Large: +10% Soulcast Bunker Provisions capacity, stacking to +30%.");
  if (plateau.gemheartProgress) {
    effects.push("Gemheart progress: " + number(plateau.gemheartProgress.progressPercent) + "%.");
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
  if (plateau.type === "ancient" || plateau.type === "ancient_ruins") return "Future Research/Fabrial site";
  return "No active bonus";
}

function neutralDefenseLabel(power) {
  if (power <= 50) return "Vulnerable";
  if (power <= 100) return "Guarded";
  if (power <= 150) return "Defended";
  if (power <= 220) return "Fortified";
  return "Impregnable";
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
  if (presentation.mode === "label") return presentation.label;
  if (presentation.mode === "range") return presentation.min + "–" + (presentation.max === null ? presentation.min + "+" : presentation.max);
  if (presentation.mode === "estimate") return "about " + presentation.min + "–" + presentation.max;
  if (presentation.mode === "exact") return number(presentation.value) + " (snapshot)";
  return "Unknown";
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

function renderIntelligence() {
  const kingdomContainer = $("kingdom-dossiers");
  const territoryContainer = $("territory-reports");
  if (!kingdomContainer || !territoryContainer) return;
  const kingdoms = state.intelligence?.kingdoms || [];
  const territories = state.intelligence?.territories || [];
  const watchtower = state.intelligence?.watchtower || { level: 0, territoryLevel: 0, counterIntelligence: 0 };
  const watchtowerStatus = $("watchtower-intelligence-status");
  if (watchtowerStatus) {
    const coverage = ["No passive surveys", "Plateau identities revealed", "Broad resistance ranges", "Narrow resistance estimates"][Math.min(3, watchtower.level)] || "No passive surveys";
    watchtowerStatus.innerHTML = pulseItem("Watchtower", "Level " + watchtower.level) + pulseItem("Territory coverage", coverage) + pulseItem("Counter-Intelligence", watchtower.counterIntelligence ? "+" + watchtower.counterIntelligence : "None");
  }

  kingdomContainer.innerHTML = kingdoms.length ? kingdoms.map((report) => {
    const power = formatIntelValue(report.militaryPower);
    const narrative = report.militaryPower?.mode === "exact"
      ? "Our observers recorded military strength " + number(report.militaryPower.value) + ". Treat this as a dated snapshot."
      : "Our observers describe " + report.targetName + " as " + (report.militaryPower?.label || "uncertain").toLowerCase() + ".";
    return '<article class="dossier-card" tabindex="0" title="' + escapeHtml(intelligenceTooltip(report)) + '"><div class="card-heading"><div><strong>' + escapeHtml(report.targetName) + '</strong><span>' + escapeHtml(intelLevelName(report.effectiveLevel)) + '</span></div><span class="freshness-badge ' + report.freshness + '">' + intelligenceReportAge(report.observedAt) + '</span></div><p>' + escapeHtml(narrative) + '</p><div class="dossier-facts"><span>Military</span><strong>' + escapeHtml(power) + '</strong></div><small>Source: ' + escapeHtml(intelligenceSourceName(report.source)) + ' · Tap or hover for report mechanics</small></article>';
  }).join("") : '<div class="empty-intelligence"><strong>No kingdom dossiers yet.</strong><span>Completed raids against rival warcamps will begin building your records.</span></div>';

  territoryContainer.innerHTML = territories.length ? territories.map((report) => {
    const resistance = formatIntelValue(report.resistance);
    const attributes = [report.highground ? "Highground" : "", report.large ? "Large" : ""].filter(Boolean).join(", ") || "No unusual attributes observed";
    const narrative = "The expedition reported " + (report.resistance?.label || "uncertain").toLowerCase() + " resistance at " + report.targetName + ".";
    const destination = report.plateauId
      ? ' data-territory-plateau="' + escapeHtml(report.plateauId) + '" role="link"'
      : '';
    const actionHint = report.plateauId ? ' · Open in Plateaus' : '';
    return '<article class="dossier-card territory-report-link" tabindex="0"' + destination + ' title="' + escapeHtml(intelligenceTooltip(report)) + '"><div class="card-heading"><div><strong>' + escapeHtml(report.targetName) + '</strong><span>' + escapeHtml(intelLevelName(report.effectiveLevel)) + '</span></div><span class="freshness-badge ' + report.freshness + '">' + intelligenceReportAge(report.observedAt) + '</span></div><p>' + escapeHtml(narrative) + '</p><div class="dossier-facts"><span>Resistance</span><strong>' + escapeHtml(resistance) + '</strong><span>Observed identity</span><strong>' + escapeHtml(report.plateauType || "Unknown") + '</strong><span>Attributes</span><strong>' + escapeHtml(attributes) + '</strong></div><small>Source: ' + escapeHtml(intelligenceSourceName(report.source)) + actionHint + '</small></article>';
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

function externalDefenseText(raid) {
  if (!raid.defensePower) return "";
  return ", opposition " + neutralDefenseLabel(raid.defensePower);
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

async function action(work) {
  try {
    captureSelections();
    const result = await work();
    await load();
    return result;
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
    targetName: raid.targetType === "open_acres" ? "Open acres" : raid.targetType === "parshendi_spheres" ? "Parshendi sphere stores" : playerMap[raid.targetPlayerId]?.name || "Unknown",
    units: raid.units,
    unitSummary: unitSummary(raid.units, unitsConfig),
    power: raid.power,
    speed: raid.speed,
    acres: raid.acres || 0,
    defensePower: raid.defensePower,
    rewardSpheres: raid.rewardSpheres,
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

function raidStats(units) {
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
  return stats;
}

function bridgedTravelReductionPercent() {
  return Math.max(0, Math.min(30, Number(state?.me?.plateauBonuses?.bridgedTravelReductionPercent || 0)));
}

function travelMinutes(speed, includeBridged = false) {
  const base = configValue("raidTravelGameDays", 1) * configValue("realMsPerGameDay", 3600000);
  const constant = configValue("statDiminishingConstant", 100);
  const multiplier = speed >= 0
    ? constant / (constant + speed)
    : 1 + Math.abs(speed) / constant;
  const bridgedMultiplier = includeBridged ? 1 - bridgedTravelReductionPercent() / 100 : 1;
  return Math.max(1, Math.ceil((base * multiplier * bridgedMultiplier) / 60000));
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
  return Math.round(maxCost * Math.pow(cappedPercent / maxPercent, exponent));
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
    survivability: "Add every unit's Survivability. It changes casualties after relative Power determines the base casualty rate.",
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

function closeMobileMenu() {
  const nav = $("dashboard-nav");
  const toggle = $("mobile-menu-toggle");
  if (!nav || !toggle) return;
  nav.classList.remove("open");
  toggle.setAttribute("aria-expanded", "false");
}

function toggleMobileMenu() {
  const nav = $("dashboard-nav");
  const toggle = $("mobile-menu-toggle");
  if (!nav || !toggle) return;
  const nextOpen = !nav.classList.contains("open");
  nav.classList.toggle("open", nextOpen);
  toggle.setAttribute("aria-expanded", String(nextOpen));
}

function showTapTooltip(text) {
  const tooltip = $("tap-tooltip");
  if (!tooltip || !text) return;
  window.clearTimeout(tooltipTimer);
  tooltip.textContent = text;
  tooltip.classList.remove("hidden");
  tooltipTimer = window.setTimeout(() => {
    tooltip.classList.add("hidden");
  }, 5200);
}

function hideTapTooltip() {
  const tooltip = $("tap-tooltip");
  if (!tooltip) return;
  window.clearTimeout(tooltipTimer);
  tooltip.classList.add("hidden");
}

function friendlyError(error) {
  return error?.data?.message || error?.message || "Something went wrong.";
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
      await client.action(refs.signOut, {});
    } finally {
      clearAuthTokens();
      signedOut();
    }
  });
});
$("sphere-form").addEventListener("submit", (event) => {
  event.preventDefault();
  action(() => client.mutation(refs.launchSphereRaid, { units: validatedRaidUnits("sphere-raid-units") }));
});
$("neutral-siege-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!$("neutral-plateau-target").value) return alert("Choose a neutral plateau.");
  action(async () => {
    await client.mutation(refs.launchNeutralSiege, { plateauId: $("neutral-plateau-target").value, units: validatedRaidUnits("neutral-siege-units"), ardentiaConclave: Boolean($("neutral-conclave")?.checked) });
    $("neutral-conclave").checked = false;
  });
});
$("player-siege-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!$("player-plateau-target").value) return alert("Choose an enemy plateau.");
  action(async () => {
    await client.mutation(refs.launchPlayerSiege, { plateauId: $("player-plateau-target").value, units: validatedRaidUnits("player-siege-units"), ardentiaConclave: Boolean($("player-conclave")?.checked) });
    $("player-conclave").checked = false;
  });
});
$("plateau-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!state.plateauRun) return alert("No Plateau Run is open.");
  action(() => client.mutation(refs.joinPlateauRun, { plateauRunId: state.plateauRun.id, units: validatedRaidUnits("plateau-run-units") }));
});
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
if ($("reset-world-keep-accounts")) {
  $("reset-world-keep-accounts").addEventListener("click", async () => {
    const confirmText = window.prompt(
      'This wipes raids, sieges, Plateau Runs, messages, plateaus, and kingdom progress, but keeps login accounts and warcamp names. Type "RESET WORLD" to continue.',
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
document.querySelectorAll(".nav-button").forEach((button) => {
  button.addEventListener("click", () => {
    if (button.dataset.adminOnly === "true" && !state?.isAdmin) return;
    showView(button.dataset.view);
  });
});
if ($("mobile-menu-toggle")) {
  $("mobile-menu-toggle").addEventListener("click", (event) => {
    event.stopPropagation();
    toggleMobileMenu();
  });
}
document.addEventListener("click", (event) => {
  const nav = $("dashboard-nav");
  const toggle = $("mobile-menu-toggle");
  if (isMobileLayout() && nav?.classList.contains("open") && !nav.contains(event.target) && !toggle?.contains(event.target)) {
    closeMobileMenu();
  }
});
document.querySelectorAll("[data-view-link]").forEach((element) => {
  element.setAttribute("role", "button");
  element.setAttribute("tabindex", "0");
  element.addEventListener("click", () => {
    if (!state) return;
    showView(element.dataset.viewLink);
  });
  element.addEventListener("keydown", (event) => {
    if (!state || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    showView(element.dataset.viewLink);
  });
});
document.addEventListener("click", (event) => {
  if (!isMobileLayout()) return;
  const calculation = event.target.closest(".stat-cell[title], .outlook-cell[title]");
  if (calculation) {
    showTapTooltip(calculation.getAttribute("title"));
    return;
  }
  if (event.target.closest("button, input, select, textarea, [data-view-link], .nav-button")) return;
  const target = event.target.closest("[title]");
  if (!target) {
    hideTapTooltip();
    return;
  }
  const text = target.getAttribute("title");
  if (!text) return;
  showTapTooltip(text);
});
window.addEventListener("resize", () => {
  if (!isMobileLayout()) {
    closeMobileMenu();
    hideTapTooltip();
  }
});

if (authToken) load();
else signedOut();
setInterval(() => {
  if (authToken) load();
}, DASHBOARD_REFRESH_MS);
