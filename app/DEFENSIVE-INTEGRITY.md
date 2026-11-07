# Defensive Integrity view

The header switches between the original Pitch Tiling viewer and Defensive
Integrity. The app starts in Defensive Integrity; its toggle shows the model
legend as a tooltip only while selected. Both views use the same clips and playback controls. Integrity defaults to
pitch control, players and ball, with tiles, links, facing and halos off. Mesh
settings offers four maps plus optional defender links, tiles, marking assignments
and facing indicators. The diagnostic panel reports current protection, threat,
assignment and nearest-attacker marking, free attacker, orientation, legacy tile
integrity, broken links and stretched tiles.

The equations and saved fits come from `defensive_shape_integrity.ipynb` on main:

- Pitch control: the fitted arrival-time race, including reaction, turning,
  individual acceleration and top speed, and the ball-time tie break.
- Potential danger: `P_success * V_context - (1-P_success) * V_opponent - V_ball`.
  The Legacy definition switch uses the original viewer's spatial EPV proxy and
  original colour scale instead.
- Pass value: the best receiver-specific net EPV gain at each cell, including the
  additional on-time arrival gate used by the receiving halos. This is an extension
  of the notebook, not a separately calibrated probability. The raster evaluates
  current movement and active off-ball runs, the fitted run credit, ball flight,
  interception at eight checkpoints, and ground/lofted alternatives.
- Defensive Tiling: outfield defenders only; tile strength is mean defensive
  control, links use weakest defensive control, and links over 30 m are omitted.
  Stretched triangles are marked separately. Current integrity is the notebook's
  location-value-weighted protection beyond `ball_x - 5 m`, not the old tile score.

Maps use a one-metre grid covering the actual pitch. The fitted location-value
table retains the notebook's standard-pitch coordinates and nearest-cell lookup.
Point evaluations use exact interception checkpoint positions (as `value_points`
does), rather than the grid-snapped checkpoints used by the notebook's raster.
Facing remains inferred from motion or the ball, rather than measured body pose.
Short possession gaps use the existing 30-frame team-possession grace period;
player positions, ball positions and all model values continue to update.

## Pass recommendations

Both views pause at each recorded pass release for one real second, independent
of playback speed. Options are computed once at release with the notebook's
projected-receiver `value_points` calculation and fitted context value, ranked by
net EPV gain. One option per receiver, with destinations at least two metres apart,
prevents duplicate recommendations. At most five recorded options are shown; fewer
are shown if fewer distinct options exist. Only when annotations are absent do
tracked off-ball teammates provide fallback options, explicitly labelled in the UI.

Dashed arrow geometry stays frozen through the next possession start, including
interception or unsuccessful passes. The slimmer lines ease out as the ball travels:
opacity = min(1, 1.2 × (1 − smoothstep(min(1, pass progress / 0.6)))). The 20% boost is capped at
full opacity; the one-second preview stays fully opaque and arrows are transparent
by 60% of flight. Playback clamps to that completion frame before removing
the overlay, even at high speed or across skipped render frames. A gold casing marks the best recommendation; other arrows have white casings.
Darker inner dashes mean higher-value passes. Filled arrowheads replace numbered
endpoint circles; the legend is in the selected Defensive Integrity toggle’s info tooltip.
The on-pitch preview adds no text banner. Ranking still uses net EPV gain,
including when all available options have negative gain. Scrubbing clears the overlay and seeks
the event controller; replay resets the one-time pause history.

## Validation

Tests cover an independent scalar Python reference for the notebook equations,
stadium-direction symmetry, one-to-one optimal marking, distinct receiver ranking,
pause duration, completion-frame retention, seeking/replay, both viewer modes,
all map choices, legacy danger, server resources and Docker packaging. The stored
reference is a formula check, not a rerun of the notebook's fitting or validation.

The normal pitch height is capped to leave the playback bar within the visible
viewport. Initial loading reveals Play only if needed; later playback never
automatically scrolls. The expanded pitch keeps its existing full-screen layout.
