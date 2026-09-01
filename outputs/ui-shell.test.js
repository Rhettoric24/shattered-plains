import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const html = readFileSync(new URL("./convex-client.html", import.meta.url), "utf8");
const client = readFileSync(new URL("./convex-client.js", import.meta.url), "utf8");
const css = ["shattered-plains-styles.css", "clarity-components.css", "clarity-responsive.css"]
  .map((file) => readFileSync(new URL(`./${file}`, import.meta.url), "utf8"))
  .join("\n");
describe("post-overhaul shell", () => {
  test("places branding, global controls, resources, and subnavigation in one shell", () => {
    const primaryNav = html.match(/<nav id="dashboard-nav"[\s\S]*?<\/nav>/)?.[0] || "";
    const globalShell = html.match(/<header id="global-shell"[\s\S]*?<\/header>/)?.[0] || "";
    expect(primaryNav).not.toContain(">Home<");
    expect(globalShell).toMatch(/id="home-brand"[\s\S]*class="header-actions"[\s\S]*class="resource-strip"[\s\S]*id="space-subnav"/);
    expect(html).toMatch(/<\/header>[\s\S]*<aside class="sidebar navigation-rail"/);
    expect(html).toContain('brand-home-affordance');
  });

  test("uses clear bell and settings controls", () => {
    expect(html).toMatch(/id="notification-bell"[^>]*>🔔/);
    expect(html).toContain('class="settings-icon"');
  });

  test("anchors mobile navigation and keeps the alert surface inside safe-area bounds", () => {
    expect(css).toMatch(/grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/);
    expect(css).toMatch(/bottom:\s*max\(10px,\s*env\(safe-area-inset-bottom\)\)/);
    expect(css).toMatch(/top:\s*max\(10px,\s*env\(safe-area-inset-top\)\)/);
    expect(css).toMatch(/\.primary-nav\s*\{[^}]*position:\s*fixed[^}]*bottom:\s*0/);
    expect(css).not.toMatch(/\.primary-nav\s*\{[^}]*(?:transform|will-change|contain):/);
    expect(css).toMatch(/body\s*\{[^}]*padding-bottom:\s*calc\(78px\s*\+\s*env\(safe-area-inset-bottom\)\)/);
  });

  test("teaches Watchtower forecasts and consolidates personnel acquisition", () => {
    expect(html).toContain("Open Recruitment");
    expect(html).toContain("Recruit Scout Conclaves");
    expect(css).toContain("safe-area-inset-bottom");
    expect(client).toContain("Highstorm arrival within about 4 hours");
    expect(client).toContain("Highstorm arrival within about 2 hours");
    expect(client).toContain("Highstorm arrival within about 1 hour");
    expect(client).toContain("Exact Highstorm arrival time");
    expect(client).toContain("Reveals plateau names, types, attributes, and broad resistance ranges");
    expect(client).toContain("Maintains narrow estimates and adds +1 Counter-Intelligence");
  });

  test("renders three accessible persisted Recruitment disclosure groups", () => {
    expect(client).toContain('group("military", "Military Units"');
    expect(client).toContain('group("ardents", "Ardents"');
    expect(client).toContain('group("espionage", "Espionage Operatives"');
    expect(client).toContain('data-recruitment-group="');
    expect(client).toContain('localStorage.getItem("sp-recruitment-group-v1-" + key) !== "closed"');
    expect(client).toContain('details.open ? "open" : "closed"');
    expect(css).toContain(".recruitment-group > summary");
    expect(css).toContain('content: "Expand ▾"');
    expect(css).toContain('content: "Collapse ▴"');
  });

  test("keeps player identity in the desktop header and mobile-accessible Settings", () => {
    expect(html).toContain('id="player-name" class="player-name-label"');
    expect(html).toContain('id="settings-player-name"');
    expect(css).toContain(".player-name-label { display: none; }");
  });

  test("exposes build diagnostics in Settings", () => {
    expect(html).toMatch(/Build:\s*<code id="build-identifier">[^<]+<\/code>/);
  });

  test("adds the mystery Fabrial tab and supported mission selectors without spendable AP language", () => {
    expect(html).toContain('id="view-research-fabrials"');
    expect(html).toContain('id="research-fabrials"');
    expect(html).toContain('id="sphere-fabrial"');
    expect(html).toContain('id="deep-plains-fabrial"');
    expect(html).toContain('id="neutral-fabrial"');
    expect(html).toContain('id="player-fabrial"');
    expect(client).toContain('aria-label="Unexplored scholarly applications"');
    expect(client).toContain("Ancient Plateaus");
    expect(client).not.toContain("Research AP");
  });

  test("makes the principal Home summaries full width", () => {
    expect(html).toContain("home-module home-kingdom");
    expect(css).toContain(".home-kingdom");
    expect(css).toContain("#home-season");
  });

  test("keeps the mobile brand and controls in one header row", () => {
    expect(css).toContain(".navigation-rail { position: static; min-height: 0; height: 0;");
    expect(css).toContain(".dashboard-header { min-height: 50px;");
    expect(css).toContain(".header-context { display: none; }");
    expect(css).toContain(".player-chip .settings-icon { display: inline-block; }");
  });

  test("keeps operative recruitment controls from stretching the Recruit button", () => {
    expect(css).toContain(".operative-recruit > button");
    expect(css).toMatch(/width:\s*min\(132px,\s*100%\)/);
    expect(css).toContain("height: 42px");
  });

  test("makes all four army stats explicitly tap-accessible", () => {
    for (const stat of ["power", "speed", "plunder", "survivability"]) {
      expect(client).toContain('statButton("' + stat + '"');
    }
    expect(client).toContain('data-stat-explanation="\' + stat + \'"');
    expect(client).toContain('aria-label="Explain ');
    expect(client).toContain('showTapTooltip(calculation.getAttribute("title"), calculation)');
  });

  test("uses the military recruitment card system for espionage operatives", () => {
    expect(client).toContain('upgrade-card unit-card operative-card operative-');
    expect(client).toContain("data-recruit-card=\"' + tier + '\"");
    expect(css).toContain("#unit-roster .operative-informant");
    expect(css).toContain("#unit-roster .operative-spy");
    expect(css).toContain("#unit-roster .operative-ghostblood");
  });

  test("includes intelligence-aware plateau types in rival siege targets", () => {
    expect(client).toContain('const typeLabel = plateau.type === "unknown" ? "Type unknown" : plateau.typeName;');
    expect(client).toContain('plateau.ownerName + " - " + plateau.name + " · " + typeLabel');
  });

  test("gives empty siege target selectors an explicit disabled state", () => {
    expect(client).toContain("No neutral plateaus available");
    expect(client).toContain("No rival plateaus available");
    expect(client).toContain('$("neutral-plateau-target").disabled = neutralOptions.length < 1;');
    expect(client).toContain('$("player-plateau-target").disabled = rivalOptions.length < 1;');
  });

  test("guides fresh recruits toward a first neutral expedition", () => {
    expect(client).toContain("The Plains wait beyond the warcamp.");
    expect(client).toContain("Survey the Plains");
    expect(client).toContain('data-route-view="plains" data-route-tab="sieges"');
    expect(client).toContain('plateau.origin === "neutral"');
    expect(client).toContain('sp-first-neutral-expedition-v1-');
  });

  test("warns before scarce starting Gemhearts are spent on recruitment", () => {
    expect(client).toContain("Your first Gemhearts are scarce.");
    expect(client).toContain("Spending them here is permanent.");
    expect(client).toContain("state.config.startingGemhearts");
  });

  test("explains the two friend-test Intelligence models and separate spend pools", () => {
    expect(html).toContain("Intelligence helps you judge rival strength before committing armies, operatives, or resources.");
    expect(html).toContain("Friend-test note: two Intelligence models");
    expect(html).toContain("Persistent Intel · Military and Economy");
    expect(html).toContain("0–24 shows a qualitative label, 25–74 an estimate, and 75–100 an exact ledger snapshot");
    expect(html).toContain("Military Intel can be spent in blocks of 50 by participants investigating an active PvP siege");
    expect(html).toContain("Report Intel · Research and Territory");
    expect(html).toContain("lose one precision level every six hours");
    expect(html).toContain("do not unlock separate Research or Territory operations in this friend test");
    expect(html).toContain("Separate boost pool:");
    expect(html).toContain("spending it does not lower persistent Military disclosure");
  });

});
