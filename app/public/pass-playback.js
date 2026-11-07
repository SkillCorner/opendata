// Pause for one wall-clock second at release; retain frozen recommendations until
// the next possession begins, including unsuccessful passes and interceptions.
export class PassPlayback{
 constructor(){this.reset();}
 reset(){this.active=null;this.until=0;this.seen=new Set();}
 seek(frame,period,passes){this.reset();this.seen=new Set(passes.filter(p=>p.period===period&&p.release<frame).map(p=>p.id));}
 advance(current,proposed,frames,passes,now){
  if(this.until>now)return {index:current,waiting:true,event:this.active};
  const a=frames[current],b=frames[proposed];if(!a||!b)return {index:current};
  if(this.active&&a.period===this.active.period&&a.frame<this.active.complete&&b.frame>this.active.complete){
   const completion=frames.findIndex((f,i)=>i>=current&&f.period===this.active.period&&f.frame>=this.active.complete);
   if(completion>=0)return {index:completion,waiting:false,event:this.active};
  }
  if(this.active&&(a.period!==this.active.period||a.frame>=this.active.complete))this.active=null;
  const event=passes.find(p=>p.period===a.period&&p.release>=a.frame&&p.release<=b.frame&&!this.seen.has(p.id));
  if(event){const releaseIndex=frames.findIndex((f,i)=>i>=current&&f.period===event.period&&f.frame>=event.release);
   if(releaseIndex<0)return {index:proposed,event:this.active};
   this.active=event;this.seen.add(event.id);this.until=now+1000;return {index:releaseIndex,waiting:true,event};
  }
  return {index:proposed,waiting:false,event:this.active};
 }
}
