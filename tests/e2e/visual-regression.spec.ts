import fs from "node:fs";
import { expect, type Locator, type Page, test, type TestInfo } from "@playwright/test";

const { PNG } = require("playwright-core/lib/utilsBundle");
const imageComparator = require("playwright-core/lib/coreBundle").utils.getComparator("image/png") as (
  expected: Buffer,
  actual: Buffer,
  options?: Record<string, unknown>,
) => { errorMessage: string; diff?: Buffer } | undefined;

type Destination = {
  name: string;
  open: (page: Page) => Promise<void>;
  visible: string;
  sections: string[];
};
type PixelRect = { x: number; y: number; width: number; height: number };

const maskColor = "#25364a";
const globalDynamicMasks = ["#game-date", ".resource-strip strong", "#inbox-badge", "#notification-badge", ".nav-state-dot"];
const runtimeProblems = new WeakMap<Page, string[]>();
const intelligenceUiModuleSource = fs.readFileSync("outputs/intelligence-ui-state.js", "utf8");
const espionageUiModuleSource = fs.readFileSync("outputs/espionage-ui-state.js", "utf8");

const destinations: Destination[] = [
  {
    name: "home",
    open: async (page) => page.locator("#home-brand").click(),
    visible: "#view-overview",
    sections: ["#command-briefing", "#overview-operations", "#kingdom-summary", "#home-season", "#home-hostility"],
  },
  {
    name: "warcamp-recruitment",
    open: async (page) => {
      await page.getByRole("button", { name: "Warcamp", exact: true }).click();
      await page.locator("#space-subnav").getByRole("button", { name: "Recruitment", exact: true }).click();
    },
    visible: "#view-army",
    sections: ["#army-status", "#unit-roster"],
  },
  {
    name: "plains-raids",
    open: async (page) => page.getByRole("button", { name: /^Plains/ }).click(),
    visible: "#view-raids",
    sections: ["#outgoing-queue", "#world-queue", "#sphere-form", "#deep-plains-form"],
  },
  {
    name: "plains-sieges",
    open: async (page) => {
      await page.getByRole("button", { name: /^Plains/ }).click();
      await page.locator("#space-subnav").getByRole("button", { name: "Sieges", exact: true }).click();
    },
    visible: "#view-plateaus",
    sections: ["#retaliation-warning-panel", "#urgent-sieges-panel", "#neutral-siege-form", "#active-sieges"],
  },
  {
    name: "intelligence",
    open: async (page) => page.locator("#intelligence-primary-nav").click(),
    visible: "#view-ledger",
    sections: ["#kingdom-intelligence-table"],
  },
  {
    name: "research",
    open: async (page) => page.locator("#research-primary-nav").click(),
    visible: "#view-research-current",
    sections: ["#research-current", "#research-bonuses"],
  },
  {
    name: "spanreed-hub",
    open: async (page) => page.locator("#spanreed-button").click(),
    visible: "#view-inbox",
    sections: ["#inbox-list"],
  },
];

async function expectNoMajorHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const viewport = document.documentElement.clientWidth;
    const isInsideContainedScroller = (element: Element) => {
      let parent = element.parentElement;
      while (parent && parent !== document.body) {
        const style = getComputedStyle(parent);
        const rect = parent.getBoundingClientRect();
        if (["auto", "scroll"].includes(style.overflowX) && rect.left >= -2 && rect.right <= viewport + 2) return true;
        parent = parent.parentElement;
      }
      return false;
    };
    const offenders = [...document.querySelectorAll("body *")]
      .map((element) => ({
        element,
        rect: element.getBoundingClientRect(),
      }))
      .filter(({ element, rect }) => (rect.right > viewport + 2 || rect.left < -2) && !isInsideContainedScroller(element))
      .slice(0, 5)
      .map(({ element, rect }) => `${element.tagName.toLowerCase()}#${element.id}.${[...element.classList].join(".")} [${Math.round(rect.left)}, ${Math.round(rect.right)}]`);
    const landmarks = ["body", ".dashboard", "#global-shell", ".resource-strip"]
      .map((selector) => {
        const element = document.querySelector(selector);
        if (!element) return `${selector}: missing`;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return `${selector}: [${Math.round(rect.left)}, ${Math.round(rect.right)}], width=${style.width}, min=${style.minWidth}, overflow=${style.overflowX}`;
      });
    return { viewport, page: document.documentElement.scrollWidth, offenders, landmarks };
  });
  expect(overflow.offenders, `page width ${overflow.page}px exceeds viewport ${overflow.viewport}px; offenders: ${overflow.offenders.join(", ")}; landmarks: ${overflow.landmarks.join(" | ")}`).toEqual([]);
}

