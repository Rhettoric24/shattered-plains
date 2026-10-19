import { expect, test } from "vitest";
import { diplomacyMarkup } from "./diplomacy-ui.js";
const d = { favor: 0, cap: 5, hostility: 75, tribute: { spheres:10000, gemhearts:1, hostilityReduction:12 }, tiers:[{cost:5,power:1000,name:'Chasmfiend'}], reserveGemhearts:1,
  petitions:[{id:'one',title:'Return the plateau',objective:'Own and donate it',kind:'plateau',favor:1,hostilityReduction:15,expiresAt:200,missing:null}] };
test("Diplomacy makes immediate actions, both tribute costs and resource roles explicit", () => {
  const html = diplomacyMarkup(d,{spheres:10000,gemhearts:1,now:100});
  expect(html).toContain('Donate Plateau'); expect(html).toContain('10,000 Spheres'); expect(html).toContain('<strong>and</strong> 1 Gemheart');
  expect(html).toContain('high-Hostility Deep Plains'); expect(html).toContain('move one square');
});
test("cap and client-side expiration disable destructive actions before submission", () => {
  const html = diplomacyMarkup({...d,favor:5},{spheres:100000,gemhearts:10,now:300});
  expect(html).toContain('Nothing will be consumed');
  expect(html).toMatch(/data-diplomacy="tribute" disabled/);
  expect(html).toMatch(/data-petition="one" disabled/);
  expect(html).toContain('Expired;');
});
