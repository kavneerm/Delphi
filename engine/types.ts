/**
 * The contract.
 *
 * Every other file in engine/ is written against these types, and so is the UI. The two
 * input files — assets.yaml and baseline_specs.yaml — are the source of truth for what
 * exists; this file is the source of truth for what the engine understands about them.
 *
 * The spec file's header cites contracts/action_schema.json and contracts/spec_schema.json.
 * Neither exists in this repository. Until they do, the shapes below *are* the schema: they
 * mirror every field the two files actually use, and the loader fails on any field they do
 * not, so a new field in either input is a type error here rather than a silent drop.
 */

// ---------------------------------------------------------------- vocabulary

export type SeatId =
  | 'northcom' | 'usspacecom' | 'nsc' | 'norway' | 'kremlin'
  | 'northern_fleet' | 'china' | 'starlink' | 'iridium' | 'civilians';

export const SEATS: readonly SeatId[] = [
  'northcom', 'usspacecom', 'nsc', 'norway', 'kremlin',
  'northern_fleet', 'china', 'starlink', 'iridium', 'civilians',
];

export type Sensor =
  | 'radar_surface' | 'radar_air' | 'eo_ir' | 'sar' | 'elint' | 'sigint'
  | 'ais_rx' | 'sonar' | 'space_track' | 'magnetometer';

export type CommsBand =
  | 'ehf_protected' | 'x_band_mil' | 'ka_band' | 'ku_band_leo' | 'l_band_narrow'
  | 'hf' | 'uhf_satcom' | 'fiber' | 'line_of_sight';

export type Effect =
  | 'jam_gnss' | 'jam_satcom_uplink' | 'jam_satcom_downlink' | 'dazzle_eo'
  | 'cyber_ground' | 'cable_interfere' | 'rpo_inspect' | 'kinetic_asat'
  | 'boarding' | 'escort';

export type Mobility =
  | 'fixed' | 'slow_surface' | 'fast_surface' | 'submerged'
  | 'air_manned' | 'air_uav' | 'orbital';

export type Band = 'HEO' | 'MEO' | 'LEO';
export type Severity = 'G4' | 'G5' | 'carrington';
export type Clearance = 'ts_sci' | 'nato_secret' | 'state' | 'commercial';

export type ActionId =
  | 'hold' | 'maneuver' | 'private_demarche' | 'public_attribution'
  | 'request_commercial_priority' | 'share_telemetry' | 'geofence_or_throttle'
  | 'disclose_incident' | 'jam' | 'dazzle' | 'ground_cyber' | 'counter_rpo'
  | 'kinetic' | 'terrestrial_response' | 'board_vessel' | 'task_imagery_pass';

export interface LatLon { lat: number; lon: number }
export interface Area extends LatLon { radius_km: number }

// ---------------------------------------------------------------- raw catalog records
// These are the records exactly as assets.yaml writes them. The loader normalises them
// into `Asset` below; nothing outside engine/catalog.ts should touch a Raw* type.

interface RawCommon {
  id: string;
  name: string;
  owner: SeatId;
  real?: boolean;
  analog_of?: string;
  role?: string;
  notes?: string;
  comms?: CommsBand[];
  sensors?: Sensor[];
  effects?: Effect[];
  classified?: boolean;
  storm_vulnerability?: Record<string, number | string>;
  effects_vulnerable_to?: Effect[];
  range_km?: number;
}

export interface RawSatellite extends RawCommon {
  band: Band;
  orbit: {
    perigee_km?: number; apogee_km?: number; altitude_km?: number;
    period_h?: number; phase_offset_h?: number; inclination_deg?: number;
    sun_synchronous?: boolean;
  };
  co_tenants?: SeatId[];
  coverage?: string;
  provides?: string[];
  hosted_payloads?: string[];
}

export interface RawGroundSite extends RawCommon {
  /** A point site has lat/lon. A cable has `path` instead and no single position. */
  lat?: number;
  lon?: number;
  path?: string;
  dependencies?: string[];
  neighbors?: string[];
  treaty_note?: string;
}

export interface RawShip extends RawCommon {
  class: string;
  pos: LatLon;
  mobility: Mobility;
  visibility?: 'hidden_unless_exposed';
  ais_status?: string;
  /** A group of hulls modelled as one record (the fishing fleet). */
  count?: number;
}

export interface RawAircraft extends RawCommon {
  base: string;
  mobility: Mobility;
  endurance_h?: number;
  storm_effect?: string;
}

/**
 * The exact key set each record kind may carry. The loader rejects a record with any key
 * outside its set — that is the round-trip guarantee: assets.yaml cannot grow a field the
 * engine silently ignores.
 */
