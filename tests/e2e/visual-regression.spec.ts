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
    ["global-header", page.locator(".dashboard-header")],
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
  await page.locator("#space-subnav").getByRole("button", { name: "Operations", exact: true }).click();
  await expect(page.locator("#view-intelligence-operations")).toBeVisible();
  const card = page.locator(".operative-card").first();
  const composer = page.locator("#espionage-mission-form");
  await expect(card).toBeVisible();
  await expect(composer).toBeVisible();
  await expectContained(card);
  await expectContained(composer);

  const cardMasks = [card.locator(".status-badge"), card.locator(".operative-state-line")];
  const composerMasks = [composer.locator("select"), composer.locator(".mission-unit-heading small"), composer.locator("#espionage-mission-preview")];
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

  await page.locator("#notification-bell").click();
  const panel = page.locator("#notification-panel");
  await expect(panel).toBeVisible();
  const panelBox = await panel.boundingBox();
  expect(panelBox).not.toBeNull();
  if (panelBox && viewport) {
    if (viewport.width > 900) expect(panelBox.width).toBeGreaterThanOrEqual(540);
    else expect(panelBox.width).toBeGreaterThanOrEqual(viewport.width - 60);
  }
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
    if (destination.name === "intelligence") await expectEspionageLayouts(page);
  });
}
