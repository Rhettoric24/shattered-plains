export function syncEspionageControlLock(controls, networkLocked) {
  if (!controls) return;
  controls.classList.toggle("network-locked", networkLocked);
  controls.querySelectorAll("input, select, button").forEach((control) => {
    control.disabled = networkLocked;
  });
}

export function sphereHeistAvailability(economyIntel, cost = 50) {
  const availableIntel = Math.max(0, Math.floor(Number(economyIntel) || 0));
  const requiredIntel = Math.max(0, Math.floor(Number(cost) || 0));
  return {
    available: availableIntel >= requiredIntel,
    availableIntel,
    requiredIntel,
    remainingIntel: Math.max(0, availableIntel - requiredIntel),
  };
}

export function espionageMissionAvailability({ selectedOperatives, hasTarget, heistIntelAvailable = true }) {
  const selected = Math.max(0, Math.floor(Number(selectedOperatives) || 0));
  return {
    available: selected > 0 && Boolean(hasTarget) && Boolean(heistIntelAvailable),
    selected,
  };
}
