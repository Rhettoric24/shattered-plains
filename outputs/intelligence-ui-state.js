export function formatDisclosedPower(presentation) {
  if (!presentation) return "Unknown";
  if (presentation.mode === "label") return presentation.label;
  if (presentation.mode === "range") return presentation.min + "–" + (presentation.max === null ? presentation.min + "+" : presentation.max);
  if (presentation.mode === "estimate") return presentation.min + "–" + presentation.max;
  if (presentation.mode === "exact") return String(presentation.value);
  return "Unknown";
}

export function raidDefensePresentation(presentation) {
  if (!presentation) return null;
  return {
    label: presentation.mode === "exact" ? "Enemy Power" : "Estimated enemy Power",
    value: formatDisclosedPower(presentation),
    exact: presentation.mode === "exact",
  };
}

export function raidDefenseMarkup(presentation) {
  const defense = raidDefensePresentation(presentation);
  if (!defense) return "";
  return '<div class="raid-defense-intel" data-raid-defense-intel="' + (defense.exact ? "exact" : "estimate") + '"><span>' + defense.label + "</span><strong>" + defense.value + "</strong></div>";
}

export function plateauIdentityPresentation(plateau) {
  if (!plateau || plateau.type === "unknown") return { known: false, type: "Unknown plateau type", traits: [] };
  return {
    known: true,
    type: plateau.typeName || plateau.type,
    traits: [plateau.large ? "Large" : "", plateau.highground ? "Highground" : ""].filter(Boolean),
  };
}
