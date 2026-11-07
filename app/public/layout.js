// Reserve room for playback controls instead of sizing the pitch from width alone.
export function playbackPitchHeight({viewportHeight,pitchWidth,pitchTop,controlsHeight,controlsMargins=0,mobile=false}){
 const natural=pitchWidth/(mobile?1.5:1.6);
 const available=viewportHeight-pitchTop-controlsHeight-controlsMargins-16;
 return Math.floor(Math.min(natural,Math.max(96,available)));
}
