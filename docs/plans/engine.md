# The engine — capability gating, ready for the model

Wires the backend the design note describes: `assets.yaml` as the source of truth, a
gating function that says *why* an order fails, a storm layer that decides what is
reachable, and one adapter interface the trained persona model plugs into. Built as a
pure module that runs in the browser today and lifts into a Lambda unchanged.

Decisions already taken (from the interview):

- **Runtime:** pure TypeScript module under `engine/`. No DOM, no AWS, no globals.
- **Specs:** you are providing them. The engine defines the shape and loads whatever lands
  in `specs/`. A missing spec permits nothing, and the reject reason says so.
- **Scope:** engine + `check:engine` + wire the existing order box + rename GEO → HEO.
  Sprites stay as they are; no lat/lon projection this pass.
- **YAML:** `yaml` as a devDependency, build-time only. `assets.yaml` → `engine/assets.json`.

## What does not exist yet, stated plainly

The note says *"each seat's persona spec already has an `authority` envelope."* It does
not — not in this repo, in any format. Of the three capability sources in §7, only the
catalog is real. The gating function's first check therefore runs against specs you
have not delivered yet; until they land, every order is rejected with
`no spec for seat "norway" — nothing is permitted` rather than silently allowed. That is
deliberate: a gate that fails open while waiting for its rules is not a gate.

`assets.yaml` itself is **untracked**. It gets committed as part of this work.

## Layout

    assets.yaml                    canonical catalog (committed)
    specs/                         persona specs, one file per seat (you provide)
      _schema.yaml                 the shape the engine expects, with every field explained
    engine/
      types.ts                     Catalog, Asset, Seat, Action, Spec, Decision, Verdict, Event
      catalog.ts                   load JSON, index by id / owner / capability, resolve control
      geo.ts                       haversine, range checks, pass windows from orbit blocks
      storm.ts                     comms_availability per asset per tick; jamming; dependencies
      gate.ts                      legal(seat, action, target) → Allow | Pending | Reject
      model.ts                     PersonaModel interface; NullModel, HumanModel, RemoteModel
      log.ts                       the event log; state_change, release_requested, order_result
      engine.ts                    Engine class: tick(), order(), the one public surface
      assets.json                  generated — never edited by hand
    scripts/
      catalog.ts                   assets.yaml → engine/assets.json (runs in `npm run build`)
      engine.ts                    check:engine — the case table
    wargame/index.html             order box → engine; verdict echoed to the feed; HEO label

## Types (the contract everything else is written against)

```ts
type SeatId = 'northcom' | 'usspacecom' | 'nsc' | 'norway' | 'kremlin' | 'northern_fleet'
            | 'china' | 'starlink' | 'iridium' | 'civilians';

type ActionId = keyof Catalog['action_requirements'];   // hold, maneuver, jam, … 16 of them

interface Spec {
  seat: SeatId;
  authority: { unilateral: ActionId[]; requires_release: ActionId[] };
  // anything else in the file is preserved and ignored
}

type Verdict =
  | { kind: 'allow';   asset: AssetId; reason?: string }
  | { kind: 'pending'; asset: AssetId; release_by: SeatId; reason: string }
  | { kind: 'reject';  reason: string; because: 'spec' | 'assets' | 'range' | 'comms' | 'target' };

interface Order { seat: SeatId; action: ActionId; asset_id?: AssetId; target_id?: AssetId;
                  area?: {lat:number; lon:number; radius_km:number}; text?: string }
```

`because` is the §7 distinction made machine-readable: `spec` is out of character,
`assets` is out of platforms, `comms` is blinded or muted. The UI can colour by it.

## The gating function, as it will actually be implemented

The note's pseudocode, with each gap it leaves resolved:

```
legal(seat, action, target):
  spec = specs[seat]
  if !spec                         → Reject(spec, 'no spec for seat — nothing is permitted')
  if action ∉ spec.unilateral ∪ spec.requires_release
                                   → Reject(spec, 'spec does not permit <action>')
  req = action_requirements[action]
  if req.target_type && target.kind ≠ req.target_type
                                   → Reject(target, 'jam targets a satellite or ground site, not a ship')
  if req.target_owner_in && target.owner ∉ req.target_owner_in
                                   → Reject(target, …)
  candidates = control[seat] ∩ satisfies(req)      -- see "satisfies" below
  if none                          → Reject(assets, 'no controlled asset with <capability>')
  if order.asset_id given          → candidates = [that asset], or Reject(assets, 'seat does not control <id>')
  a = nearest candidate that is in range of target (req.range_km, or asset.range_km, or unlimited)
  if none                          → Reject(range, '<nearest> is <d> km from <target>; range <r> km')
  if req.pass_window_required && !inPass(a, target, now)
                                   → Reject(range, '<a> next pass over <target> <hh:mm>Z')
  if req.downlink_required && !downlinkUp(seat, a)
                                   → Reject(comms, 'no downlink: <station> fibre down until restored')
  if comms(a) < THRESHOLD          → Reject(comms, '<a> unreachable: comms <pct>%')
  if req.release || action ∈ spec.requires_release
                                   → emit(release_requested); Pending(release_by = req.release ?? 'nsc')
  → Allow(a)
```