async function expectContained(locator: Locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  const viewportWidth = await locator.page().evaluate(() => document.documentElement.clientWidth);
  expect(box.x, "content should not escape the left edge").toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width, "content should not escape the right edge").toBeLessThanOrEqual(viewportWidth + 1);
}

async function expectInside(child: Locator, parent: Locator) {
  const [childBox, parentBox] = await Promise.all([child.boundingBox(), parent.boundingBox()]);
  expect(childBox).not.toBeNull();
  expect(parentBox).not.toBeNull();
  if (!childBox || !parentBox) return;
  expect(childBox.x).toBeGreaterThanOrEqual(parentBox.x - 1);
  expect(childBox.y).toBeGreaterThanOrEqual(parentBox.y - 1);
  expect(childBox.x + childBox.width).toBeLessThanOrEqual(parentBox.x + parentBox.width + 1);
  expect(childBox.y + childBox.height).toBeLessThanOrEqual(parentBox.y + parentBox.height + 1);
}

async function expectShellLayout(page: Page) {
  const header = page.locator(".dashboard-header");
  await expect(header).toBeVisible();
  await expect(page.locator("#home-brand")).toBeVisible();
  await expect(page.locator(".resource-strip")).toBeVisible();
  await expect(page.locator("#spanreed-button")).toBeVisible();
  await expect(page.locator("#notification-bell")).toBeVisible();
  await expect(page.locator("#account-toggle")).toBeVisible();
  await expectNoMajorHorizontalOverflow(page);

  const viewport = page.viewportSize();
  if (!viewport) return;
  const nav = await page.locator("#dashboard-nav").boundingBox();
  expect(nav).not.toBeNull();
  if (viewport.width <= 720 && nav) {
    expect(Math.abs(nav.y + nav.height - viewport.height), "mobile navigation should meet the viewport bottom").toBeLessThanOrEqual(2);
  }
  const subnav = page.locator("#space-subnav:not(.hidden)");
  if (await subnav.count()) {
    const [subnavBox, headerBox] = await Promise.all([subnav.boundingBox(), header.boundingBox()]);
    expect(subnavBox).not.toBeNull();
    expect(headerBox).not.toBeNull();
    if (subnavBox && headerBox) {
      expect(subnavBox.y, "subnavigation should begin below the global header").toBeGreaterThanOrEqual(headerBox.y + headerBox.height - 1);
    }
  }
}

function maskLocators(page: Page): Locator[] {
  return globalDynamicMasks.map((selector) => page.locator(selector));
}

function cropPng(buffer: Buffer, rect: PixelRect): Buffer {
  const source = PNG.sync.read(buffer);
  const x = Math.max(0, Math.floor(rect.x));
  const y = Math.max(0, Math.floor(rect.y));
  const width = Math.min(source.width - x, Math.ceil(rect.width));
  const height = Math.min(source.height - y, Math.ceil(rect.height));
  const target = new PNG({ width, height });
  for (let row = 0; row < height; row += 1) {
    const sourceStart = ((y + row) * source.width + x) * 4;
    const targetStart = row * width * 4;
    source.data.copy(target.data, targetStart, sourceStart, sourceStart + width * 4);
  }
  return PNG.sync.write(target);
}

