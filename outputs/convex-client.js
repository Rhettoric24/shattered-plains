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
  launchOpenAcreRaid: "raids:launchOpenAcreRaid",
  launchSphereRaid: "raids:launchSphereRaid",
  launchPlayerRaid: "raids:launchPlayerRaid",
  listVisibleRaids: "raids:listVisibleRaids",
  forceResolveRaid: "raids:forceResolveRaid",
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

    const [raids, plateauRun, inbox] = await Promise.all([
      client.query(refs.listVisibleRaids, {}),
      client.query(refs.getCurrentPlateauRun, {}),
      client.query(refs.listInbox, {}),
    ]);

    state = buildState({
      config,
      dashboard,
      players,
      raids,
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
  const config = {
    ...data.config,
    buildings: decorateBuildings(data.config.buildings, player.buildings),
    unlockedUnits: unlockedUnits(data.config.units, player.buildings),
  };
  const outgoingRaids = data.raids.filter((raid) => raid.attackerId === player._id);
  const plateauAway =
    data.plateauRun?.commitments.find((entry) => entry.playerId === player._id)
      ?.units || emptyUnits();
  const unitsAway = addUnitObjects(
    outgoingRaids.reduce((total, raid) => addUnitObjects(total, raid.units), emptyUnits()),
    plateauAway,
  );
  const totalUnitsAtHome = sumUnits(player.units);
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
      acres: player.acres,
      spheres: data.dashboard.effectiveSpheres,
      gemhearts: player.gemhearts,
      units: player.units,
      availableUnits: player.units,
      unitsAway,
      buildings: player.buildings,
      totalIncomePerDay: data.dashboard.buildingStats.totalIncomePerDay,
      totalUnits: totalUnitsOwned,
      totalAvailableUnits: totalUnitsAtHome,
      power: availableStats.power,
      homePower: availableStats.power * watchtowerBonus,
    },
    players: playerRows,
    playerMap: Object.fromEntries(playerRows.map((entry) => [entry.id, entry])),
    openAcres: data.dashboard.world?.openAcres || 0,
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
  renderRaidUnitInputs("open-raid-units");
  renderRaidUnitInputs("sphere-raid-units");
  renderRaidUnitInputs("player-raid-units");
  renderRaidUnitInputs("plateau-run-units");
  attachPreviewListeners();
  renderRaidPreviews();
  renderRaids();
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

  if (state.plateauRun) {
    const remaining = Math.max(0, Math.ceil((state.plateauRun.joinUntil - Date.now()) / 60000));
    alerts.push({
      kind: "critical",
      title: "Plateau Run Open",
      text: formatDuration(remaining) + " left to join. Difficulty " + number(state.plateauRun.difficultyPower) + ", reward " + number(state.plateauRun.gemheartReward) + " Gemheart.",
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
  if ($("train-unit")) lastSelections.trainUnit = $("train-unit").value;
  if ($("target")) lastSelections.target = $("target").value;
}

function showView(view) {
  currentView = view;
  localStorage.setItem("sp-current-view", view);
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
    return '<article class="upgrade-card"><div><strong>' + escapeHtml(building.name) + '</strong><span>Level ' + level + '</span><small>' + escapeHtml(building.description) + '</small></div><button data-building="' + key + '">Upgrade: ' + number(building.nextCost || 0) + '</button></article>';
  }).join("");
  document.querySelectorAll("[data-building]").forEach((button) => {
    button.addEventListener("click", () => action(() => client.mutation(refs.upgradeBuilding, { building: button.dataset.building })));
  });
}

function renderUnits() {
  $("unit-roster").innerHTML = Object.entries(state.config.units).map(([key, unit]) => {
    const unlocked = Boolean(state.config.unlockedUnits[key]);
    const count = state.me.units[key] || 0;
    const available = state.me.availableUnits[key] || 0;
    const requirement = unit.barracksLevel === 0 ? "Unlocked" : "Requires Barracks " + unit.barracksLevel;
    const costText = unit.gemheartCost ? "Cost " + unit.gemheartCost + " Gemheart" : "Cost " + unit.cost + " spheres";
    const description = unit.description ? " " + unit.description : "";
    return '<article class="upgrade-card ' + (unlocked ? "" : "locked") + '"><div><strong>' + escapeHtml(unit.name) + '</strong><span>' + number(count) + ' owned, ' + number(available) + ' ready</span><small>Power ' + formatStat(unit.power) + ', Speed ' + formatStat(unit.speed) + ', ' + costText + '. ' + requirement + '.' + escapeHtml(description) + '</small></div></article>';
  }).join("");
}

function renderSelects() {
  const options = Object.entries(state.config.unlockedUnits).map(([key, unit]) => {
    return '<option value="' + key + '">' + escapeHtml(unit.name) + '</option>';
  }).join("");
  $("train-unit").innerHTML = options;
  if (lastSelections.trainUnit && state.config.unlockedUnits[lastSelections.trainUnit]) $("train-unit").value = lastSelections.trainUnit;

  const targets = state.players.filter((player) => player.id !== state.me.id);
  $("target").innerHTML = targets.map((player) => {
    return '<option value="' + player.id + '">' + escapeHtml(player.name) + '</option>';
  }).join("");
  if (lastSelections.target && targets.some((player) => player.id === lastSelections.target)) $("target").value = lastSelections.target;
  if ($("message-target")) {
    $("message-target").innerHTML = targets.map((player) => {
      return '<option value="' + player.id + '">' + escapeHtml(player.name) + '</option>';
    }).join("");
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
    return '<label class="unit-input"><span>' + escapeHtml(unit.name) + '<small>Ready ' + number(available) + ' | P ' + formatStat(unit.power) + ' | S ' + formatStat(unit.speed) + '</small></span><input data-unit="' + key + '" type="number" min="0" max="' + available + '" value="' + existing + '"></label>';
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
  ["open-raid-units", "sphere-raid-units", "player-raid-units", "plateau-run-units"].forEach((containerId) => {
    $(containerId).addEventListener("input", renderRaidPreviews);
  });
  ["open-raid-acres", "player-raid-acres", "target"].forEach((id) => {
    if (!$(id)) return;
    $(id).addEventListener("input", renderRaidPreviews);
    $(id).addEventListener("change", renderRaidPreviews);
  });
  previewListenersReady = true;
}

function renderRaidPreviews() {
  if (!state) return;
  $("open-raid-preview").innerHTML = previewMarkup(readRaidUnits("open-raid-units"), num("open-raid-acres"), "open");
  $("sphere-raid-preview").innerHTML = previewMarkup(readRaidUnits("sphere-raid-units"), 0, "spheres");
  $("player-raid-preview").innerHTML = previewMarkup(readRaidUnits("player-raid-units"), num("player-raid-acres"), "player");
  $("plateau-run-preview").innerHTML = previewMarkup(readRaidUnits("plateau-run-units"), 0, "plateau");
}

function previewMarkup(units, acres, type) {
  const stats = raidStats(units);
  const travel = travelMinutes(stats.speed);
  const arrival = new Date(Date.now() + travel * 60000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const target = type === "open" ? openTargetPreview(acres) : type === "spheres" ? sphereTargetPreview() : type === "plateau" ? plateauTargetPreview(stats) : playerTargetPreview(acres);
  return '<div><span>Power</span><strong>' + formatStat(stats.power) + '</strong></div>' +
    '<div><span>Speed</span><strong>' + formatStat(stats.speed) + '</strong></div>' +
    '<div><span>Travel</span><strong>' + formatDuration(travel) + '</strong></div>' +
    '<div><span>Arrival</span><strong>' + arrival + '</strong></div>' +
    '<div class="preview-wide"><span>Target check</span><strong>' + escapeHtml(target) + '</strong></div>';
}

function openTargetPreview(acres) {
  const defense = configValue("openDefenseBase", 3) + acres * configValue("openDefensePerAcre", 0.9);
  return "Open defense about " + Math.ceil(defense) + " power";
}

function sphereTargetPreview() {
  return "Random Parshendi defense " + configValue("parshendiSphereRaidMinDefense", 4) + "-" + configValue("parshendiSphereRaidMaxDefense", 16) + ", reward " + configValue("parshendiSphereRaidMinReward", 250) + "-" + configValue("parshendiSphereRaidMaxReward", 650) + " spheres";
}

function plateauTargetPreview(stats) {
  if (!state.plateauRun) return "No plateau run is open";
  const participantCount = state.plateauRun.participants.length;
  const bonus = state.config.plateauRuns.joinOrderSpeedBonuses[participantCount] || 0;
  const speedScore = stats.speed * (1 + bonus);
  return "Difficulty " + number(state.plateauRun.difficultyPower) + ", your speed score " + formatStat(speedScore) + " with " + Math.round(bonus * 100) + "% join bonus";
}

function playerTargetPreview(acres) {
  const target = state.players.find((player) => player.id === $("target").value);
  if (!target) return "Choose a rival account";
  const possibleAcres = Math.min(acres, Math.max(0, target.acres - 1));
  return target.name + " can lose up to " + number(possibleAcres) + " acres";
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

function raidListMarkup(raids, emptyText) {
  return raids.length ? raids.map((raid) => {
    const arrival = new Date(raid.arrivalAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const remaining = Math.max(0, Math.ceil((raid.arrivalAt - Date.now()) / 60000));
    const direction = raid.attackerId === state.me.id ? "Outgoing" : raid.targetId === state.me.id ? "Incoming" : "Observed";
    const prize = raid.targetType === "parshendi_spheres" ? "possible " + number(raid.rewardSpheres || 0) + " spheres" : number(raid.acres || 0) + " acres";
    const defense = raid.defensePower ? ", defense " + raid.defensePower : "";
    return '<article class="list-item raid-item ' + direction.toLowerCase() + '"><strong>' + direction + ':</strong> ' + escapeHtml(raid.attackerName) + ' to <strong>' + escapeHtml(raid.targetName) + '</strong><span>' + escapeHtml(raid.unitSummary) + ' for ' + prize + '</span><small>Power ' + formatStat(raid.power) + ', Speed ' + formatStat(raid.speed) + defense + ', travel ' + formatDuration(raid.travelMinutes) + '. Arrives ' + arrival + ' (' + formatDuration(remaining) + ' left).</small></article>';
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
  status.innerHTML = '<div class="plateau-card"><strong>Join window open</strong><span>' + formatDuration(remaining) + ' left</span><small>Difficulty ' + number(run.difficultyPower) + '. Reward: ' + number(run.gemheartReward) + ' Gemheart and a ' + number(run.spherePool) + ' sphere pool.</small></div>';
  participants.innerHTML = run.participants.length ? run.participants.map((entry) => {
    const bonus = entry.joinOrderSpeedBonus ? " +" + Math.round(entry.joinOrderSpeedBonus * 100) + "% join speed" : "";
    return '<article class="list-item"><strong>' + escapeHtml(entry.playerName) + '</strong><span>' + escapeHtml(entry.unitSummary) + '</span><small>Power ' + formatStat(entry.power) + ', speed ' + formatStat(entry.speed) + ', speed score ' + formatStat(entry.speedScore) + bonus + ', joined #' + entry.joinOrder + '.</small></article>';
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
  $("overview-units").innerHTML = Object.entries(state.me.units).map(([key, count]) => {
    const unit = state.config.units[key];
    return '<div><span>' + escapeHtml(unit.name) + '</span><strong>' + number(count) + '</strong></div>';
  }).join("");
  $("overview-buildings").innerHTML = Object.entries(state.me.buildings).map(([key, level]) => {
    const building = state.config.buildings[key];
    return '<div><span>' + escapeHtml(building.name) + '</span><strong>Level ' + level + '</strong></div>';
  }).join("");
  $("overview-raids").innerHTML = state.raids.length ? state.raids.slice(0, 3).map((raid) => {
    const label = raid.attackerId === state.me.id ? "Outgoing to " + raid.targetName : raid.targetId === state.me.id ? "Incoming from " + raid.attackerName : raid.attackerName + " to " + raid.targetName;
    return '<div><span>' + escapeHtml(label) + '</span><strong>' + formatDuration(Math.max(0, Math.ceil((raid.arrivalAt - Date.now()) / 60000))) + '</strong></div>';
  }).join("") : '<div><span>Pending raids</span><strong>None</strong></div>';
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
    return (buildings.barracks || 0) >= rule.barracksLevel;
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

function decoratePlateauRun(plateauRun, unitsConfig) {
  if (!plateauRun) return null;
  return {
    id: plateauRun.run._id,
    joinUntil: plateauRun.run.closesAt,
    difficultyPower: plateauRun.run.difficulty,
    spherePool: plateauRun.run.spherePool,
    gemheartReward: plateauRun.run.gemheartReward,
    participants: plateauRun.commitments.map((entry) => ({
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
    total.power += count * unit.power;
    total.speed += count * unit.speed;
    total.total += count;
    return total;
  }, { power: 0, speed: 0, total: 0 });
  if ((units.shardbearer || 0) > 0) stats.power *= 2;
  return stats;
}

function travelMinutes(speed) {
  const base = configValue("raidTravelGameDays", 1) * configValue("realMsPerGameDay", 3600000);
  const effectiveSpeed = Math.max(0, speed);
  return Math.ceil((base / (1 + effectiveSpeed * configValue("speedReductionPerPoint", 0.01))) / 60000);
}

function playerName(id) {
  return state.playerMap[id]?.name || "Unknown";
}

function emptyUnits() {
  return { bridgeman: 0, spearman: 0, scout: 0, heavy: 0, shardbearer: 0 };
}

function addUnitObjects(left, right) {
  const next = { ...left };
  Object.keys(next).forEach((key) => {
    next[key] += right[key] || 0;
  });
  return next;
}

function num(id) {
  return Math.max(0, Math.floor(Number($(id).value) || 0));
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
$("train-form").addEventListener("submit", (event) => {
  event.preventDefault();
  action(() => client.mutation(refs.trainUnit, { unit: $("train-unit").value, count: num("train-count") }));
});
$("open-form").addEventListener("submit", (event) => {
  event.preventDefault();
  action(() => client.mutation(refs.launchOpenAcreRaid, { units: readRaidUnits("open-raid-units"), acres: num("open-raid-acres") }));
});
$("sphere-form").addEventListener("submit", (event) => {
  event.preventDefault();
  action(() => client.mutation(refs.launchSphereRaid, { units: readRaidUnits("sphere-raid-units") }));
});
$("player-form").addEventListener("submit", (event) => {
  event.preventDefault();
  action(() => client.mutation(refs.launchPlayerRaid, { targetPlayerId: $("target").value, units: readRaidUnits("player-raid-units"), acres: num("player-raid-acres") }));
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
  const visiblePendingRaids = state.raids.filter((raid) => raid.attackerId === state.me.id || raid.targetId === state.me.id);
  if (!visiblePendingRaids.length) return alert("No visible personal raids to finish.");
  action(async () => {
    for (const raid of visiblePendingRaids) {
      await client.mutation(refs.forceResolveRaid, { raidId: raid.id });
    }
  });
});
$("start-plateau").addEventListener("click", () => action(() => client.mutation(refs.startPlateauRun, {})));
$("finish-plateau").addEventListener("click", () => {
  if (!state.plateauRun) return alert("No Plateau Run is open.");
  action(() => client.mutation(refs.forceResolvePlateauRun, { plateauRunId: state.plateauRun.id }));
});
document.querySelectorAll(".nav-button").forEach((button) => {
  button.addEventListener("click", () => {
    if (button.dataset.adminOnly === "true" && !state?.isAdmin) return;
    showView(button.dataset.view);
  });
});

if (authToken) load();
else signedOut();
setInterval(() => {
  if (authToken) load();
}, DASHBOARD_REFRESH_MS);
