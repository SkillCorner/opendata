export const POSSESSION_HOLD_FRAMES=30;
const known=f=>f?.possession?.player_id!=null||['home team','away team'].includes(f?.possession?.group);
// Source frame numbers, not playback speed or draw calls, define this grace period.
export function possessionSource(frames,index){
 const current=frames[index];
 if(known(current))return {index,heldFrames:0,reason:null};
 for(let i=index-1;i>=0&&index-i<POSSESSION_HOLD_FRAMES;i--){
  if(frames[i].period!==current.period||frames[i+1].frame-frames[i].frame!==1)break;
  const elapsed=current.frame-frames[i].frame;
  if(elapsed>=POSSESSION_HOLD_FRAMES)break;
  if(known(frames[i]))return {index:i,heldFrames:elapsed,reason:null};
 }
 return {index:null,heldFrames:0,reason:`No recent possession (${POSSESSION_HOLD_FRAMES}-frame hold expired or no prior possession in this clip)`};
}