function bestVerticalMatch(expectedBuffer: Buffer, actualCropBuffer: Buffer, rect: PixelRect): PixelRect {
  const expected = PNG.sync.read(expectedBuffer);
  const actual = PNG.sync.read(actualCropBuffer);
  const x = Math.max(0, Math.floor(rect.x));
  let bestY = Math.max(0, Math.floor(rect.y));
  let bestScore = Number.POSITIVE_INFINITY;
  for (let y = 0; y <= expected.height - actual.height; y += 1) {
    let score = 0;
    for (let row = 2; row < actual.height - 2; row += 4) {
      for (let column = 2; column < actual.width - 2; column += 4) {
        const actualOffset = (row * actual.width + column) * 4;
        const expectedOffset = ((y + row) * expected.width + x + column) * 4;
        score += Math.abs(actual.data[actualOffset] - expected.data[expectedOffset]);
        score += Math.abs(actual.data[actualOffset + 1] - expected.data[expectedOffset + 1]);
        score += Math.abs(actual.data[actualOffset + 2] - expected.data[expectedOffset + 2]);
        if (score >= bestScore) break;
      }
      if (score >= bestScore) break;
    }
    if (score < bestScore) {
      bestScore = score;
      bestY = y;
    }
  }
  return { x, y: bestY, width: actual.width, height: actual.height };
}

async function compareApprovedRegion(
  testInfo: TestInfo,
  baselineName: string,
  regionName: string,
  rect: PixelRect,
  actualFullPage: Buffer,
  locateVertically = false,
) {
  const baselinePath = testInfo.snapshotPath(`${baselineName}.png`);
  expect(fs.existsSync(baselinePath), `approved baseline should exist: ${baselinePath}`).toBe(true);
  const baseline = fs.readFileSync(baselinePath);
  const actual = cropPng(actualFullPage, rect);
  const expectedRect = locateVertically ? bestVerticalMatch(baseline, actual, rect) : rect;
  const expected = cropPng(baseline, expectedRect);
  const comparison = imageComparator(expected, actual, { threshold: 0.2 });
  if (!comparison) return;
  await testInfo.attach(`${regionName}-expected`, { body: expected, contentType: "image/png" });
  await testInfo.attach(`${regionName}-actual`, { body: actual, contentType: "image/png" });
  if (comparison.diff) await testInfo.attach(`${regionName}-diff`, { body: comparison.diff, contentType: "image/png" });
  expect(comparison.errorMessage, `${regionName} differs from its approved pixel baseline`).toBeUndefined();
}

async function strictShellScreenshot(page: Page, testInfo: TestInfo, baselineName: string) {
  const screenshot = await page.screenshot({
    fullPage: true,
    animations: "disabled",
    caret: "hide",
    mask: maskLocators(page),
    maskColor,
    scale: "css",
  });
  if (testInfo.config.updateSnapshots !== "none") {
    const baselinePath = testInfo.snapshotPath(`${baselineName}.png`);
    fs.mkdirSync(testInfo.snapshotDir, { recursive: true });
    fs.writeFileSync(baselinePath, screenshot);
    return;
  }
  for (const [name, locator] of [
    ["brand-home", page.locator("#home-brand")],
    // Keep pixel checks on the stable route context. The full header also contains
    // the authenticated kingdom name, which is intentionally dynamic and covered
    // by behavioral visibility assertions below.
    ["header-context", page.locator(".header-context")],
    ["resource-strip", page.locator(".resource-strip")],
    ["context-subnav", page.locator("#space-subnav:not(.hidden)")],
  ] as const) {
    if (!(await locator.count()) || !(await locator.isVisible())) continue;
    const rect = await locator.boundingBox();
    if (rect) await compareApprovedRegion(testInfo, baselineName, name, rect, screenshot);
  }
  const viewport = page.viewportSize();
  if (viewport && viewport.width <= 720 && baselineName === "plains-raids") {
    const navButtons = page.locator("#dashboard-nav [data-route-view]");
    for (let index = 0; index < await navButtons.count(); index += 1) {
      const navRect = await navButtons.nth(index).boundingBox();
      if (navRect) {
        const inset = { x: navRect.x + 2, y: navRect.y + 2, width: navRect.width - 4, height: navRect.height - 4 };
        await compareApprovedRegion(testInfo, baselineName, `mobile-bottom-navigation-${index + 1}`, inset, screenshot, true);
      }
    }
  }
}

