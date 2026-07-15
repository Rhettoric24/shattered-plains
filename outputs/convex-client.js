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
let lastSelections = { trainUnit: "", target: "" };
let previewListenersReady = false;
let tooltipTimer = null;

const $ = (id) => document.getElementById(id);

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
  bootstrapWorld: "game:bootstrapWorld",
  getClock: "game:getClock",
  getGameConfig: "config:getGameConfig",
  getDashboard: "players:getDashboard",
  createPlayer: "players:createPlayer",
  listPlayers: "players:listPlayers",
  upgradeBuilding: "buildings:upgradeBuilding",
  trainUnit: "army:trainUnit",
  launchSphereRaid: "raids:launchSphereRaid",
  listVisibleRaids: "raids:listVisibleRaids",
  forceResolveRaid: "raids:forceResolveRaid",
  forceResolveAllRaids: "raids:forceResolveAllRaids",
  listPlateaus: "plateaus:listPlateaus",
  launchNeutralSiege: "plateaus:launchNeutralSiege",
  launchPlayerSiege: "plateaus:launchPlayerSiege",
  fortifySiege: "plateaus:fortifySiege",
  retreatSiege: "plateaus:retreatSiege",
  forceResolveSiege: "plateaus:forceResolveSiege",
  forceResolveAllSieges: "plateaus:forceResolveAllSieges",
  backfillPlateaus: "plateaus:backfillPlateaus",
  getCurrentPlateauRun: "plateauRuns:getCurrent",
  startPlateauRun: "plateauRuns:startPlateauRun",
  joinPlateauRun: "plateauRuns:joinPlateauRun",
  forceResolvePlateauRun: "plateauRuns:forceResolvePlateauRun",
  listInbox: "messages:listInbox",
  sendMessage: "messages:sendMessage",
  markInboxRead: "messages:markInboxRead",
  listEvents: "game:listEvents",
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

    if (!dashboard || !dashboard.player) {
      state = null;
      signedOut();
      showAccountMessage("This login worked, but no warcamp is attached to it. Create a new account with a warcamp, or delete this test auth account and start fresh.");
      return;
    }

    const [raids, plateaus, plateauRun, inbox] = await Promise.all([
      client.query(refs.listVisibleRaids, {}),
      client.query(refs.listPlateaus, {}),
      client.query(refs.getCurrentPlateauRun, {}),
      client.query(refs.listInbox, {}),
    ]);

    state = buildState({
      config,
      dashboard,
      players,
      raids,
      plateaus,
      plateauRun,
      inbox,
      events,
      clock,
      adminStatus,
    });
    render();
  } catch (error) {
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
  const config = {
    ...data.config,
    buildings: decorateBuildings(data.config.buildings, player.buildings),
    unlockedUnits: unlockedUnits(data.config.units, player.buildings),
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
  const watchtowerBonus = 1 + (player.buildings.watchtower || 0) * data.config.watchtowerDefensePerLevel;
  const availableStats = data.dashboard.armyStats;
  const playerRows = data.players.map((entry) => ({
    id: entry._id,
    _id: entry._id,
    name: entry.name,
    acres: entry.acres,
    homePower: entry._id === player._id ? availableStats.power * watchtowerBonus : null,
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
      buildings: player.buildings,
      buildingStats: data.dashboard.buildingStats,
      totalIncomePerDay: data.dashboard.buildingStats.totalIncomePerDay,
      totalUnits: totalUnitsOwned,
      totalAvailableUnits: totalUnitsAtHome,
      power: availableStats.power,
      homePower: availableStats.power * watchtowerBonus,
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
      subject: message.subject,
      text: message.body,
      read: Boolean(message.readAt),
      at: message.createdAt,
    })),
    unreadCount: data.inbox?.unreadCount || 0,
    isAdmin: Boolean(data.adminStatus?.isAdmin),
    adminEmail: data.adminStatus?.email || null,
    alerts: [],
    log: data.events.map((event) => ({ text: event.text, at: event.createdAt })),
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
  $("acres").textContent = number(me.acres);
  $("spheres").textContent = number(me.spheres);
  $("gemhearts").textContent = number(me.gemhearts || 0);
  $("res-acres").textContent = number(me.acres);
  $("res-spheres").textContent = number(me.spheres);
  $("res-gemhearts").textContent = number(me.gemhearts || 0);
  $("res-open-acres").textContent = number(state.openAcres);
  $("res-power").textContent = formatStat(me.power);
  $("res-available").textContent = number(me.totalAvailableUnits);
  $("income").textContent = number(me.totalIncomePerDay);
  $("income-card").title = incomeTooltip();
  $("units-total").textContent = number(me.totalUnits);
  $("available-total").textContent = number(me.totalAvailableUnits);
  $("away-total").textContent = number(sumUnits(me.unitsAway));
  $("power").textContent = formatStat(me.power);
  $("home-power").textContent = formatStat(me.homePower);
  $("open-acres").textContent = number(state.openAcres);
  renderBuildings();
  renderUnits();
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
  renderLog();
  renderOverview();
  renderWorldAlerts();
  renderAdminAccess();
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
  } else {
    alerts.push({
      kind: "schedule",
      title: "Plateau Runs",
      text: "Scheduled daily at noon and 8 PM Mountain.",
      action: "Plateau",
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
  if (!isAdmin && currentView === "testing") {
    currentView = "overview";
  }
}

function captureSelections() {
  if ($("target")) lastSelections.target = $("target").value;
  if ($("neutral-plateau-target")) lastSelections.neutralPlateau = $("neutral-plateau-target").value;
  if ($("player-plateau-target")) lastSelections.playerPlateau = $("player-plateau-target").value;
}

function showView(view) {
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
}

function renderBuildings() {
  $("buildings").innerHTML = Object.entries(state.config.buildings).map(([key, building]) => {
    const level = state.me.buildings[key] || building.level || 0;
    return '<article class="upgrade-card"><div><strong>' + escapeHtml(building?.name || key) + '</strong><span>Level ' + level + '</span><small>' + escapeHtml(building?.description || "") + '</small></div><button data-building="' + key + '">Upgrade: ' + number(building?.nextCost || 0) + '</button></article>';
  }).join("");
  document.querySelectorAll("[data-building]").forEach((button) => {
    button.addEventListener("click", () => action(() => client.mutation(refs.upgradeBuilding, { building: button.dataset.building })));
  });
}

function renderUnits() {
  $("unit-roster").innerHTML = activeUnitEntries().map(([key, unit]) => {
    const unlocked = Boolean(state.config.unlockedUnits[key]);
    const count = state.me.units[key] || 0;
    const available = state.me.availableUnits[key] || 0;
    const costText = unit.gemheartCost ? "Cost " + unit.gemheartCost + " Gemheart" : "Cost " + unit.cost + " spheres";
    const buttons = [1, 10, 50, 100].map((amount) => {
      return '<button type="button" data-train-unit="' + key + '" data-train-count="' + amount + '"' + (unlocked ? "" : " disabled") + '>' + amount + '</button>';
    }).join("");
    return '<article class="upgrade-card unit-card ' + (unlocked ? "" : "locked") + '" title="' + unitStatsTooltip(unit) + '"><div><strong>' + escapeHtml(unit.name) + '</strong><span>' + escapeHtml(unit.role || "") + '</span><small>' + escapeHtml(costText) + '</small><small>Owned: ' + number(count) + '</small><small>Ready: ' + number(available) + '</small></div><div class="train-buttons">' + buttons + '</div></article>';
  }).join("");
  document.querySelectorAll("[data-train-unit]").forEach((button) => {
    button.addEventListener("click", () => {
      action(() => client.mutation(refs.trainUnit, {
        unit: button.dataset.trainUnit,
        count: Number(button.dataset.trainCount),
      }));
    });
  });
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
  const currentValues = {};
  container.querySelectorAll("input[data-unit]").forEach((input) => {
    currentValues[input.dataset.unit] = input.value;
  });
  container.innerHTML = Object.entries(state.config.unlockedUnits).map(([key, unit]) => {
    const available = state.me.availableUnits[key] || 0;
    const existing = currentValues[key] || "0";
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
  previewListenersReady = true;
}

function renderRaidPreviews() {
  if (!state) return;
  $("sphere-raid-preview").innerHTML = previewMarkup(readRaidUnits("sphere-raid-units"), 0, "spheres");
  $("neutral-siege-preview").innerHTML = previewMarkup(readRaidUnits("neutral-siege-units"), 0, "neutralSiege");
  $("player-siege-preview").innerHTML = previewMarkup(readRaidUnits("player-siege-units"), 0, "playerSiege");
  $("plateau-run-preview").innerHTML = previewMarkup(readRaidUnits("plateau-run-units"), 0, "plateau");
}

function previewMarkup(units, acres, type) {
  const stats = raidStats(units);
  const travel = travelMinutes(stats.speed);
  const arrival = new Date(Date.now() + travel * 60000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const target = type === "spheres" ? sphereTargetPreview() : type === "plateau" ? plateauTargetPreview(stats) : type === "neutralSiege" ? neutralSiegePreview(stats) : type === "playerSiege" ? playerSiegePreview(stats) : "Choose a target";
  return '<div title="' + statTooltip("power") + '"><span>Power</span><strong>' + formatStat(stats.power) + '</strong></div>' +
    '<div title="' + statTooltip("speed") + '"><span>Army Speed</span><strong>' + formatStat(stats.speed) + '</strong></div>' +
    '<div><span>Travel</span><strong>' + formatDuration(travel) + '</strong></div>' +
    '<div><span>Arrival</span><strong>' + arrival + '</strong></div>' +
    '<div title="' + statTooltip("plunder") + '"><span>Max Plunder</span><strong>' + number(stats.plunder) + '</strong></div>' +
    '<div title="' + escapeHtml(stats.survivalDetails) + '"><span>Survival</span><strong>' + escapeHtml(stats.survivalLabel) + '</strong></div>' +
    '<div class="preview-wide"><span>Target check</span><strong>' + escapeHtml(target) + '</strong></div>';
}

function sphereTargetPreview() {
  const averageDefense = (configValue("parshendiSphereRaidMinDefense", 4) + configValue("parshendiSphereRaidMaxDefense", 16)) / 2;
  const averageReward = (configValue("parshendiSphereRaidMinReward", 250) + configValue("parshendiSphereRaidMaxReward", 650)) / 2;
  return "Parshendi stores look " + neutralDefenseLabel(averageDefense) + " with " + plateauRunLootLabel(averageReward) + " loot.";
}

function plateauTargetPreview(stats) {
  if (!state.plateauRun) return "No plateau run is open";
  const participantCount = state.plateauRun.participants.length;
  const bonus = state.config.plateauRuns.joinOrderSpeedBonuses[participantCount] || 0;
  const speedScore = stats.speed * (1 + bonus);
  return "Difficulty " + plateauRunDifficultyLabel(state.plateauRun.difficultyPower) + ", loot " + plateauRunLootLabel(state.plateauRun.spherePool) + ". Your speed score " + formatStat(speedScore) + " with " + Math.round(bonus * 100) + "% join bonus";
}

function neutralSiegePreview(stats) {
  const target = state.plateaus.neutral.find((plateau) => plateau.id === $("neutral-plateau-target").value);
  if (!target) return "Choose a neutral plateau";
  return "Parshendi hold looks " + neutralDefenseLabel(target.neutralDefenseRemaining) + ". Your power " + formatStat(stats.power) + ".";
}

function playerSiegePreview(stats) {
  const target = state.plateaus.rivals.find((plateau) => plateau.id === $("player-plateau-target").value);
  if (!target) return "Choose an enemy plateau";
  const highground = target.highground ? " Highground terrain observed." : "";
  return target.ownerName + " holds " + target.name + "." + highground + " Your power " + formatStat(stats.power) + ".";
}

function renderRaids() {
  const outgoing = state.raids.filter((raid) => raid.attackerId === state.me.id);
  const incoming = state.raids.filter((raid) => raid.targetId === state.me.id);
  const world = state.raids.filter((raid) => raid.attackerId !== state.me.id && raid.targetId !== state.me.id);
  $("outgoing-queue").innerHTML = raidListMarkup(outgoing, "No outgoing raids.");
  $("incoming-queue").innerHTML = raidListMarkup(incoming, "No incoming raids.");
  $("world-queue").innerHTML = raidListMarkup(world, "No other visible raids.");
  $("queue").innerHTML = raidListMarkup(state.raids, "No visible pending raids.");
}

function renderPlateaus() {
  if (!$("owned-plateaus")) return;
  $("owned-plateaus").innerHTML = state.plateaus.mine.length ? state.plateaus.mine.map(plateauCard).join("") : '<div class="empty">No owned plateaus yet.</div>';
  renderRaidPreviews();
  $("active-sieges").innerHTML = state.plateaus.sieges.length ? state.plateaus.sieges.map(siegeCard).join("") : '<div class="empty">No active plateau sieges.</div>';

  document.querySelectorAll("[data-retreat-siege]").forEach((button) => {
    button.addEventListener("click", () => action(() => client.mutation(refs.retreatSiege, { siegeId: button.dataset.retreatSiege })));
  });
  document.querySelectorAll("[data-fortify-siege]").forEach((button) => {
    button.addEventListener("click", () => {
      const input = document.querySelector('[data-fortify-input="' + button.dataset.fortifySiege + '"]');
      const percent = Math.max(1, Math.floor(Number(input?.value) || 1));
      action(() => client.mutation(refs.fortifySiege, { siegeId: button.dataset.fortifySiege, percent }));
    });
  });
}

function plateauCard(plateau) {
  const trait = plateau.highground ? "Highground" : "Standard ground";
  return '<article class="plateau-holding-card" title="' + plateauTooltip(plateau) + '"><strong>' + escapeHtml(plateau.name) + '</strong><span>' + escapeHtml(plateau.typeName) + '</span><small>' + escapeHtml(trait) + '</small></article>';
}

function siegeCard(siege) {
  const plateau = state.plateaus.byId[siege.plateauId];
  const remaining = Math.max(0, Math.ceil((siege.resolveAt - Date.now()) / 60000));
  const isAttacker = siege.attackerId === state.me.id;
  const isDefender = siege.defenderId === state.me.id;
  const powerText = isAttacker
    ? "Attacker power " + formatStat(siege.attackerPower)
    : "Attacker force " + operationPowerLabel(siege.attackerPower);
  const fortifyText = isDefender || isAttacker
    ? ", fortification +" + number(siege.fortifyPercent) + "%"
    : ", defenses " + neutralDefenseLabel(siege.fortifyPercent + 25);
  const fortify = isDefender && siege.targetType === "player"
    ? '<div class="inline-actions"><input data-fortify-input="' + siege.id + '" type="number" min="1" max="100" value="5" /><button type="button" data-fortify-siege="' + siege.id + '">Fortify</button></div>'
    : "";
  const retreat = isAttacker || isDefender
    ? '<button type="button" class="secondary" data-retreat-siege="' + siege.id + '">Retreat</button>'
    : "";
  return '<article class="list-item raid-item"><strong>' + escapeHtml(siege.attackerName) + ' vs ' + escapeHtml(siege.defenderName) + '</strong><span>' + escapeHtml(plateau?.name || "Unknown plateau") + '</span><small>' + powerText + fortifyText + ', resolves in ' + formatDuration(remaining) + '.</small>' + fortify + retreat + '</article>';
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
    return '<article class="list-item raid-item ' + direction.toLowerCase() + '"><strong>' + direction + ':</strong> ' + escapeHtml(raid.attackerName) + ' to <strong>' + escapeHtml(raid.targetName) + '</strong><span>' + force + '</span><small>' + details + ' Arrives ' + arrival + ' (' + formatDuration(remaining) + ' left).</small></article>';
  }).join("") : '<div class="empty">' + emptyText + '</div>';
}

function renderPlateau() {
  const status = $("plateau-status");
  const participants = $("plateau-participants");
  if (!status || !participants) return;
  const run = state.plateauRun;
  if (!run) {
    status.innerHTML = '<div class="empty">No active plateau run.</div>';
    participants.innerHTML = '<div class="empty">No committed warcamps.</div>';
    return;
  }
  const remaining = Math.max(0, Math.ceil((run.joinUntil - Date.now()) / 60000));
  status.innerHTML = '<div class="plateau-card"><strong>Join window open</strong><span>' + formatDuration(remaining) + ' left</span><small>Difficulty ' + plateauRunDifficultyLabel(run.difficultyPower) + '. Loot: ' + number(run.gemheartReward) + ' Gemheart and a ' + plateauRunLootLabel(run.spherePool) + ' sphere pool.</small></div>';
  participants.innerHTML = run.participants.length ? run.participants.map((entry) => {
    const bonus = entry.joinOrderSpeedBonus ? " +" + Math.round(entry.joinOrderSpeedBonus * 100) + "% join speed" : "";
    const isMine = entry.playerId === state.me.id;
    const forceText = isMine
      ? escapeHtml(entry.unitSummary)
      : "Committed force appears " + operationPowerLabel(entry.power);
    const detailText = isMine
      ? "Power " + formatStat(entry.power) + ", speed " + formatStat(entry.speed) + ", speed score " + formatStat(entry.speedScore)
      : "Estimated strength " + operationPowerLabel(entry.power) + ", pace " + operationSpeedLabel(entry.speedScore);
    return '<article class="list-item"><strong>' + escapeHtml(entry.playerName) + '</strong><span>' + forceText + '</span><small>' + detailText + bonus + ', joined #' + entry.joinOrder + '.</small></article>';
  }).join("") : '<div class="empty">No committed warcamps yet.</div>';
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
  const inbox = state.inbox || [];
  list.innerHTML = inbox.length ? inbox.map((message) => {
    const from = message.fromPlayerId ? playerName(message.fromPlayerId) : "System";
    const readClass = message.read ? "read" : "unread";
    return '<article class="list-item message-item ' + readClass + '"><strong>' + escapeHtml(message.subject) + '</strong><span>' + escapeHtml(message.text) + '</span><small>' + escapeHtml(from) + ' | ' + new Date(message.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) + '</small></article>';
  }).join("") : '<div class="empty">No messages yet.</div>';
}

function renderLog() {
  const markup = state.log.map((entry) => {
    return '<article class="list-item">' + escapeHtml(entry.text) + '<small>' + new Date(entry.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) + '</small></article>';
  }).join("");
  $("log").innerHTML = markup || '<div class="empty">No events yet.</div>';
}

function renderOverview() {
  $("overview-units").innerHTML = activeUnitEntries().map(([key, unit]) => {
    const count = state.me.units[key] || 0;
    const available = state.me.availableUnits[key] || 0;
    return '<div><span>' + escapeHtml(unit.name) + '</span><strong>' + number(available) + '/' + number(count) + '</strong></div>';
  }).join("");
  $("overview-buildings").innerHTML = Object.entries(state.me.buildings).map(([key, level]) => {
    const building = state.config.buildings[key];
    return '<div><span>' + escapeHtml(building?.name || key) + '</span><strong>Level ' + level + '</strong></div>';
  }).join("");
  $("overview-raids").innerHTML = state.raids.length ? state.raids.slice(0, 3).map((raid) => {
    const label = raid.attackerId === state.me.id ? "Outgoing to " + raid.targetName : raid.targetId === state.me.id ? "Incoming from " + raid.attackerName : raid.attackerName + " to " + raid.targetName;
    return '<div><span>' + escapeHtml(label) + '</span><strong>' + formatDuration(Math.max(0, Math.ceil((raid.arrivalAt - Date.now()) / 60000))) + '</strong></div>';
  }).join("") : '<div><span>Pending raids</span><strong>None</strong></div>';
}

function activeUnitEntries() {
  return Object.entries(state.config.units).filter(([, unit]) => unit.active !== false);
}

function unitStatsTooltip(unit) {
  return escapeHtml(
    "Power: " + formatStat(unit.power) + " - " + statTooltip("power") + "\n" +
    "Speed: " + formatStat(unit.speed) + " - " + statTooltip("speed") + "\n" +
    "Plunder: " + formatStat(unit.plunder || 0) + " - " + statTooltip("plunder") + "\n" +
    "Survival: " + formatPercent(unit.survival || 0) + " - " + statTooltip("survival")
  );
}

function incomeTooltip() {
  const stats = state.me.buildingStats || {};
  return [
    number(stats.marketIncomePerDay || 0) + "/day - Markets",
    number(stats.acreIncomePerDay || stats.plateauIncomePerDay || 0) + "/day - Plateaus",
  ].join("\n");
}

function plateauTooltip(plateau) {
  const effects = [];
  if (plateau.type === "sphere") effects.push("Generates 150 spheres per game day before duplicate reductions.");
  if (plateau.type === "training") effects.push("Reduces training costs through land bonuses.");
  if (plateau.type === "gemheart") effects.push("Grants 1 Gemheart every 12 real hours if held.");
  if (plateau.type === "ancient_ruins") effects.push("Future research boost. Dormant for now.");
  if (plateau.highground) effects.push("Highground: +20% defense when this plateau is attacked.");
  if (!effects.length) effects.push("No special effect yet.");
  return escapeHtml(effects.join("\n"));
}

function neutralDefenseLabel(power) {
  if (power <= 25) return "Vulnerable";
  if (power <= 55) return "Guarded";
  if (power <= 90) return "Defended";
  if (power <= 140) return "Fortified";
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

function externalDefenseText(raid) {
  if (!raid.defensePower) return "";
  return ", opposition " + neutralDefenseLabel(raid.defensePower);
}

function plateauRunDifficultyLabel(power) {
  if (power <= 100) return "Manageable";
  if (power <= 180) return "Dangerous";
  if (power <= 280) return "Brutal";
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
    await work();
    await load();
  } catch (error) {
    alert(friendlyError(error));
  }
}

function decorateBuildings(rules, levels) {
  return Object.fromEntries(Object.entries(rules).map(([key, rule]) => {
    const level = levels[key] || 0;
    return [key, { ...rule, level, nextCost: rule.baseCost * (level + 1) }];
  }));
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
    training: "Training Plateau",
    gemheart: "Gemheart Plateau",
    ancient_ruins: "Ancient Ruins",
  };
  const decorate = (plateau, visible = true) => ({
    id: plateau._id,
    name: visible ? plateau.name : "Unclaimed Plateau",
    type: visible ? plateau.type : "unknown",
    typeName: visible ? (typeNames[plateau.type] || plateau.type) : "Unknown reward",
    ownerName: plateau.ownerName || "Neutral",
    ownerPlayerId: plateau.ownerPlayerId || null,
    highground: Boolean(plateau.highground),
    neutralDefenseRemaining: plateau.neutralDefenseRemaining || 0,
    activeSiegeId: plateau.activeSiegeId || null,
  });
  const mine = (plateaus?.mine || []).map((plateau) => decorate(plateau, true));
  const neutral = (plateaus?.neutral || []).map((plateau, index) => ({
    ...decorate(plateau, false),
    label: "Neutral Plateau " + (index + 1) + " - " + neutralDefenseLabel(plateau.neutralDefenseRemaining || 0),
    neutralDefenseRemaining: plateau.neutralDefenseRemaining || 0,
  }));
  const rivals = (plateaus?.rivals || []).map((plateau) => decorate(plateau, true));
  const all = [...mine, ...neutral, ...rivals];
  const byId = Object.fromEntries(all.map((plateau) => [plateau.id, plateau]));

  return {
    counts: plateaus?.counts || {},
    mine,
    neutral,
    rivals,
    byId,
    sieges: (plateaus?.sieges || []).map((siege) => ({
      id: siege._id,
      plateauId: siege.plateauId,
      attackerId: siege.attackerId,
      defenderId: siege.defenderId || null,
      targetType: siege.targetType,
      attackerName: siege.attackerName,
      defenderName: siege.defenderName,
      attackerUnits: siege.attackerUnits,
      unitSummary: unitSummary(siege.attackerUnits, unitsConfig),
      attackerPower: siege.attackerPower,
      attackerSpeed: siege.attackerSpeed,
      fortifyPercent: siege.fortifyPercent,
      resolveAt: siege.resolveAt,
    })),
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
      playerId: entry.playerId,
      playerName: entry.playerName,
      unitSummary: unitSummary(entry.units, unitsConfig),
      power: entry.power,
      speed: entry.speed,
      speedScore: entry.speedScore,
      joinOrder: entry.joinOrder,
      joinOrderSpeedBonus: entry.joinOrderSpeedBonus,
    })),
  };
}

