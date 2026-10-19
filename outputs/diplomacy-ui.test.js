import { expect, test } from "vitest";
import { diplomacyMarkup, donationPreview } from "./diplomacy-ui.js";
const d = { favor: 0, cap: 5, hostility: 75, tribute: { spheres:10000, gemhearts:1, sphereCredit:5000,gemheartCredit:0,window:{spheres:0,gemhearts:0} }, tiers:[{cost:5,power:1000,name:'Chasmfiend'}], reserveGemhearts:1,
  petitions:[{id:'one',title:'Return the plateau',objective:'Own and donate it',kind:'plateau',favor:1,hostilityReduction:15,expiresAt:200,missing:null}] };
test("personal donation controls show independent payments, both progress bars and resource roles", () => {
  const html = diplomacyMarkup(d,{spheres:10000,gemhearts:1,now:100});
  expect(html).toContain('Donate Plateau'); expect(html).toContain('10,000 Spheres'); expect(html).toContain('<strong>and</strong> 1 Gemheart');
  expect(html).toContain('data-donation-range'); expect(html.match(/<progress/g)).toHaveLength(2);
  expect(html).toContain('high-Hostility Deep Plains'); expect(html).toContain('move one square');
});
test("cap and client-side expiration disable destructive actions before submission", () => {
  const html = diplomacyMarkup({...d,favor:5},{spheres:100000,gemhearts:10,now:300});
  expect(html).toContain('nothing will be consumed');
  expect(html).toMatch(/data-diplomacy="tribute" disabled/);
  expect(html).toMatch(/data-petition="one" disabled/);
  expect(html).toContain('Expired;');
});
test("preview accounts for both requirements, overflow, and the Favor cap before payment",()=>{
  expect(donationPreview(d,"spheres",5000,10000)).toMatchObject({favorGranted:0,sphereCredit:10000,reduction:4});
  expect(donationPreview({...d,tribute:{...d.tribute,sphereCredit:15000}},"gemhearts",1,2)).toMatchObject({favorGranted:1,sphereCredit:5000,gemheartCredit:0,reduction:4});
  expect(donationPreview({...d,favor:4,tribute:{...d.tribute,sphereCredit:20000}},"gemhearts",2,2).missing).toContain('cap');
});
test("legacy resource petitions are never offered as rotating actions",()=>{
  const html=diplomacyMarkup({...d,petitions:[{...d.petitions[0],kind:'supplies',title:'Old supply payment'}]});
  expect(html).not.toContain('Old supply payment'); expect(html).toContain('No active petitions');
});
