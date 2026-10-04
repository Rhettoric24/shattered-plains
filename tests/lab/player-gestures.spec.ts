import {test,expect, type Page} from "@playwright/test";
async function points(page:Page) {
  await page.locator('[data-own="Vanguard"]').scrollIntoViewIfNeeded();
  const center=async(selector:string)=>{const b=await page.locator(selector).boundingBox();if(!b)throw Error(selector);return{x:b.x+b.width/2,y:b.y+b.height/2}};
  return {army:await center('[data-own="Vanguard"]'),one:await center('[data-player-position="B3"]'),two:await center('[data-player-position="B2"]')};
}
test("army modal stats, disabled raid and mouse route backtracking",async({page})=>{
  await page.goto('/');await page.locator('#playerMode').click();
  await page.locator('[data-own="Vanguard"]').click();
  await expect(page.locator('#playerArmyDialog')).toBeVisible();
  await expect(page.locator('#ownInfo')).toContainText('Normalized Speed / Survive / Plunder');
  await expect(page.locator('#ownInfo')).toContainText('Cargo');
  await expect(page.locator('#playerRaid')).toBeDisabled();
  await expect(page.locator('#playerRaidHint')).toContainText('flank');
  await page.locator('#playerClose').click();
  const p=await points(page);
  await page.mouse.move(p.army.x,p.army.y);await page.mouse.down();
  await page.mouse.move(p.one.x,p.one.y,{steps:15});
  await page.mouse.move(p.two.x,p.two.y,{steps:15});
  await expect(page.locator('#draftPath')).toHaveText('approach → B3 → B2');
  await page.mouse.move(p.one.x,p.one.y,{steps:15});
  await expect(page.locator('#draftPath')).toHaveText('approach → B3');
  await page.mouse.up();await expect(page.locator('#playerArmyDialog')).not.toBeVisible();
  await page.locator('#playerCancel').click();
  await page.locator('[data-own="Vanguard"]').click();
  await expect(page.locator('#playerRoute')).toHaveValue('B3, B2, B1, post');
  await page.locator('#playerClose').click();
});
test("touch hold draws a route, cancellation preserves order, confirmation commits",async({browser})=>{
  const context=await browser.newContext({viewport:{width:390,height:1000},hasTouch:true,isMobile:true});
  const page=await context.newPage();
  try {
    await page.goto('http://127.0.0.1:4186/');await page.locator('#playerMode').tap();
    const p=await points(page), cdp=await context.newCDPSession(page);
    const send=async(type:string,point?:{x:number,y:number})=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:point?[{...point,id:1}]:[]});
    await send('touchStart',p.army);await page.waitForTimeout(400);
    await send('touchMove',p.one);await send('touchMove',p.two);
    await expect(page.locator('#draftPath')).toHaveText('approach → B3 → B2');
    await send('touchCancel');await expect(page.locator('#playerRouteBar')).toBeHidden();
    await send('touchStart',p.army);await page.waitForTimeout(400);
    await send('touchMove',p.one);await send('touchEnd');
    await expect(page.locator('#playerArmyDialog')).not.toBeVisible();
    await page.locator('#playerConfirm').tap();
    await page.locator('[data-own="Vanguard"]').tap();
    await expect(page.locator('#playerRoute')).toHaveValue('B3');
  } finally {await context.close()}
});
