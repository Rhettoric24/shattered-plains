import { describe, expect, test } from "vitest";
import { espionageMissionAvailability, sphereHeistAvailability, syncEspionageControlLock } from "./espionage-ui-state.js";

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

  test("communicates the fixed Economy Intel requirement without target treasury data", () => {
    expect(sphereHeistAvailability(49, 50)).toEqual({ available: false, availableIntel: 49, requiredIntel: 50, remainingIntel: 0 });
    expect(sphereHeistAvailability(50, 50)).toEqual({ available: true, availableIntel: 50, requiredIntel: 50, remainingIntel: 0 });
    expect(sphereHeistAvailability(72, 50)).toEqual({ available: true, availableIntel: 72, requiredIntel: 50, remainingIntel: 22 });
  });

  test("requires a target and at least one operative before a mission can launch", () => {
    expect(espionageMissionAvailability({ selectedOperatives: 0, hasTarget: true })).toEqual({ available: false, selected: 0 });
    expect(espionageMissionAvailability({ selectedOperatives: 1, hasTarget: false })).toEqual({ available: false, selected: 1 });
    expect(espionageMissionAvailability({ selectedOperatives: 1, hasTarget: true })).toEqual({ available: true, selected: 1 });
    expect(espionageMissionAvailability({ selectedOperatives: 1, hasTarget: true, heistIntelAvailable: false })).toEqual({ available: false, selected: 1 });
  });
});