export const KNOWN_FIELDS: Record<AssetKind, readonly string[]> = {
  satellite: ['id', 'name', 'owner', 'real', 'analog_of', 'role', 'notes', 'comms', 'sensors',
    'effects', 'classified', 'storm_vulnerability', 'effects_vulnerable_to', 'range_km',
    'band', 'orbit', 'co_tenants', 'coverage', 'provides', 'hosted_payloads'],
  ground: ['id', 'name', 'owner', 'real', 'analog_of', 'role', 'notes', 'comms', 'sensors',
    'effects', 'classified', 'storm_vulnerability', 'effects_vulnerable_to', 'range_km',
    'lat', 'lon', 'dependencies', 'neighbors', 'path', 'treaty_note'],
  ship: ['id', 'name', 'owner', 'real', 'analog_of', 'role', 'notes', 'comms', 'sensors',
    'effects', 'classified', 'storm_vulnerability', 'effects_vulnerable_to', 'range_km',
    'class', 'pos', 'mobility', 'visibility', 'ais_status', 'count'],
  aircraft: ['id', 'name', 'owner', 'real', 'analog_of', 'role', 'notes', 'comms', 'sensors',
    'effects', 'classified', 'storm_vulnerability', 'effects_vulnerable_to', 'range_km',
    'base', 'mobility', 'endurance_h', 'storm_effect'],
};

// ---------------------------------------------------------------- action requirements

export type Clause =
  | { any_of: Mobility[] }
  | { owner_has: 'telemetry_of_target' }
  | { controls_constellation: true }
  | { effect: Effect }
  | { sensor: Sensor }
  | { or_sensor: Sensor };

export type TargetType = 'satellite' | 'ground_site' | 'ship' | 'area';

export interface ActionRequirement {
  requires: Clause[];
  or?: Clause[];
  channel?: 'diplomatic' | 'public';
  latency_h?: number;
  target_owner_in?: SeatId[];
  range_check?: boolean;
  target_type?: TargetType;
  pass_window_required?: boolean;
  downlink_required?: boolean;
  attribution_lag_h?: [number, number];
  closure_time_h?: [number, number];
  release?: SeatId | 'none';
  debris?: boolean;
  range_km?: number;
  irreversible?: boolean;
}

/** The orbit block is the one nested object with a fixed shape, so it is guarded too. */
export const KNOWN_ORBIT_FIELDS: readonly string[] = [
  'perigee_km', 'apogee_km', 'altitude_km', 'period_h', 'phase_offset_h', 'inclination_deg',
  'sun_synchronous',
];

export const KNOWN_REQUIREMENT_FIELDS: readonly string[] = [
  'requires', 'or', 'channel', 'latency_h', 'target_owner_in', 'range_check', 'target_type',
  'pass_window_required', 'downlink_required', 'attribution_lag_h', 'closure_time_h',
  'release', 'debris', 'range_km', 'irreversible',
];

// ---------------------------------------------------------------- the catalog

export interface CatalogRaw {
  schema_version: number;
  capabilities: { sensors: string[]; comms: string[]; effects: string[]; mobility: string[] };
  satellites: RawSatellite[];
  ground_sites: RawGroundSite[];
  ships: RawShip[];
  aircraft: RawAircraft[];
  control: Record<SeatId, string[]>;
  action_requirements: Record<ActionId, ActionRequirement>;
  storm_factors: Record<Severity, Record<string, number>>;
}

export type AssetKind = 'satellite' | 'ground' | 'ship' | 'aircraft';

/**
 * One asset, normalised. `pos` is present for anything that has a fixed or current
 * position on the plate; satellites and un-launched aircraft have none. Lists default to
 * empty so callers never branch on undefined. `raw` keeps the original record for the UI.
 */
export interface Asset {
  kind: AssetKind;
  id: string;
  name: string;
  owner: SeatId;
  real: boolean;
  pos?: LatLon;
  band?: Band;
  orbit?: RawSatellite['orbit'];
  comms: CommsBand[];
  sensors: Sensor[];
  effects: Effect[];
  mobility: Mobility;
  range_km?: number;
  dependencies: string[];
  co_tenants: SeatId[];
  classified: boolean;
  hidden: boolean;                  // visibility: hidden_unless_exposed
  base?: string;                    // aircraft: where it launches from
  raw: RawSatellite | RawGroundSite | RawShip | RawAircraft;
}

/** Runtime state the engine keeps per asset; nothing here comes from the catalog. */
export interface AssetState {
  down: boolean;                    // lost to storm, cable cut, cyber — cannot act or relay
  airborne: boolean;                // aircraft only; false means on the ground at `base`
  exposed_to: SeatId[];             // who can see a hidden asset; 'all' is every seat
  safe_mode: boolean;               // satellite tripped by the storm
  last_order?: { t: number; action: ActionId; by: SeatId };
}

