import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const client = readFileSync(new URL("./convex-client.js", import.meta.url), "utf8");

describe("PvP siege reinforcement presentation", () => {
  test("gives reinforcement armies the standard unit and outlook context", () => {
    expect(client).toContain('data-siege-reinforcement-outlook="');
    expect(client).toContain('outlookCell("Power"');
    expect(client).toContain('outlookCell("Speed"');
    expect(client).toContain('outlookCell("Time to arrival"');
    expect(client).toContain('outlookCell("Arrival"');
    expect(client).toContain('outlookCell("Survive"');
    expect(client).toContain("Available ' + number(available)");
  });

  test("prioritizes both siege participants and reconciles investigation Power", () => {
    expect(client).toContain('siege.attackerId === state.me.id');
    expect(client).toContain('urgentHeading.textContent = "⚔ Your active sieges"');
    expect(client).toContain("Investigated attacker Power");
    expect(client).toContain("Investigated defender Power");
    expect(client).toContain("(exact snapshot)");
  });

  test("uses concise Intel labels in persistent ledger cells", () => {
    expect(client).toContain('<span>Intel</span><strong>');
  });
});
