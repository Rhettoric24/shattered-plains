import type { ConflictState, Event } from "../conflict-board/types";
import type { UnitCounts } from "./rules";

export function lossSummary(units: Partial<UnitCounts>) {
  const labels = { bridgeman: ["Bridgeman", "Bridgemen"], spearman: ["Spearman", "Spearmen"], chull: ["Chull", "Chulls"], shardbearer: ["Shardbearer", "Shardbearers"], heavy: ["Heavy", "Heavies"], scout: ["Scout", "Scouts"] };
  return (Object.keys(labels) as (keyof UnitCounts)[])
    .filter(k => (units[k] ?? 0) > 0).map(k => `${units[k]} ${labels[k][units[k] === 1 ? 0 : 1]}`).join(", ") || "none";
}

/** Persist only the recipient's observations, never the raw scientist journal.
 * Ownership is carried through merge events, even if the resulting army dies. */
export function resolutionReport(before: ConflictState, events: Event[], player: string) {
  const armies = new Map([...before.formations, ...before.arrivals.map(a => a.formation)]
    .map(f => [f.id, { name: f.name, kingdom: f.kingdom }]));
  const position = (id: string) => before.board.positions.find(p => p.id === id)?.name ?? id;
  const kingdom = (id: string) => before.kingdoms.find(k => k.id === id)?.name ?? "A kingdom";
  const lines: string[] = [];
  for (const e of events) {
    if (e.type === "merge") {
      const name = armies.get(e.formation)?.name ?? armies.get(e.sources[0])?.name ?? "Merged army";
      armies.set(e.formation, { name, kingdom: e.kingdom });
      if (e.kingdom === player) lines.push(`Your armies merged at ${position(e.position)}.`);
    }
    const army = "formation" in e ? armies.get(e.formation) : undefined;
    const own = army?.kingdom === player;
    if (e.type === "allyDispersed" && own) lines.push(`${army.name}: dispersed after defeat at ${position(e.position)}.`);
    if (e.type === "move" && own) lines.push(`${army.name}: moved from ${position(e.from)} to ${position(e.to)}.`);
    if (e.type === "arrival" && own) lines.push(`${army.name}: arrived at ${position(e.position)}.`);
    if (e.type === "retreat" && own) lines.push(`${army.name}: retreated to ${position(e.to)}.`);
    if (e.type === "order" && own) lines.push(`${army.name}: ${e.reason}`);
    if (e.type === "battle") {
      const force = e.forces.find(f => f.kingdom === player);
      if (force) lines.push(`Battle at ${position(e.position)}: ${e.winner === player ? "your force won" : e.winner ? "your force lost" : "no winner"}. Your losses: ${lossSummary(force.casualties)}. Your survivors: ${lossSummary(force.survivors)}.`);
    }
    if (e.type === "raid" && e.kingdom === player) lines.push(`${army?.name ?? "Your army"}: raided ${position(e.position)} for ${e.value} Spheres, carried as cargo.`);
    if (e.type === "raidFailed" && own) lines.push(`${army.name}: raid failed — ${e.reason}`);
    if ((e.type === "raidFoothold" || e.type === "raidReady" || e.type === "raidBroken") && e.kingdom === player)
      lines.push(`${position(e.position)}: your raid foothold ${e.type === "raidBroken" ? "was broken" : e.type === "raidReady" ? "is ready" : "was established"}.`);
    if (e.type === "cargo" && (own || e.kingdom === player)) lines.push(`${army?.name ?? "Your army"}: ${e.amount} cargo Spheres ${e.action}.`);
    if (e.type === "fabrial" && e.kingdom === player) lines.push(`${army?.name ?? "Your army"}: Fabrial ${e.action}. ${e.reason}`);
    if (e.type === "highstorm" && e.kingdom === player) lines.push(`${e.formationName ?? army?.name ?? "Your army"}: Highstorm losses: ${lossSummary(e.casualties)}.`);
    if (e.type === "holdStarted") lines.push(`${kingdom(e.kingdom)} began a Command Post conquest hold.`);
    if (e.type === "holdBroken") lines.push(`${kingdom(e.kingdom)} lost its Command Post conquest hold.`);
    if (e.type === "conquest") lines.push(`${kingdom(e.kingdom)} completed conquest.`);
  }
  if (!lines.length) return "No movement, combat, or other reportable changes for your forces this resolution.";
  // Formations have no gameplay cap. Keep each persistent message bounded while
  // the full event sequence remains available in the Board journal.
  let length = 0;
  const shown: string[] = [];
  for (const line of lines) {
    if (length + line.length > 6_000) break;
    shown.push(line);
    length += line.length + 1;
  }
  if (shown.length < lines.length) shown.push(`${lines.length - shown.length} more events are in the Conflict Board journal.`);
  return shown.join("\n");
}
