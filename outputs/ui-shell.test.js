import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const html = readFileSync(new URL("./convex-client.html", import.meta.url), "utf8");
const css = readFileSync(new URL("./clarity-components.css", import.meta.url), "utf8");
const client = readFileSync(new URL("./convex-client.js", import.meta.url), "utf8");

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
    expect(css).toContain("grid-template-columns: repeat(4,minmax(0,1fr))");
    expect(css).toContain("bottom: max(10px,env(safe-area-inset-bottom))");
    expect(css).toContain("top: max(10px,env(safe-area-inset-top))");
  });

  test("keeps player identity visible on larger screens and compacts it on mobile", () => {
    expect(html).toContain('id="player-name" class="player-name-label"');
    expect(css).toContain(".player-name-label { display: none; }");
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
    expect(css).toContain("width: min(132px,100%)");
    expect(css).toContain("height: 42px");
  });

  test("recovers Territory Intelligence when plateau payloads are out of sync", () => {
    expect(client).toContain("returnedWatchtowerLevel !== dashboardWatchtowerLevel");
    expect(client).toContain("client.query(refs.listDossiers");
  });
});
