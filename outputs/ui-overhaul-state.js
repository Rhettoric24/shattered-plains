const UNIT_ORDER = ["bridgeman", "spearman", "chull", "shardbearer"];

export function orderedActiveUnits(units = {}) {
  return Object.entries(units)
    .filter(([, unit]) => unit?.active !== false)
    .sort(([left], [right]) => {
      const leftIndex = UNIT_ORDER.indexOf(left);
      const rightIndex = UNIT_ORDER.indexOf(right);
      return (leftIndex < 0 ? UNIT_ORDER.length : leftIndex) -
        (rightIndex < 0 ? UNIT_ORDER.length : rightIndex);
    });
}

export function normalizeRosterUnits(units = {}, unitKeys = UNIT_ORDER) {
  return Object.fromEntries(unitKeys.map((key) => [key, Math.max(0, Math.floor(Number(units?.[key]) || 0))]));
}

export function shouldBlockMissionKey(key) {
  return key === "Enter" || key === "Return";
}

export function shouldResetRouteScroll(previous, next, options = {}) {
  const changed = previous?.view !== next?.view || previous?.tab !== next?.tab;
  const targeted = Boolean(next?.focus || next?.message || next?.kingdom || next?.category);
  return changed && !targeted && options.preserveScroll !== true;
}

export function researchDisclosureState({ monasteryLevel = 0, teased = false } = {}) {
  if (Number(monasteryLevel) > 0) return "revealed";
  return teased ? "teased" : "hidden";
}

export function intelligenceDisclosureState({ networkLevel = 0, watchtowerLevel = 0 } = {}) {
  return {
    network: Number(networkLevel) >= 1,
    watchtower: Number(watchtowerLevel) >= 1,
  };
}