function unitSummary(units, unitsConfig) {
  const parts = Object.entries(units)
    .filter(([, count]) => count > 0)
    .map(([key, count]) => number(count) + " " + (unitsConfig[key]?.name || key));
  return parts.length ? parts.join(", ") : "No units";
}

function raidStats(units) {
  const stats = Object.entries(units).reduce((total, [key, count]) => {
    const unit = state.config.units[key];
    if (!unit) return total;
    total.power += count * unit.power;
    total.weightedSpeed += count * unit.speed;
    total.quantityPressure += count * (unit.speed - configValue("speedNeutralPoint", 4)) * configValue("speedQuantityFactor", 1 / 60);
    total.plunder += count * (unit.plunder || 0);
    total.total += count;
    if (count > 0) {
      total.included.push({ key, unit });
    }
    return total;
  }, { power: 0, weightedSpeed: 0, quantityPressure: 0, speed: 0, plunder: 0, total: 0, included: [] });
  stats.speed = stats.total ? stats.weightedSpeed / stats.total + stats.quantityPressure : 0;
  if ((units.shardbearer || 0) > 0) stats.power *= 2;
  const survival = survivalProfile(stats.included);
  stats.survivalLabel = survival.label;
  stats.survivalDetails = survival.details;
  return stats;
}