**`satisfies(asset, req)`** walks `req.requires` (and `req.or`): `{effect: x}` → asset.effects
∋ x; `{sensor: x}` / `{or_sensor: y}`; `{any_of: [mobility…]}` → asset.mobility ∈ list;
`{owner_has: telemetry_of_target}` → target.owner === seat (or seat ∈ target.co_tenants);
`{controls_constellation: true}` → seat owns ≥2 satellites in the same band. `requires: []`
means any controlled asset, or none needed if the action has a `channel`
(diplomatic / public actions need no platform at all).

**THRESHOLD** = 0.5. Not in the catalog; lives in `engine/storm.ts` as one named constant.

## The storm layer

`comms(asset) = max over asset.comms of base(band) × storm[severity][band] × jam(asset, band)`

- **base** is 1.0. `fiber` and `line_of_sight` bands are 1.0 in every storm row, which is why
  a ground station on intact fibre survives a G5 that blinds every LEO user.
- **jam(asset, band)**: for each *active* jam effect in the log whose band matches and whose
  source asset is within its `range_km` of this asset, multiply by 0.15. Pechenga's
  `range_km: 300` puts Svalbard well outside it — which is the catalog being honest, not
  a bug; Gorshkov carries the same effect and moves.
- **dependencies**: an asset is *down* if any id in its `dependencies` is down. A
  `cable_interfere` on `svalbard_cable_1` takes down `svalsat_ground` only if
  `svalbard_cable_2` is also down — the catalog lists both, and one cable is the
  redundancy. This is what makes `share_telemetry` the resolving move the note describes.
- **severity** is set on the engine (`G4 | G5 | carrington`) and can change per tick.
- **pass windows**: for any satellite with an `orbit` block, period is derived (Kepler from
  altitude, or the stated `period_h`), a phase offset from the id, and a 10-minute window
  every orbit over the target area. This is a deterministic *model*, not orbital mechanics;
  it produces the "next pass 14:40Z" reject the note wants and nothing more. Stated in the
  code as such.

## The model adapter

```ts
interface PersonaModel {
  decide(req: DecisionRequest): Promise<Decision>;
}
interface DecisionRequest {
  seat: SeatId; tick: number; posture: 'Cautious'|'Balanced'|'Aggressive';
  observation: Observation;          // what THIS seat can see — assets it controls, their comms,
                                     // events it was party to, contacts exposed to it
  history: Decision[];               // its own prior decisions
}
interface Decision {
  action: ActionId;
  params: { asset_id?: AssetId; target_id?: AssetId; area?: Area };
  rationale?: string; text?: string;
}
```

Three implementations ship:

- **`NullModel`** — returns `hold`. What every seat runs on until the model is trained.
- **`HumanModel`** — resolves the next `decide()` from the order box. The human at the
  console *is* the model for their seat. This is what makes the order box a real seat
  rather than a text field.
- **`RemoteModel`** — `POST {url}` with `DecisionRequest` as JSON, expects `Decision` back,
  validates it against the schema, falls back to `hold` with a logged error on any failure
  or timeout. `url` is a constructor argument; nothing is hard-coded. **This is the piece
  that is "ready when the model is trained":** point it at the endpoint and the seat
  comes alive.

When a decision arrives without `asset_id`, the engine picks the nearest legal asset and
records it on the log event — the log always says which platform did what, and the UI
moves sprites from the log, never from the persona's prose.

## Seat mapping — a decision for you to check

The UI's five actors are not catalog seats. The mapping I intend, with the reason:

| UI actor | catalog seat | why |
|---|---|---|
| `nor` Norwegian Joint HQ | `norway` | direct |
| `rus` Northern Fleet | `northern_fleet` | direct |
| `ksat` KSAT Ground Ops | `norway` | the catalog has no KSAT seat; `svalsat_ground` is `owner: norway`, "Norway seat controls it" |
| `sar` Svalbard Governor | `norway` | `polarsyssel` is `owner: norway`; the Governor is a civil arm of the same seat |
| `obs` Observer | *none* | observes; every order rejects with `observer holds no seat` |