async function expectStickySubnav(page: Page) {
  const subnav = page.locator("#space-subnav:not(.hidden)");
  await page.evaluate(() => window.scrollTo(0, Math.min(700, document.documentElement.scrollHeight - innerHeight)));
  await page.waitForTimeout(50);
  const box = await subnav.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  if (box && viewport) {
    expect(box.y, "sticky subnavigation should remain inside the visible viewport").toBeGreaterThanOrEqual(0);
    expect(box.y + box.height, "sticky subnavigation should remain usable while scrolled").toBeLessThanOrEqual(viewport.height);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
}

async function strictStandardComposerScreenshot(page: Page) {
  const form = page.locator("#sphere-form");
  await expect(form).toHaveScreenshot("standard-army-composer.png", {
    animations: "disabled",
    caret: "hide",
    mask: [
      ...maskLocators(page),
      form.locator("#sphere-raid-preview"),
    ],
    maskColor,
    threshold: 0.2,
  });
}

async function expectNotificationSurfaceAccessible(page: Page) {
  await page.locator("#notification-bell").click();
  const panel = page.locator("#notification-panel");
  await expect(panel).toBeVisible();
  const box = await panel.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  if (box && viewport) {
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(box.y).toBeLessThanOrEqual(viewport.height - 44);
  }
}

async function expectEspionageLayouts(page: Page) {
  const ownLedgerRow = page.locator("#kingdom-intelligence-table tr.own-row");
  await expect(ownLedgerRow).toBeVisible();
  const ownCategoryCells = ownLedgerRow.locator("td .intel-cell:has(.score-quality)");
  await expect(ownCategoryCells).toHaveCount(4);
  const rivalScoreLabels = page.locator("#kingdom-intelligence-table tbody tr:not(.own-row) .score-quality");
  await expect(rivalScoreLabels).toHaveCount(0);
  await page.locator('#kingdom-intelligence-table [data-kingdom-intel-category="economy"]').first().click();
  const intelDialog = page.locator("#kingdom-intel-dialog");
  await expect(intelDialog).toBeVisible();
  await expect(intelDialog).toContainText("Economy Intel");
  await expect(intelDialog).toContainText("Changes only when Economy Intel is gained or spent.");
  await expect(intelDialog).not.toContainText("Next decay");
  await page.locator("#close-kingdom-intel-dialog").click();
  await page.locator('#kingdom-intelligence-table [data-kingdom-intel-category="military"]').first().click();
  await expect(intelDialog).toContainText("Next decay");
  await page.locator("#close-kingdom-intel-dialog").click();
  await page.locator("#space-subnav").getByRole("button", { name: "Operations", exact: true }).click();
  await expect(page.locator("#view-intelligence-operations")).toBeVisible();
  const card = page.locator("#espionage-roster .operative-card").first();
  const composer = page.locator("#espionage-mission-form");
  await expect(card).toBeVisible();
  await expect(composer).toBeVisible();
  const operation = composer.locator("#espionage-operation");
  await expect(operation.locator('option[value="sphere_heist"]')).toHaveText("Sphere Heist");
  await operation.selectOption("sphere_heist");
  const heistRequirement = composer.locator("#sphere-heist-requirement");
  await expect(heistRequirement).toBeVisible();
  await expect(heistRequirement).toContainText(/(?:Requires|Ready:) 50 Economy Intel/);
  await expect(composer.locator("#launch-espionage-mission")).toHaveText("Launch 2-hour Sphere Heist");
  await expect(composer.locator("#espionage-mission-preview")).toContainText("Target treasuryHidden");
  await expect(composer.locator("#espionage-mission-preview")).not.toContainText(/Target treasury\s*\d/);
  const expectReadableOutlookCards = async () => {
    const preview = composer.locator("#espionage-mission-preview");
    const previewBox = await preview.boundingBox();
    const cards = preview.locator(".outlook-cell");
    expect(await cards.count()).toBeGreaterThanOrEqual(4);
    for (let index = 0; index < await cards.count(); index += 1) {
      const box = await cards.nth(index).boundingBox();
      expect(box, "outlook card should have a layout box").not.toBeNull();
      expect(box!.width, "outlook cards should retain a readable minimum width").toBeGreaterThanOrEqual(178);
      if (previewBox) {
        expect(box!.x).toBeGreaterThanOrEqual(previewBox.x - 1);
        expect(box!.x + box!.width).toBeLessThanOrEqual(previewBox.x + previewBox.width + 1);
      }
    }
  };
  await expectReadableOutlookCards();
  await operation.selectOption("investigation");
  await expect(composer.locator("#espionage-mission-preview")).toContainText("Operation outlook");
  await expectReadableOutlookCards();
  await operation.selectOption("sphere_heist");
  await page.addScriptTag({
    type: "module",
    content: espionageUiModuleSource + `
      const fixture = sphereHeistAvailability(49, 50);
      const testSurface = document.createElement("section");
      testSurface.id = "heist-below-threshold-test";
      testSurface.innerHTML = '<strong>Requires ' + fixture.requiredIntel + ' Economy Intel</strong><button' + (fixture.available ? '' : ' disabled') + '>Launch Sphere Heist</button>';
      document.body.append(testSurface);
    `,
  });
  await expect(page.locator("#heist-below-threshold-test")).toContainText("Requires 50 Economy Intel");
  await expect(page.locator("#heist-below-threshold-test button")).toBeDisabled();
  await expectContained(card);
  await expectContained(composer);
  await expect(page.locator("#view-intelligence-operations").getByRole("button", { name: "Open Recruitment" })).toBeVisible();
  await expect(page.locator("#espionage-roster [data-recruit-operative]")).toHaveCount(0);
  for (const form of [page.locator("#espionage-defense-form"), composer]) {
    const controls = form.locator(".operative-input, select, input, button");
    for (let index = 0; index < await controls.count(); index += 1) {
      if (await controls.nth(index).isVisible()) await expectInside(controls.nth(index), form);
    }
  }
  await expectNoMajorHorizontalOverflow(page);

  const cardMasks = [card.locator(".status-badge"), card.locator(".operative-state-line")];
  const composerMasks = [composer.locator("select"), composer.locator(".mission-unit-heading small"), composer.locator("#espionage-mission-preview")];
  await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined));
  await page.waitForTimeout(750);
  await card.screenshot({ animations: "disabled", caret: "hide", mask: cardMasks, maskColor });
  await composer.screenshot({ animations: "disabled", caret: "hide", mask: composerMasks, maskColor });
  const firstCard = await card.screenshot({ animations: "disabled", caret: "hide", mask: cardMasks, maskColor });
  const firstComposer = await composer.screenshot({ animations: "disabled", caret: "hide", mask: composerMasks, maskColor });
  const secondCard = await card.screenshot({ animations: "disabled", caret: "hide", mask: cardMasks, maskColor });
  const secondComposer = await composer.screenshot({ animations: "disabled", caret: "hide", mask: composerMasks, maskColor });
  expect(imageComparator(firstCard, secondCard, { threshold: 0.2 }), "operative card should render pixel-stably").toBeFalsy();
  expect(imageComparator(firstComposer, secondComposer, { threshold: 0.2 }), "espionage composer should render pixel-stably").toBeFalsy();
}

