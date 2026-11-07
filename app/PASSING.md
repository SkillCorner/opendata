# Receiving halos

Enabled by default under Mesh & colour settings. Every off-ball teammate of the
team in possession is evaluated on a one-metre pitch grid. Overlapping halos show
the highest individual receiving probability, without adding probabilities.
The carrier is excluded; when only team possession is recorded, the closest
teammate to the ball is treated as the carrier. Unknown possession hides halos.

The model uses the settings saved by PR #3, player physical profiles (including
the notebook's position-group / population fallback), smoothed tracking velocity,
reaction drift, acceleration, turning, and the eight-checkpoint interception model.
Ground and lofted passes use their respective fitted speeds, hang time and control
factor. Active off-ball runs use event endpoints converted back to stadium
coordinates; otherwise motion is projected up to two seconds. Missing run events
fall back to velocity or standing position.

Unlike the notebook's team-level race, each halo evaluates one receiver. Fitted
run credit is applied relative to that receiver's projected point. An additional
sigmoid arrival gate requires the receiver to reach the destination around ball
arrival. This prevents distant players winning an empty-space race merely because
the defenders are even farther away. This receiver-specific extension has not
been independently calibrated; the notebook's validation scores do not transfer
directly to it. Colours encode completion chance, not EPV or attacking reward.

Probability below 0.01 (1%) is transparent. A fixed linear scale maps the
remaining probabilities from pale white/green to vivid green. No frame-based
normalisation or colour interpolation creates halos below the cutoff. The mesh
is drawn beneath the overlay, and player / ball markers above it.