Three UI actors sharing one seat is a symptom of the UI predating the catalog, not a
design. The clean fix is replacing `ACTORS` with the ten catalog seats — that is UI
scope and out of this pass, but the mapping is one object in one place so the swap is
cheap.

## Order box → engine → feed

`compose.onsubmit` currently pushes the raw text as an `action`. It will instead:

1. Parse the text into an `Order`: first word is the action if it matches an `ActionId`
   (`jam svalsat_ground`, `board yantar`, `hold`); a bare sentence is `text` with no action
   and goes to the seat's `HumanModel` as free intent — which returns `hold` and echoes
   the text, exactly as today, so nothing the reader can type now becomes worse.
2. `engine.order(order)` → `Verdict`.
3. Echo to the feed as a `system` event coloured by `because`:
   `✓ Allowed — KV Svalbard tasked` / `⏳ Pending NSC release` /
   `✗ Rejected — Arctic Eye next pass over Storfjorden 14:40Z`.

Everything else the order box does (dictation, actor picker, posture) is untouched.

## Build changes

- `package.json`: `yaml` devDependency; `"catalog": "node scripts/catalog.ts"`;
  `build` becomes `npm run catalog && tsc --noEmit && vite build`; `check:engine` added to
  `check`. **This modifies `package-lock.json`** — saying so per the rules.
- `tsconfig.json`: `include` gains `engine`, drops the deleted `src`.
- `wargame/index.html`: a `<script type="module">` at the end of `<body>` imports
  `../engine/engine.ts` and wires the order box. Vite bundles it; the classic inline
  script above it is unchanged. Module scripts run after parse, so `push()` and `me`
  already exist when it does.

## Verification

**`check:engine`** — Node only, no browser, milliseconds. A table of cases, each
`(seat, action, target, storm, active_effects, expected)`, run against the real catalog and
a fixture spec set (so the check does not depend on specs you have not written yet).
Every case asserts the verdict kind *and* the `because` code *and* a substring of the
reason, so a gate that rejects for the wrong reason fails. The cases the catalog makes
interesting:

    norway         hold                                     → allow
    norway         jam            svalsat_ground             → reject/assets   'no controlled asset with jam_gnss'
    norway         board_vessel   yantar (≈400 km away)      → reject/range    'range 50 km'
    norway         board_vessel   fishing_fleet (in range)   → allow           asset=kv_svalbard
    northern_fleet jam            svalsat_ground from pechenga → reject/range  '300 km'
    northern_fleet terrestrial_response                      → pending         release_by=nsc
    nsc            kinetic                                   → reject/assets   'no seat holds kinetic_asat'
    china          task_imagery_pass  area, no downlink      → reject/comms
    starlink       geofence_or_throttle                      → allow           (controls_constellation)
    iridium        geofence_or_throttle                      → reject/assets   (one satellite)
    any            any, G5, ku_band_leo-only asset           → reject/comms    'comms 15%'
    any            any, both cables cut, needs downlink      → reject/comms    'fibre'
    any            any, one cable cut                        → allow           (redundancy holds)
    unspecced seat any                                       → reject/spec     'no spec'
    obs            any                                       → reject/spec     'observer'

Plus: every action in `action_requirements` has at least one case; every seat in `control`
has at least one; the catalog round-trips YAML → JSON → typed with zero unknown fields
(so a new field in `assets.yaml` fails the check until `types.ts` knows about it, rather
than being dropped silently).

**`check:bridge`** gains: type `jam svalsat_ground` as Northern Fleet → the feed shows a
reject with a reason; type `hold` → the feed shows allow. Proves the wiring, in a browser.

**Unchanged and must stay green:** `check:shell` (28), `check:laydown` (330).

## Out of scope this pass — recorded so it is not forgotten

- Sprites drawn from the catalog (needs a lat/lon → plate projection fitted to landmarks)
- `visibility: hidden_unless_exposed` for the two submarines
- Aircraft appearing only while airborne, base-to-station paths
- Tooltips with comms availability and last order
- Replacing `ACTORS` with the ten catalog seats
- A Lambda wrapper (the module is written so that one is ~15 lines when IAM allows it)

## Open questions — answer any, or I take the default

1. **Spec shape.** I am assuming `authority: {unilateral: [...], requires_release: [...]}`
   per seat, one YAML file per seat under `specs/`. If your specs carry the authority
   somewhere else, tell me the path and I load from there.
