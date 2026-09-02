# Plan 10: `@lena/gps`

## Outcome

Pure offline country resolution and transition primitives that persist only privacy-minimized observations and user-review proposals.

## Public surface

- Ephemeral coordinate sample accepted only by the resolver boundary.
- Zod-validated ephemeral samples, boundary datasets, policies, and events without using parsing
  to recreate runtime authority.
- One Flatbush index per validated boundary dataset, followed by modular Turf point-in-polygon,
  distance, bounds, and GeoJSON primitives only for matching candidates.
- Persistable country observation with no coordinates.
- date-fns duration arithmetic, es-toolkit collection mechanics, and exhaustive ts-pattern state
  transitions where the reducer is complex.
- Deterministic transition reducer with versioned thresholds.
- Idempotent transition effect identity.

## Invariants

- Raw latitude and longitude never appear in a persistable type.
- Country resolution requires no Lena or Jetseen server.
- A detected transition is a proposal, not canonical travel data.
- Applications own approval, trip creation, and legal calculations.
- Manual correction wins over automatic observation.
- A resolution is transiently bound to its exact coordinate sample. The coordinate-free
  persistable observation is strict schema data, not an authority token.
- A country resolution is bound to the exact sample and dataset used to produce it.
- Turf provides geometry only. Lena owns input limits, antimeridian normalization, country
  priority, runtime opacity, privacy minimization, and review-first policy.

## Tests

- Persisted object shape contains no coordinate fields.
- Polygon boundaries, holes, antimeridian, overlaps, and no-country cases.
- Accuracy, dwell, repeated observation, bouncing-border, stale, and out-of-order behavior.
- Reducer replay and duplicate effect idempotency.
- Static scans for coordinate persistence names in public durable types.
- Structural forgery, JSON round trip, object spread, sample swapping, dataset swapping, and invalid
  coarse/high-accuracy combinations.
- fast-check properties cover coordinate domains, boundary classifications, ordering, replay, and
  persistence-shape invariants alongside named adversarial cases.

## Native gate

Audited boundary data, Expo Location/TaskManager integration in the application, and signed-device walking/driving/flight/border/battery evidence. Thresholds remain provisional until device evidence exists.
