const legacy={title:'Legacy definition',text:'Original, unfitted danger proxy: goal distance and angle, defensive pressure, reach and interception. Blue/red identify attacking directions. Recommendations still use the notebook model.',equation:'D = Σ sign × possession × lane safety × readiness × control × V'};
export const SETTING_HELP={
 viewIntegrity:{title:'Defensive Integrity',text:'Fitted notebook model. Control: blue defence / red attack. Danger and pass value: blue loss / red gain. Tiles: red weak / green strong. Passes: 1 s preview; up to five distinct arrows. Gold outline = best; darker = higher gain. Arrows fade by 60% of flight.'},
 mode:{title:'Geometry',text:'Delaunay connects nearby sites into triangles. Voronoi assigns each location to its nearest site. Both describe spacing, not pass probability.'},
 team:{title:'Players',text:'Filters player markers and sites in Pitch Tiling. Changes the mesh, while scoring models continue to use both teams.'},
 colour:{title:'Triangle colour'},
 integrityColour:{title:'Defensive Integrity colour'},
 legacyDanger:legacy,
 integrityConnections:{title:'Defender links',text:'Weakest defensive control along each defender link. Green ≥ 50%; dashed red < 50%. Links over 30 m are omitted.',equation:'S_link = min(1 − P_att)'},
 integrityTiles:{title:'Defender tiles',text:'Average defensive control inside each defender triangle. Red is weak; green strong. Any side over 30 m makes a stretched tile.',equation:'S_tile = mean(1 − P_att)'},
 integrityMarking:{title:'Marking assignments',text:'One-to-one defender assignments minimise arrival time. Coverage compares defender arrival with ball travel plus 1 s; halve it when not goal-side. A diagnostic, not part of integrity.',equation:'Coverage = logistic(k(t_ball + 1 − t_def)) × goal-side factor'},
 integrityFacing:{title:'Player facing',text:'Faces along movement above 1.5 m/s, otherwise toward the ball. Inferred from tracking, not body pose. Turning delays arrival.',equation:'Turn time = angle / fitted turning speed'},
 ball:{title:'Ball as a vertex',text:'Adds the ball to the triangulation or Voronoi geometry. The ball marker and ball-based calculations remain visible when off.'},
 ballOnly:{title:'Ball-adjacent tiles',text:'Dims triangles without a ball vertex. Enable “Include ball as a vertex” to use this highlight. Scores stay unchanged.'},
 showEstimates:{title:'Estimated-position indicators',text:'Amber dashed markings identify estimated, off-camera positions. Turning this off hides the indicators, not the players.'},
 detected:{title:'Detected positions only',text:'Hides estimated markers and original mesh sites. Scoring models still include estimated players and their influence.'},
 match:{title:'Match',text:'Chooses the match’s chance list and phases. Select a chance or load a custom clip to update the pitch.'},
 chanceFilter:{title:'Chance filter',text:'High EPV: confirmed goals or peak possession EPV ≥ 0.10. Goals: confirmed goals only. All: every recorded shot/goal. EPV is not shot xG.'},
 chance:{title:'Danger chances',text:'Loads about 20 s before a shot/goal and 8 s afterwards, bounded to the half. Pass previews pause for 1 real second. Gold outline = best; darker = higher gain. Arrows fade out by 60% of flight.'},
 phase:{title:'Phase of play',text:'Uses a recorded tactical phase’s start frame. Press “Load tracking clip” to apply the selected start and duration.'},
 start:{title:'Start frame',text:'First source frame for a custom clip. Tracking is 10 frames/s. Press “Load tracking clip” to apply.'},
 duration:{title:'Clip length',text:'Custom clip length: 15, 30 or 60 s. Recorded chance clips use their own interval. Press “Load tracking clip” to apply.',equation:'Frames = seconds × 10'},
 speed:{title:'Playback speed',text:'Changes tracking speed; pass previews pause for 1 real second. Gold-outlined arrow = best recommendation; darker = higher value. Arrows fade out during the first 60% of flight at any speed.'}
};
const tilingColours={
 area:{title:'Triangle area',text:'Teal for small triangles, amber for large ones. Measures spacing in m², not defensive quality.',equation:'A = |(x₂−x₁)(y₃−y₁) − (y₂−y₁)(x₃−x₁)| / 2'},
 team:{title:'Team composition',text:'Team colours for single-team triangles; mixed colour otherwise. Team colours follow attacking directions in the current half.'},
 access:{title:'Ball access',text:'Best direct pass or carry within five seconds, including opponent reach and lane safety. For tiles, use the best of four interior targets. Red is hard; green easy. Heuristic, not calibrated probability.',equation:'Access = max_targets(max(pass score, carry score))'},
 danger:{...legacy,title:'Potential danger · original definition'}
};
const integrityColours={
 control:{title:'Pitch control',text:'Fitted arrival-time race: speed, acceleration, movement, reaction, turning and ball travel. Blue: defence; white: 50%; red: attack. Does not deduct lane interceptions.',equation:'P_att = logistic(k(ẽ_def − ẽ_att))\nẽ = max(t_player, t_ball) + βt_player'},
 danger:{title:'Potential danger · notebook definition',text:'Expected net EPV gain, including turnover risk. Success tests ground/lofted passes and interception. Context value includes pressure, defender distance and defenders ahead.',equation:'G = pV_context − (1−p)V_opponent − V_ball\np = max(p_ground, p_loft)'},
 pass:{title:'Pass value',text:'Best off-ball receiver per cell: projected runs, fitted movement, interception and an arrival gate. Blue: loss; red: gain. Extends the notebook model. Recommendation arrows: gold outline = best; darker = higher gain; fade ends at 60% of flight.',equation:'Gᵢ = pᵢV_context − (1−pᵢ)V_opponent − V_ball\nPass value = maxᵢ Gᵢ'},
 tiles:{title:'Defensive Tiling',text:'Defender triangles and links: red weak, green strong. Integrity weights denied passes by location value in space at/beyond the ball, with a 5 m buffer. Marking is separate.',equation:'S_tile = mean(1−P_att); S_link = min(1−P_att)\nIntegrity = Σ V_location(1−p_success) / Σ V_location'}
};
export function settingHelp(id,value,legacySelected=false){
 if(id==='colour')return tilingColours[value]??tilingColours.danger;
 if(id==='integrityColour')return value==='danger'&&legacySelected?{...legacy,title:'Potential danger · legacy definition'}:integrityColours[value]??integrityColours.control;
 return SETTING_HELP[id]??{title:'Setting',text:'Changes the displayed view.'};
}
