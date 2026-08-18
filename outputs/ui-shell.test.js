import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const html = readFileSync(new URL("./convex-client.html", import.meta.url), "utf8");
const css = readFileSync(new URL("./clarity-components.css", import.meta.url), "utf8");

describe("post-overhaul shell", () => {
  test("keeps Home in the branded header rather than primary navigation", () => {
    const primaryNav = html.match(/<nav id="dashboard-nav"[\s\S]*?<\/nav>/)?.[0] || "";
    expect(primaryNav).not.toContain(">Home<");
    expect(html).toContain('id="home-brand"');
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
});
