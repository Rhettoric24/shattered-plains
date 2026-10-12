import { expect, test } from "vitest";
import { scenario } from "../lab/scenarios";
import { emptyUnits } from "./rules";
import { resolutionReport, lossSummary } from "./conflictBoardReports";
import type { Event, Formation } from "../conflict-board/types";

test("reports include own battle details and merge descendants, never enemy secrets", () => {
  const state = scenario();
  const army = (id: string, kingdom: string): Formation => ({ id, name: id, kingdom,
    position: "A1", units: {...emptyUnits(), spearman: 10}, history: [],
    order: {kind:"hold", route:[], onDefeat:"continue"} });
  state.formations = [army("Blue Guard", "blue"), army("Secret Enemy", "red")];
  state.arrivals = [];
  const events: Event[] = [
    {type:"merge", kingdom:"blue", sources:["Blue Guard"], formation:"merged", position:"A1", routeSource:null, reason:"merge"},
    {type:"move", formation:"merged", step:1, from:"A1", to:"A2"},
    {type:"move", formation:"Secret Enemy", step:1, from:"SECRET", to:"HIDDEN"},
    {type:"battle", step:1, position:"A2", winner:"blue", annihilated:false, forces:[
      {kingdom:"blue", power:10, hostilePower:987654, baseRate:.2, finalRate:.2, casualties:{...emptyUnits(),spearman:2},survivors:{...emptyUnits(),spearman:8}},
      {kingdom:"red", power:987654, hostilePower:10, baseRate:.2, finalRate:.2, casualties:{...emptyUnits(),chull:87654},survivors:emptyUnits()},
    ]},
    {type:"cargo", kingdom:"red", formation:"Secret Enemy", action:"captured", amount:777777, reason:"secret"},
  ];
  const body = resolutionReport(state, events, "blue");
  expect(body).toContain("Blue Guard: moved");
  expect(body).toContain("your force won");
  expect(body).toContain("2 Spearmen");
  for (const secret of ["Secret Enemy", "SECRET", "HIDDEN", "987654", "87654", "777777"]) expect(body).not.toContain(secret);
  expect(resolutionReport(state, events, "uninvolved")).not.toContain("Battle");
});

test("Highstorm names survive annihilation and losses retain unit identities", () => {
  const state = scenario(); state.formations=[]; state.arrivals=[];
  const events: Event[] = [{type:"highstorm", formation:"gone", formationName:"Last Watch", kingdom:"blue", stormId:"storm",
    casualties:{...emptyUnits(), bridgeman:3, chull:1}, survivors:emptyUnits(), finalRate:.95}];
  expect(resolutionReport(state, events, "blue")).toContain("Last Watch: Highstorm losses: 3 Bridgemen, 1 Chull");
  expect(resolutionReport(state, events, "red")).not.toContain("Last Watch");
  expect(lossSummary(emptyUnits())).toBe("none");
});

test("a large resolution stays within a Spanreed-sized report and points to the full journal", () => {
  const state = scenario();
  state.formations = [{ id: "many", name: "Many", kingdom: "blue", position: "A1",
    units: {...emptyUnits(), spearman: 1}, history: [], order: {kind:"hold",route:[],onDefeat:"continue"} }];
  state.arrivals = [];
  const events: Event[] = Array.from({length: 500}, () => ({type:"move",formation:"many",step:1,from:"A1",to:"A2"}));
  const body = resolutionReport(state, events, "blue");
  expect(body.length).toBeLessThan(6_200);
  expect(body).toContain("more events are in the Conflict Board journal");
});