2. **THRESHOLD 0.5** for "unreachable". Change it?
3. **KSAT and the Governor both map to `norway`.** Fine for now, or should they be
   rejected as "no seat" like the observer until the actor list is replaced?

## Tasks

- [x] Commit `assets.yaml` (and `baseline_specs.yaml`)
- [x] `yaml` devDependency; `scripts/catalog.ts`; `engine/assets.json` + `specs.json` generated
- [x] `engine/types.ts` — full typing of the catalog; unknown-field check (records *and* the orbit block)
- [x] `engine/catalog.ts`, `geo.ts`, `storm.ts`
- [x] `engine/gate.ts` — the function above, every reject with `because`
- [x] `engine/model.ts` — interface + Null / Human / Remote
- [x] `engine/log.ts`, `engine/engine.ts`
- [x] ~~`specs/_schema.yaml`~~ — `engine/types.ts` is the schema; see below
- [x] `scripts/engine.ts` — 169 assertions; wired into `npm run check`
- [x] `wargame/index.html` — order box wiring, seat mapping, HEO label
- [x] `check:bridge` — order box cases (35 assertions)
- [x] All checks green (562); adversarial review launched
- [ ] Deploy


## What changed from the plan, and why

**The specs arrived as one file, not a directory.** `baseline_specs.yaml` at the repo root
is a list of nine seat objects. The loader reads that. `specs/_schema.yaml` was not written:
the file's own header cites `contracts/spec_schema.json` and `contracts/action_schema.json`,
neither of which exists here, so `engine/types.ts` is the schema — it mirrors every field
the two inputs actually use, and the loader refuses any it does not know.

**Both input files had YAML syntax errors.** Every ground site wrote `lat: X, lon: Y` on one
line, which a YAML parser reads as the key `lat` with a string value; twelve lines were
split onto two. One spec `voice` line contained `: ` in prose and was quoted. Those are the
only edits made to the input files, and the converter is what caught them.

**A fourth verdict.** The specs carry `authority.recommend_only`, a tier the plan did not
know about: the seat may recommend the action to its releaser but not order it. `Verdict`
gained `recommend → {to}`, and the engine logs a `recommendation` event and wakes the
receiving seat. Norway recommending `jam` goes to NSC; the Fleet recommending
`public_attribution` goes to the Kremlin.

**Release is resolved, not defaulted.** NSC and the Kremlin carry `releases` lists. The plan's
`release_by = req.release ?? 'nsc'` became `catalog.releaser(seat, action)`: the seat's
superior, if that superior's spec lists the action. The chain itself — Fleet → Kremlin, the
Blue seats → NSC — is in neither file; it is the reading of the two `releases` comments and
the catalog's authorization note, and it lives in one constant in `catalog.ts`.

**Cables are ground sites without a position.** `svalbard_cable_1/2` carry `path`, not
`lat`/`lon`. The loader accepts either; a cable gets no `pos`, and the storm layer does not
count it as a downlink station even though it carries `fiber`.

**Pass windows key on altitude, not on the band the UI draws.** `sentinel_n` is a 700 km
sun-synchronous satellite the catalog places in the MEO band "for legibility". Keying on
`band` made it permanently overhead. Anything under 2,000 km now makes passes.

**The catalog is right about Norway's downlink.** Cutting both Svalbard cables takes SvalSat
down (the dependency model works: one cable is redundancy) — and Norway can still task
imagery, because it controls Ny-Ålesund and Andøya, which do not hang off the cables. The
check asserts both facts rather than the plan's simpler expectation.

**Two catalog facts the plan's case table had wrong.** `ground_cyber` is held by no seat in
the base scenario and `rpo_inspect` only by Kosmos, exactly as the design note's table says
— so the Fleet's cyber order and USSPACECOM's counter-RPO are *out of platforms*, not
pending. The check now says so, and exercises `pending` through the Fleet's own inspector.

**Fields found by the guard.** `ship.count` (the fishing fleet is twelve hulls as one
record) and `orbit.sun_synchronous` were unknown to the types and are now part of them.

## Open

- **One seat per actor is still a mapping.** KSAT and the Governor both resolve to `norway`.
  Replacing `ACTORS` with the ten catalog seats is the fix.
- **No UI for attaching the model.** From the console:
  `engine.attach('northern_fleet', new RemoteModel(url, engine.catalog.actions))`.
- **Aircraft have no position** until an airborne/base-to-station model exists, so an
  aircraft is never range-checked and never a jam source with reach.
- **`closure_time_h`, `attribution_lag_h`, `latency_h`** are loaded and validated but not
  yet acted on; the engine applies effects immediately.
