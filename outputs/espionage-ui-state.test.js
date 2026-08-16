import { describe, expect, test } from "vitest";
import { syncEspionageControlLock } from "./espionage-ui-state.js";

function controlHarness(initiallyDisabled) {
  const controls = [{ disabled: initiallyDisabled }, { disabled: initiallyDisabled }, { disabled: initiallyDisabled }];
  let lockedClass = false;
  return {
    controls,
    container: {
      classList: { toggle: (_name, enabled) => { lockedClass = enabled; } },
      querySelectorAll: () => controls,
    },
    isLocked: () => lockedClass,
  };
}

describe("espionage UI state", () => {
  test("re-enables mission and defense controls after Network I is built", () => {
    const harness = controlHarness(true);
    syncEspionageControlLock(harness.container, false);
    expect(harness.isLocked()).toBe(false);
    expect(harness.controls.every((control) => control.disabled === false)).toBe(true);
  });

  test("keeps controls disabled before the Network is built", () => {
    const harness = controlHarness(false);
    syncEspionageControlLock(harness.container, true);
    expect(harness.isLocked()).toBe(true);
    expect(harness.controls.every((control) => control.disabled === true)).toBe(true);
  });
});
