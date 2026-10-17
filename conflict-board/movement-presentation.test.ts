import { expect, test } from 'vitest';
import { retreatShade, queuedRouteHints } from './movement-presentation';
import { scenario, defaults } from '../lab/scenarios';
import { projectConflict } from './disclosure';
import { resolveCycle } from './resolver';
import { emptyUnits } from '../convex/rules';

test.each([false,true])('gold timing agrees with resolver multi-square movement (Speed=%s)', speed => {
  const state=scenario(), f=state.formations.find(f=>f.kingdom==='blue')!;
  f.units={...emptyUnits(),...(speed?{bridgeman:100}:{spearman:100})};
  const own=projectConflict(state,'blue',{},true,defaults).own[0];
  const hints=queuedRouteHints(own,{nextCycleAt:100});
  expect(hints.map(h=>h.resolution)).toEqual(speed?[1,1,2,2]:[1,2,3,4]);
  const result=resolveCycle({state,config:defaults,cycle:1,seed:'timing'});
  const moves=result.events.filter(e=>e.type==='move'&&e.formation===f.id);
  expect(moves.map(e=>e.type==='move'?e.to:null)).toEqual(hints.filter(h=>h.resolution===1).map(h=>h.position));
});
test('travel arrival offset, exact boundaries, paused and missing projections stay conservative',()=>{
  const state=scenario(), f=state.formations[1];
  const row={formation:f,stats:{specialization:'Speed'},traveling:true};
  expect(queuedRouteHints(row,{nextCycleAt:100,resolutionIntervalMs:20,arriveAt:100}).map(h=>h.resolution)).toEqual([1,1,2,2]);
  expect(queuedRouteHints(row,{nextCycleAt:100,resolutionIntervalMs:20,arriveAt:121}).map(h=>h.resolution)).toEqual([3,3,4,4]);
  expect(queuedRouteHints({...row,stats:undefined},{nextCycleAt:100}).every(h=>h.resolution===null)).toBe(true);
  f.order.paused=true;expect(queuedRouteHints(row,{nextCycleAt:100,resolutionIntervalMs:20,arriveAt:100}).every(h=>h.resolution===null)).toBe(true);
});
test('Lab purple fallback ordering excludes current, uses truncated stored history only',()=>{
  const f={position:'B2',history:['approach','B3','B2']};
  expect(retreatShade(f,'B2')).toBeNull();expect(retreatShade(f,'B3')?.depth).toBe(1);expect(retreatShade(f,'approach')?.depth).toBe(2);
  expect(retreatShade({position:'B3',history:['approach','B3']},'B2')).toBeNull();
  expect(retreatShade({position:'B3',history:['B3']},'approach')).toBeNull();
});
test('travel stats remain own-only; enemy arrivals and history do not enter the DTO',()=>{
  const state=scenario();
  const blue=state.formations[1],red=state.formations[0];
  state.arrivals=[{id:'own-arrival',cycle:2,formation:blue},{id:'HIDDEN-ARRIVAL',cycle:2,formation:{...red,name:'HIDDEN-NAME'}}];
  const view=projectConflict(state,'blue',{},true,defaults);
  expect(view.ownArrivals).toHaveLength(1);expect(view.ownArrivals[0].stats?.specialization).toBeDefined();
  expect(JSON.stringify(view)).not.toMatch(/HIDDEN-ARRIVAL|HIDDEN-NAME/);
});

test('conditional Speed hints do not promise the second step after a battle',()=>{
  const state=scenario('Speed screen'), own=projectConflict(state,'blue',{},true,defaults).own[0];
  expect(queuedRouteHints(own,{nextCycleAt:100}).filter(h=>h.resolution===1)).toHaveLength(2);
  const result=resolveCycle({state,config:defaults,cycle:1,seed:'interrupt'});
  expect(result.events.filter(e=>e.type==='move'&&e.formation===own.formation.id)).toHaveLength(1);
});
