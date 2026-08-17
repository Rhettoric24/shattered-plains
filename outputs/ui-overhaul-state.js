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

export function shouldBlockMissionKey(key) {
  return key === "Enter" || key === "Return";
}

export function researchDisclosureState({ monasteryLevel = 0, teased = false } = {}) {
  if (Number(monasteryLevel) > 0) return "revealed";
  return teased ? "teased" : "hidden";
}
