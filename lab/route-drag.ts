/** Pointer gestures only. Route legality remains in the existing planning helper. */
export function attachRouteDrag(root: HTMLElement, actions: {
  begin: (army: string) => void;
  visit: (position: string) => void;
  cancel: () => void;
}) {
  const controller = new AbortController(), options = {signal: controller.signal};
  let pointer: number | null = null, target: HTMLElement | null = null;
  let active = false, startX = 0, startY = 0, x = 0, y = 0;
  let lastX = 0, lastY = 0, lastNode = "", timer = 0, frame = 0, suppressClick = false;
  const visit = (px: number, py: number) => {
    const tile = document.elementFromPoint(px, py)?.closest<HTMLElement>("[data-player-position]");
    const id = tile?.dataset.playerPosition;
    if (id && id !== lastNode) { actions.visit(id); lastNode = id; }
  };
  const sweep = () => {
    const steps = Math.max(1, Math.ceil(Math.hypot(x-lastX,y-lastY)/6));
    for(let i=1;i<=steps;i++) visit(lastX+(x-lastX)*i/steps,lastY+(y-lastY)*i/steps);
    lastX=x;lastY=y;
  };
  const scroll = () => {
    if (!active) return;
    const delta = y < 70 ? -9 : y > innerHeight-90 ? 9 : 0;
    if (delta) { window.scrollBy(0,delta); visit(x,y); }
    frame=requestAnimationFrame(scroll);
  };
  const finish = (cancel: boolean) => {
    clearTimeout(timer);cancelAnimationFrame(frame);
    if(active && cancel) actions.cancel();
    if(active) suppressClick=true;
    target?.classList.remove("drag-armed");
    const old=target,id=pointer;pointer=null;target=null;active=false;lastNode="";
    if(id!==null && old?.hasPointerCapture(id))old.releasePointerCapture(id);
  };
  const begin = () => {
    if (!target) return;
    active=true;suppressClick=true;target.classList.add("drag-armed");
    actions.begin(target.dataset.own!);sweep();scroll();
  };
  root.addEventListener("pointerdown", e => {
    if(pointer!==null || !e.isPrimary || e.button!==0)return;
    const army=(e.target as Element).closest<HTMLElement>("[data-own]");
    if(!army)return;
    suppressClick=false;target=army;pointer=e.pointerId;
    x=startX=lastX=e.clientX;y=startY=lastY=e.clientY;
    army.setPointerCapture(pointer);
    if(e.pointerType!=="mouse")timer=window.setTimeout(begin,320);
  },options);
  root.addEventListener("pointermove",e=>{
    if(e.pointerId!==pointer)return;
    x=e.clientX;y=e.clientY;
    if(!active && Math.hypot(x-startX,y-startY)>7) {
      if(e.pointerType==="mouse")begin();
      else {suppressClick=true;finish(false);return;}
    }
    if(active){e.preventDefault();sweep();}
  },options);
  root.addEventListener("pointerup",e=>{if(e.pointerId===pointer)finish(false)},options);
  root.addEventListener("pointercancel",e=>{if(e.pointerId===pointer){suppressClick=true;finish(true)}},options);
  root.addEventListener("lostpointercapture",e=>{if(e.pointerId===pointer)finish(true)},options);
  root.addEventListener("click",e=>{
    if(suppressClick && (e.target as Element).closest("[data-own]")){e.preventDefault();e.stopImmediatePropagation();suppressClick=false;}
  },{...options,capture:true});
  window.addEventListener("blur",()=>finish(true),options);
  document.addEventListener("visibilitychange",()=>{if(document.hidden)finish(true)},options);
  window.addEventListener("keydown",e=>{if(e.key==="Escape"){finish(true);actions.cancel()}},options);
  return ()=>{finish(false);controller.abort()};
}
