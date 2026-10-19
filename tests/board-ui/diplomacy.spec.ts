import { expect, test } from "@playwright/test";
import { buildSync } from "esbuild";

test("shared petitions render on mobile and plateau donation requires confirmation", async ({ page }) => {
  await page.route('**/diplomacy-fixture', route => route.fulfill({ contentType:'text/html', body:'<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/shattered-plains/shattered-plains-styles.css"><link rel="stylesheet" href="/shattered-plains/clarity-components.css"><link rel="stylesheet" href="/shattered-plains/clarity-responsive.css"><section class="panel"><h2>Parshendi Diplomacy</h2><div id="diplomacy"></div></section>' }));
  await page.route('**/diplomacy-fixture.js', route => route.fulfill({ contentType:'text/javascript', body:buildSync({entryPoints:['outputs/diplomacy-ui.js'],bundle:true,format:'esm',write:false}).outputFiles[0].text }));
  await page.goto('/diplomacy-fixture');
  await page.evaluate(async () => {
    const m = await import('/diplomacy-fixture.js'), w = window as any;
    const d = { favor:0,cap:5,hostility:75,reserveGemhearts:0,tribute:{spheres:10000,gemhearts:1,sphereCredit:5000,gemheartCredit:0,window:{spheres:0,gemhearts:0}},tiers:[{cost:5,power:1000,name:'Chasmfiend'}],petitions:[{id:'plateau',kind:'plateau',title:'Return Stormwatch',objective:'Relinquish Stormwatch immediately.',favor:1,hostilityReduction:15,expiresAt:Date.now()+86400000,missing:null}] };
    w.calls=[];w.allow=false;
    w.ui=m.createDiplomacyUI({root:document.getElementById('diplomacy'),mutate:async (name:string,args:any)=>{w.calls.push({name,args});return {favorGranted:0}},refresh:async()=>({...d,favor:1,petitions:[]}),confirm:()=>w.allow});
    w.ui.update(d,{spheres:10000,gemhearts:1});
  });
  await expect(page.getByRole('button',{name:'Deliver Spheres'})).toHaveCount(0);
  await expect(page.getByRole('progressbar')).toHaveCount(2);
  await page.getByRole('spinbutton',{name:'Exact donation amount'}).fill('5000');
  await expect(page.locator('[data-donation-preview]')).toContainText('Hostility −4');
  await page.getByRole('button',{name:'Gemhearts',exact:true}).click();
  await expect(page.getByRole('spinbutton',{name:'Exact donation amount'})).toHaveValue('1');
  await page.getByRole('button',{name:'Spheres',exact:true}).click();
  await expect(page.getByRole('spinbutton',{name:'Exact donation amount'})).toHaveValue('5000');
  await page.getByRole('button',{name:'Donate Plateau'}).click();
  expect(await page.evaluate(()=>(window as any).calls)).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`test-results/diplomacy-${page.viewportSize()!.width}.png`,fullPage:true});
  await page.evaluate(()=>(window as any).allow=true);
  await page.getByRole('button',{name:'Donate Plateau'}).click();
  await expect(page.getByText('Fulfilled. Favor received.')).toBeVisible();
  expect(await page.evaluate(()=>(window as any).calls)).toEqual([{name:'diplomacy:fulfill',args:{petitionId:'plateau'}}]);
  await page.getByRole('button',{name:'Donate 5,000 Spheres',exact:true}).click();
  await expect(page.getByText('Donation sent. +0 Favor; remaining progress saved.')).toBeVisible();
  expect(await page.evaluate(()=>(window as any).calls[1])).toMatchObject({name:'diplomacy:tribute',args:{resource:'spheres',amount:5000}});
  await page.getByRole('button',{name:'Gemhearts',exact:true}).click();
  await page.getByRole('button',{name:'Donate 1 Gemheart',exact:true}).click();
  expect(await page.evaluate(()=>(window as any).calls[2])).toMatchObject({name:'diplomacy:tribute',args:{resource:'gemhearts',amount:1}});
});

test("Occupation shows the capture objective and claims only after server eligibility", async ({page})=>{
  await page.route('**/occupation-fixture',route=>route.fulfill({contentType:'text/html',body:'<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/shattered-plains/shattered-plains-styles.css"><link rel="stylesheet" href="/shattered-plains/clarity-components.css"><link rel="stylesheet" href="/shattered-plains/clarity-responsive.css"><section class="panel"><div id="diplomacy"></div></section>'}));
  await page.route('**/occupation-fixture.js',route=>route.fulfill({contentType:'text/javascript',body:buildSync({entryPoints:['outputs/diplomacy-ui.js'],bundle:true,format:'esm',write:false}).outputFiles[0].text}));
  await page.goto('/occupation-fixture');
  await page.evaluate(async()=>{
    const m=await import('/occupation-fixture.js'),w=window as any;
    w.calls=[];w.d={favor:0,cap:5,hostility:75,reserveGemhearts:0,tribute:{spheres:10000,gemhearts:1,sphereCredit:0,gemheartCredit:0,window:{spheres:0,gemhearts:0}},tiers:[],petitions:[{id:'occupation',kind:'occupation',title:'Break the Occupation',objective:'Capture Stormwatch from Red through PvP, keep control and claim.',favor:1,hostilityReduction:15,expiresAt:Date.now()+86400000,missing:'Capture this plateau during the petition and keep control.'}]};
    w.ui=m.createDiplomacyUI({root:document.getElementById('diplomacy'),mutate:async(name:string,args:any)=>w.calls.push({name,args}),refresh:async()=>({...w.d,favor:1,petitions:[]})});
    w.ui.update(w.d,{spheres:10000,gemhearts:1});
  });
  await expect(page.getByText('Break the Occupation',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Claim Reward'})).toBeDisabled();
  await page.evaluate(()=>{const w=window as any;w.d.petitions[0].missing=null;w.ui.update(w.d,{spheres:10000,gemhearts:1});});
  await page.getByRole('button',{name:'Claim Reward'}).click();
  await expect(page.getByText('Fulfilled. Favor received.')).toBeVisible();
  expect(await page.evaluate(()=>(window as any).calls)).toEqual([{name:'diplomacy:fulfill',args:{petitionId:'occupation'}}]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
