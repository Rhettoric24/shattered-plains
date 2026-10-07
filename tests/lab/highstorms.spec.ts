import {test,expect} from "@playwright/test";
test("weather toggle immediately exposes armies, saves knobs and does not repeat on load",async({page})=>{
 const errors:string[]=[],external:string[]=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!r.url().startsWith('http://127.0.0.1:4186/'))external.push(r.url())});
 await page.goto('/');await page.locator('#stormToggle').click();
 await expect(page.locator('#stormPanel h2')).toContainText('ACTIVE');await expect(page.locator('#status')).toContainText('Cycle 0');
 await page.locator('#save').click();
 const before=await page.evaluate(()=>JSON.parse(localStorage.getItem('conflict-lab')!));
 expect(before.history.flatMap((r:any)=>r.events).some((e:any)=>e.type==='highstorm')).toBe(true);
 await page.reload();await page.locator('#load').click();await page.locator('#save').click();
 const loaded=await page.evaluate(()=>JSON.parse(localStorage.getItem('conflict-lab')!));expect(loaded.state).toEqual(before.state);expect(loaded.history).toEqual(before.history);
 await page.locator('#stormPanel summary').first().click();await page.locator('#stormRaid').fill('3');await page.locator('#stormApply').click();
 await page.locator('#playerMode').click();await expect(page.locator('#stormPanel h2')).toContainText('ACTIVE');
 await expect(page.locator('[data-player-position="B3"]')).toContainText('Unknown');
 await page.locator('#stormToggle').click();await expect(page.locator('#stormPanel h2')).toContainText('Clear skies');
 await page.locator('#playerSave').click();const ended=await page.evaluate(()=>JSON.parse(localStorage.getItem('conflict-lab')!));
 expect(ended.config.highstorm.raidMultiplier).toBe(3);expect(ended.state.formations).toEqual(before.state.formations);
 expect(errors).toEqual([]);expect(external).toEqual([]);
});