function travelMinutes(speed) {
  const base = configValue("raidTravelGameDays", 1) * configValue("realMsPerGameDay", 3600000);
  const effectiveSpeed = Math.max(
    -configValue("maxTravelPenaltyPercent", 50),
    Math.min(speed, configValue("maxTravelReductionPercent", 50)),
  );
  const multiplier = effectiveSpeed >= 0
    ? 1 - effectiveSpeed / 100
    : 1 + Math.abs(effectiveSpeed) / 100;
  return Math.ceil((base * multiplier) / 60000);
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
  return Math.floor(Number(value) || 0).toLocaleString();
}

function configValue(key, fallback) {
  return Number.isFinite(Number(state.config[key])) ? Number(state.config[key]) : fallback;
}

function formatStat(value) {
  return Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatPercent(value) {
  return ((Number(value || 0) * 100).toLocaleString(undefined, { maximumFractionDigits: 1 })) + "%";
}

function survivalProfile(included) {
  if (!included.length) return { label: "None", details: "No units selected." };
  const lowest = Math.min(...included.map((entry) => Number(entry.unit.survival || 0)));
  const label =
    lowest >= 0.995
      ? "Exceptional"
      : lowest >= 0.97
        ? "Durable"
        : lowest >= 0.93
          ? "Steady"
          : lowest >= 0.8
            ? "Risky"
            : "Fragile";
  const details = included.map((entry) => entry.unit.name + ": " + formatPercent(entry.unit.survival || 0)).join(", ");
  return { label, details };
}

function statTooltip(stat) {
  const tips = {
    power: "Power determines the winner of combat. Armies with at least one Shardbearer have total Power doubled once.",
    speed: "Speed changes travel time. Army Speed uses average unit speed plus quantity pressure: many fast units speed travel up, while many slow units can slow it down. Travel reduction and penalty are capped.",
    plunder: "Plunder is the maximum number of spheres this army can recover from sphere rewards.",
    survival: "Survival is a unit's chance to survive when exposed to casualties. Power decides victory; Survival decides cost.",
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
  action(() => client.mutation(refs.launchSphereRaid, { units: readRaidUnits("sphere-raid-units") }));
});
$("neutral-siege-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!$("neutral-plateau-target").value) return alert("Choose a neutral plateau.");
  action(() => client.mutation(refs.launchNeutralSiege, { plateauId: $("neutral-plateau-target").value, units: readRaidUnits("neutral-siege-units") }));
});
$("player-siege-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!$("player-plateau-target").value) return alert("Choose an enemy plateau.");
  action(() => client.mutation(refs.launchPlayerSiege, { plateauId: $("player-plateau-target").value, units: readRaidUnits("player-siege-units") }));
});
$("plateau-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!state.plateauRun) return alert("No Plateau Run is open.");
  action(() => client.mutation(refs.joinPlateauRun, { plateauRunId: state.plateauRun.id, units: readRaidUnits("plateau-run-units") }));
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
  });
});
$("mark-inbox-read").addEventListener("click", () => action(() => client.mutation(refs.markInboxRead, {})));
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
$("backfill-plateaus").addEventListener("click", () => action(() => client.mutation(refs.backfillPlateaus, {})));
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