test.beforeEach(async ({ page }) => {
  const problems: string[] = [];
  runtimeProblems.set(page, problems);
  page.on("pageerror", (error) => problems.push(`page error: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`console error: ${message.text()}`);
  });
  page.on("requestfailed", (request) => {
    const reason = request.failure()?.errorText || "unknown failure";
    if (!reason.includes("ERR_ABORTED")) problems.push(`request failed: ${request.method()} ${request.url()} (${reason})`);
  });
  await page.goto("/");
  await expect(page.locator("#game-screen")).toBeVisible({ timeout: 30_000 });
  await page.addStyleTag({ content: "*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; } .nav-state-dot { display: none !important; }" });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
});

test.afterEach(async ({ page }) => {
  expect(runtimeProblems.get(page) || [], "browser runtime and network failures").toEqual([]);
});

test("friend-test identity, build, and alerts diagnostics are accessible", async ({ page }) => {
  const headerName = (await page.locator("#player-name").textContent())?.trim();
  expect(headerName).toBeTruthy();

  const viewport = page.viewportSize();
  if (viewport && viewport.width > 900) await expect(page.locator("#player-name")).toBeVisible();

  await page.locator("#account-toggle").click();
  await expect(page.locator("#account-panel")).toBeVisible();
  await expect(page.locator("#settings-player-name")).toBeVisible();
  await expect(page.locator("#settings-player-name")).toHaveText(headerName!);
  await expect(page.locator("#build-identifier")).toHaveText(/^(?:[0-9a-f]{7}|dev)$/);
  await expect(page.locator(".notification-toast")).toHaveCount(0);

  await page.locator("#notification-bell").click();
  const panel = page.locator("#notification-panel");
  await expect(panel).toBeVisible();
  const panelBox = await panel.boundingBox();
  expect(panelBox).not.toBeNull();
  if (panelBox && viewport) {
    if (viewport.width > 900) expect(panelBox.width).toBeGreaterThanOrEqual(540);
    else {
      expect(panelBox.width).toBeGreaterThanOrEqual(viewport.width - 60);
      expect(panelBox.height).toBeGreaterThanOrEqual(viewport.height * 0.75);
      expect(panelBox.y).toBeGreaterThanOrEqual(0);
      expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(viewport.height + 1);
    }
  }
});

test("the first Spanreed open survives an immediate inbox rerender", async ({ page }) => {
  await page.locator("#spanreed-button").click();
  await expect(page.locator("#view-inbox")).toBeVisible();
  const readable = page.locator("#inbox-list details:not([data-unread])").first();
  await expect(readable, "the developed test kingdom should have a read report available").toBeAttached();
  const messageId = await readable.getAttribute("data-message-id");
  expect(messageId).toBeTruthy();
  await readable.locator("summary").click();
  await expect(readable).toHaveAttribute("open", "");
  await page.locator('[data-inbox-filter="all"]').click();
  await expect(page.locator(`#inbox-list details[data-message-id="${messageId}"]`)).toHaveAttribute("open", "");
});

test("earned Watchtower intelligence is visible in military decision surfaces", async ({ page }) => {
  await page.getByRole("button", { name: /^Plains/ }).click();
  await expect(page.locator("#sphere-raid-preview")).toContainText(/Possible enemy Power:\s*\d[\d,]*–\d[\d,]*/);

  await page.locator("#space-subnav").getByRole("button", { name: "Sieges", exact: true }).click();
  const neutralOptions = page.locator("#neutral-plateau-target option");
  if (await neutralOptions.count()) {
    await expect(neutralOptions.first()).not.toHaveText(/Unsurveyed Plateau/);
    await expect(neutralOptions.first()).toHaveText(/(?:Sphere|Ancient|Gemheart|Bridged) Plateau/);
    await expect(page.locator("#neutral-siege-preview")).toContainText(/(?:Sphere|Ancient|Gemheart|Bridged) Plateau/);
    await expect(page.locator("#neutral-siege-preview")).toContainText(/Parshendi resistance:/);
  } else {
    await expect(page.locator("#neutral-siege-preview")).toContainText("Choose a neutral plateau");
  }

  await page.addScriptTag({
    type: "module",
    content: intelligenceUiModuleSource + `
      const testRaid = document.createElement("section");
      testRaid.id = "watchtower-existing-raid-test";
      testRaid.innerHTML = [
        { level: 0, mode: "range", min: 100, max: 200 },
        { level: 1, mode: "estimate", min: 128, max: 198 },
        { level: 2, mode: "estimate", min: 143, max: 183 },
        { level: 3, mode: "estimate", min: 153, max: 173 },
        { level: 5, mode: "exact", value: 163 },
      ].map(raidDefenseMarkup).join("");
      document.body.append(testRaid);
    `,
  });
  const existingRaidDisclosures = page.locator("#watchtower-existing-raid-test [data-raid-defense-intel]");
  await expect(existingRaidDisclosures).toHaveCount(5);
  await expect(existingRaidDisclosures.nth(0)).toContainText("Estimated enemy Power100–200");
  await expect(existingRaidDisclosures.nth(1)).toContainText("128–198");
  await expect(existingRaidDisclosures.nth(2)).toContainText("143–183");
  await expect(existingRaidDisclosures.nth(3)).toContainText("153–173");
  await expect(existingRaidDisclosures.nth(4)).toContainText("Enemy Power163");
});

test("primary navigation reaches every representative view", async ({ page }) => {
  for (const destination of destinations) {
    await destination.open(page);
    await expect(page.locator(destination.visible)).toBeVisible();
  }
});

test("legacy view URLs resolve through the current router", async ({ page }) => {
  const legacyRoutes = [
    ["overview", "#view-overview"],
    ["ledger", "#view-ledger"],
    ["buildings", "#view-buildings"],
    ["army", "#view-army"],
    ["raids", "#view-raids"],
    ["plateaus", "#view-plateaus"],
    ["plateau", "#view-plateau"],
    ["intelligence", "#view-ledger"],
    ["research", "#view-research-current"],
    ["inbox", "#view-inbox"],
  ] as const;
  for (const [legacyView, expectedSection] of legacyRoutes) {
    await page.evaluate((view) => {
      history.pushState(null, "", `?view=${view}`);
      window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
    }, legacyView);
    await expect(page.locator(expectedSection)).toBeVisible();
  }
});

test("responsive transition widths retain shell containment", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440", "one browser project is sufficient for breakpoint boundary coverage");
  await page.getByRole("button", { name: /^Plains/ }).click();
  for (const width of [679, 681, 719, 721, 899, 901, 979, 981]) {
    await page.setViewportSize({ width, height: 900 });
    await expectNoMajorHorizontalOverflow(page);
    await expectContained(page.locator("#global-shell"));
    await expectContained(page.locator("#space-subnav:not(.hidden)"));
  }
});

test("the Fabrial mystery or revealed state stays contained", async ({ page }) => {
  await page.locator("#research-primary-nav").click();
  const fabrialsTab = page.locator('#space-subnav [data-route-tab="fabrials"]');
  await expect(fabrialsTab).toBeVisible();
  const revealed = (await fabrialsTab.textContent())?.trim() === "Fabrials";
  if (revealed) await expect(fabrialsTab).toHaveAccessibleName("Fabrials");
  else await expect(fabrialsTab).toHaveAccessibleName("Unexplored scholarly applications");
  await fabrialsTab.click();
  await expect(page.locator("#view-research-fabrials")).toBeVisible();
  if (revealed) {
    await expect(page.locator("#research-fabrials .fabrial-card").first()).toBeVisible();
    await expect(page.locator("#research-fabrials [data-fabricate-fabrial]").first()).toBeVisible();
  } else {
    await expect(page.locator("#research-fabrials")).toContainText("Separate lines of scholarship");
    await expect(page.locator("#research-fabrials")).not.toContainText(/Painrial|Soulcaster|Half-Shard/);
  }
  await expectContained(page.locator("#research-fabrials"));
  await expectNoMajorHorizontalOverflow(page);

  await page.locator('#dashboard-nav [data-route-view="plains"]').click();
  if (revealed) await expect(page.locator("#sphere-fabrial")).toBeVisible();
  else await expect(page.locator("#sphere-fabrial")).toBeHidden();
  await expectContained(page.locator("#sphere-form"));
  await expectNoMajorHorizontalOverflow(page);
});

for (const destination of destinations) {
  test(`${destination.name} structural regression coverage`, async ({ page }, testInfo) => {
    await destination.open(page);
    await expect(page.locator(destination.visible)).toBeVisible();
    await expectShellLayout(page);
    for (const selector of destination.sections) {
      const section = page.locator(selector);
      await expect(section).toBeAttached();
      if (await section.isVisible()) await expectContained(section);
    }
    await strictShellScreenshot(page, testInfo, destination.name);
    if (destination.name === "plains-raids") {
      await strictStandardComposerScreenshot(page);
      await expectStickySubnav(page);
    }
    if (destination.name === "home") await expectNotificationSurfaceAccessible(page);
    if (destination.name === "warcamp-recruitment") {
      const groups = page.locator("#unit-roster [data-recruitment-group]");
      await expect(groups).toHaveCount(3);
      for (const key of ["military", "ardents", "espionage"]) {
        const group = page.locator(`[data-recruitment-group="${key}"]`);
        await expect(group).toHaveAttribute("open", "");
        await expect(group.locator(":scope > summary")).toBeVisible();
      }
      await expect(page.locator("#unit-roster [data-recruit-submit]").first()).toBeVisible();
      await expect(page.locator("#unit-roster [data-recruit-conclave]")).toBeVisible();
      await expect(page.locator("#unit-roster [data-recruit-operative]")).toHaveCount(3);
      const military = page.locator('[data-recruitment-group="military"]');
      await military.locator(":scope > summary").click();
      await expect(military).not.toHaveAttribute("open", "");
      await expect(military.locator("[data-recruit-submit]").first()).toBeHidden();
      await expect(page.locator('[data-recruitment-group="ardents"] [data-recruit-conclave]')).toBeVisible();
      await military.locator(":scope > summary").click();
      await expect(military.locator("[data-recruit-submit]").first()).toBeVisible();
      const espionage = page.locator('[data-recruitment-group="espionage"]');
      await espionage.locator(":scope > summary").click();
      await expect.poll(() => page.evaluate(() => localStorage.getItem("sp-recruitment-group-v1-espionage"))).toBe("closed");
      await page.reload();
      await destination.open(page);
      await expect(page.locator('[data-recruitment-group="espionage"]')).not.toHaveAttribute("open", "");
      await page.locator('[data-recruitment-group="espionage"] > summary').click();
      await expect(page.locator('[data-recruitment-group="espionage"] [data-recruit-operative]')).toHaveCount(3);
    }
    if (destination.name === "intelligence") await expectEspionageLayouts(page);
    if (destination.name === "plains-sieges") {
      const siegeNames = page.locator(".siege-card > span:first-of-type");
      for (let index = 0; index < await siegeNames.count(); index += 1) {
        await expect(siegeNames.nth(index)).not.toHaveText(/^(?:Unknown plateau|Plateau)$/i);
      }
    }
  });
}