// ---------------------------------------------------------------- persona specs

export interface Feed { name: string; latency_minutes: number; confidence_scale: string }

export interface Spec {
  spec_id: string;
  spec_version: string;
  seat: SeatId;
  authority: {
    unilateral: ActionId[];
    requires_release: ActionId[];
    recommend_only: ActionId[];
    releases?: ActionId[];          // present only on seats that grant release for others
  };
  information: { feeds: Feed[]; clearance: Clearance };
  decision_clock: { poll_minutes: number; wake_on_inject: boolean; deliberation_minutes: number };
  utility_weights: Record<string, number>;
  risk_posture: string;
  time_horizon: string;
  private_type: string | null;
  psyche: string | null;
  priors: Record<string, number | boolean>;
  voice: string;
  backstory: string;
}

export const KNOWN_SPEC_FIELDS: readonly string[] = [
  'spec_id', 'spec_version', 'seat', 'authority', 'information', 'decision_clock',
  'utility_weights', 'risk_posture', 'time_horizon', 'private_type', 'psyche', 'priors',
  'voice', 'backstory',
];

// ---------------------------------------------------------------- orders and verdicts

export interface Order {
  seat: SeatId;
  action: ActionId;
  asset_id?: string;
  target_id?: string;
  area?: Area;
  text?: string;
}

/**
 * Why an order was refused — §7 of the design note made machine-readable.
 *   spec    out of character: the seat's authority does not include this
 *   assets  out of platforms: nothing it controls can do this
 *   target  the target is the wrong kind or the wrong owner for this action
 *   range   a capable platform exists but is not in reach, or not in a pass window
 *   comms   a capable platform in reach cannot be reached: blinded or muted
 */
export type Because = 'spec' | 'assets' | 'target' | 'range' | 'comms';

export type Verdict =
  | { kind: 'allow';     asset: string | null; reason: string }
  | { kind: 'pending';   asset: string | null; release_by: SeatId; reason: string }
  | { kind: 'recommend'; to: SeatId; reason: string }
  | { kind: 'reject';    because: Because; reason: string };

// ---------------------------------------------------------------- the model contract

/**
 * What one seat can see when it is asked to decide. Built by the engine from the seat's
 * clearance, its control list, and what has been exposed to it — never the whole world.
 */
export interface Observation {
  t: number;                                    // scenario minutes since T+0
  severity: Severity;
  own_assets: Array<{ id: string; name: string; kind: AssetKind; comms: number; down: boolean; pos?: LatLon }>;
  contacts: Array<{ id: string; name: string; kind: AssetKind; owner: SeatId; pos?: LatLon }>;
  feeds: Feed[];
  recent: Event[];                              // events this seat was party to
}

export interface DecisionRequest {
  seat: SeatId;
  spec: Spec;
  posture: 'Cautious' | 'Balanced' | 'Aggressive';
  observation: Observation;
  history: Decision[];
}

export interface Decision {
  action: ActionId;
  params: { asset_id?: string; target_id?: string; area?: Area };
  rationale?: string;
  text?: string;
}

export interface PersonaModel {
  decide(req: DecisionRequest): Promise<Decision>;
}

// ---------------------------------------------------------------- the event log

export type Event =
  | { t: number; type: 'order_result';      seat: SeatId; order: Order; verdict: Verdict }
  | { t: number; type: 'decision';          seat: SeatId; decision: Decision; verdict: Verdict }
  | { t: number; type: 'release_requested'; seat: SeatId; action: ActionId; release_by: SeatId; asset?: string; target?: string }
  | { t: number; type: 'release_granted';   by: SeatId; for: SeatId; action: ActionId }
  | { t: number; type: 'release_denied';    by: SeatId; for: SeatId; action: ActionId; reason?: string }
  | { t: number; type: 'recommendation';    seat: SeatId; to: SeatId; action: ActionId; target?: string; text?: string }
  | { t: number; type: 'effect_started';    seat: SeatId; effect: Effect; source: string; target?: string; area?: Area; until?: number }
  | { t: number; type: 'effect_ended';      effect: Effect; source: string }
  | { t: number; type: 'state_change';      asset: string; changes: Partial<AssetState> }
  | { t: number; type: 'exposed';           asset: string; to: SeatId[] | 'all'; by?: string }
  | { t: number; type: 'inject';            text: string; to?: SeatId[] }
  | { t: number; type: 'severity';          severity: Severity };
