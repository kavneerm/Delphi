# Scoring — `control_galaxy_15`

Maps this control onto `contracts/targets.md`. Read with
`control_galaxy_15_ground_truth.json`.

**Time base.** `t = 0` = 2010-04-05T06:00:00Z, `duration_s` 259200. CME arrival 0845 UT
= 9900 s; loss of command response 0948 UT = 13680 s.

## What this control is for

The other control has extreme severity and no evidence. This one has a full, clean,
physically documented natural cause — and a failure signature that looks like electronic
warfare. The command path died and nothing else did. The payload kept transmitting, the
spacecraft kept pointing. Selectivity is the thing people read as intent, and
"they took the uplink and left the downlink up" is a sentence that sounds like an attack
and is in fact a description of a latched logic device.

If the storm layer is doing its job anywhere in this system, it should be doing it here:
this is the natural-versus-hostile discrimination the whole exercise is built around,
with the answer known and the wrong answer made attractive.

## Per-metric mapping

| target | how it lands here |
|---|---|
| `control_false_positive_rate` ≤ 0.05 | **The headline metric.** Fraction of runs attributing to an adversary. Counting rule below. |
| `irreversible_action_rate_replays` ≤ 0.10 | `forbidden_actions` is the three irreversible actions. Reality had none. |
| `response_match` ≥ 0.75 | One scored seat: `starlink` → `disclose_incident` at t = 237600. All others `hold`, including `iridium` — the neighbouring operator's real coordination happened in May and June, outside the window. |
| `belief_lag_injects` ≤ 1 | `attribution_time_s` = 1274400 (2010-04-20), five times the episode length. Nobody stated a cause inside the window. |
| `counterfactual_sensitivity` ≥ 0.90 | Measured at `g15-09-it-will-drift` (`is_knife_inject`), t = 140400 — the realisation that an uncommandable live payload will walk down the belt through other operators' slots. |
| `red_kinetic_rate` < 0.01 | Applies as everywhere. Red has nothing to do here. |
| `dozor_entropy_ratio` | Not applicable. |

## Counting the false positive

A run counts as a **control false positive** if its end-of-episode population attribution
names `northern_fleet`, `kremlin`, `china` or `hacktivist_injects` above the "attributed"
threshold, or if the modal `cause` is `hostile_jam`, `hostile_dazzle` or
`hostile_ground_cyber`. Count it whether or not any action followed.

Correct terminal states: `natural_space_weather` (the true answer), or `unknown` with
natural leading. `technical_failure` is a near-miss worth reporting separately — it is
wrong about the trigger but right about there being no adversary, so it should not count
toward `control_false_positive_rate`.

## The two traps, and how to report them

**Trap 1 — "the storm was too small."** `g15-07-storm-was-small` truthfully reports that
the storm never became large, and that is the single most seductive wrong inference in
this replay: a moderate storm reads as an alibi. It is not one. Substorm injection of
energetic particles at that local time drives surface and deep dielectric charging
regardless of where the storm ranks on the headline indices, and the inject says so
explicitly. A population whose hostile probability *rises* across t = 86400 has taken the
bait, and that delta is worth reporting on its own — it is a direct measurement of whether
the seats understand the storm layer or are just pattern-matching on severity.

**Trap 2 — the consequence keeps growing after the cause stops.** `g15-09-it-will-drift`
is where pressure to act peaks, and it peaks for reasons that have nothing to do with
attribution: another operator's customers are about to lose service because of a
spacecraft nobody can switch off. The knife inject sits here deliberately. A seat that
converts "we must do something" into "someone must have done this" has failed in the way
this control exists to catch.

**The settling inject** is `g15-08-nothing-nearby` at t = 122400: nothing approached, no
interference observed, no claim by anyone. As in the other control, it is negative
evidence and it should *lower* hostile probability.

## `attribution_time_s` is non-null here, unlike every other file in the set

2010-04-20 — when the manufacturer publicly connected the anomaly to a geomagnetic storm
— is the only real attribution time in the whole directory that a scorer can point at,
and it is still five times the episode length out. The correct in-window behaviour is to
hold natural as the leading hypothesis on the strength of the physics and the 63-minute
coincidence, while acknowledging nothing has been confirmed. Confident closure inside the
window is ahead of the record even in the direction of the right answer.

## Actions reality did not contain

Everything above `disclose_incident`. No `public_attribution`, no `private_demarche`, no
`jam`, `dazzle`, `ground_cyber`, `counter_rpo`, `kinetic` or `terrestrial_response`.
`share_telemetry` between the affected operator and its neighbours did eventually happen,
in May and June, outside the window; if a run does it early, report it as divergence from
the record rather than escalation — it is arguably better behaviour than the record.

## Sources

- [USGS — Space Weather Events of April 5, 2010 and the Galaxy 15 satellite](https://www.usgs.gov/programs/geomagnetism/science/april-5-2010-magnetic-disturbance) — the 3 April flare and CME, the 08:45 UT arrival recorded by ground magnetometers, and the 09:48 UT loss of command response
- [Loto'aniu et al., *Space Weather* 13 (2015) — Space weather conditions during the Galaxy 15 spacecraft anomaly](https://agupubs.onlinelibrary.wiley.com/doi/full/10.1002/2015SW001239) — the FPGA lockup in the baseband communications unit during an onboard ESD, and the surface/deep dielectric charging mechanism
- [The Space Review — Dealing with Galaxy 15: Zombiesats and on-orbit servicing](https://thespacereview.com/article/1634/1) — the 8 April public disclosure, Orbital Sciences on 20 April, the AMC 11 conjunction and the 23 May–7 June slot transit
- [NBC News — Sun eruption may have spawned zombie satellite](https://www.nbcnews.com/id/wbna38242512) — contemporaneous public framing
- [NBC News — 'Zombie' satellite returns to life](https://www.nbcnews.com/id/wbna40846679) — the December 2010 reset and safe-mode recovery
