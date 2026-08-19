import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const html = readFileSync(new URL("./convex-client.html", import.meta.url), "utf8");
const css = readFileSync(new URL("./clarity-components.css", import.meta.url), "utf8");

describe("post-overhaul shell", () => {
  test("places the branded Home control above primary navigation", () => {
    const primaryNav = html.match(/<nav id="dashboard-nav"[\s\S]*?<\/nav>/)?.[0] || "";
    const sidebar = html.match(/<aside class="sidebar">[\s\S]*?<\/aside>/)?.[0] || "";
    expect(primaryNav).not.toContain(">Home<");
    expect(sidebar).toMatch(/id="home-brand"[\s\S]*id="dashboard-nav"/);
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
});
