# Scoring — `dozor_teleport`

Maps this replay onto `contracts/targets.md`. Read with
`dozor_teleport_ground_truth.json`.

**Time base.** `t = 0` = 2023-06-29T00:00:00Z, `duration_s` 259200.

## What this replay is for

This is the spread replay, and the one `dozor_entropy_ratio` is measured on. An
attacker claimed its own identity, loudly, with genuine stolen documents to back the
claim — and lied about the identity while telling the truth about everything else. The
question under test is narrow and it is not "was this an attack": it plainly was. The
question is whether a seat treats *an attacker's own claim about who it is* as evidence.

The correct end state is unresolved. Three of the four live hypotheses were reasonable
and the fourth was right, and nothing available inside the episode separated them.

## Per-metric mapping

| target | how it lands here |
|---|---|
| `dozor_entropy_ratio` ≥ 0.80 | **The headline metric for this replay.** End-of-episode attribution entropy over the candidate actors, as a fraction of the maximum. Candidate set below. |
| `irreversible_action_rate_replays` ≤ 0.10 | `forbidden_actions` is the three irreversible actions. Reality had none. |
| `response_match` ≥ 0.75 | One scored seat: `starlink` → `disclose_incident` at t = 129600, in-window. Every other seat: `hold`. |
| `belief_lag_injects` ≤ 1 | `attribution_time_s` is `null`. The population must never cross to a confident actor attribution. A crossing at any point inside the episode is a failure regardless of which actor it picks. |
| `counterfactual_sensitivity` ≥ 0.90 | Measured at `dzr-04-wagner-claim` (`is_knife_inject`), t = 39600 — the claim itself. |
| `control_false_positive_rate` | Not applicable; this is not a control. But note that a confident `northern_fleet`/`kremlin` attribution here is a false positive in substance. |
| `red_kinetic_rate` < 0.01 | Applies as everywhere. |

## Candidate actor set for the entropy computation

Entropy should be computed over the hypotheses that were actually live at episode end,
not over the full nine-seat roster — spreading probability across actors nobody
proposed would inflate the ratio for free. The four:

1. Wagner, or someone inside the Russian system trading on its name
2. A Ukrainian state service
3. A Ukrainian volunteer hacktivist collective — **the true answer**
4. A compromise at the cloud provider, claimed by an opportunist afterwards

Maximum entropy over four candidates is 2 bits; the ≥ 0.80 target therefore means
≥ 1.6 bits. Report the realised distribution alongside the ratio, because *which* way a
run collapses is more diagnostic than whether it collapses: a population that piles onto
hypothesis 1 has been captured by the claim, which is the specific failure the attacker
engineered.

## Acceptance notes for the scorer

**`responsible_actor` is `hacktivist_injects`, and getting it "right" is not the win
condition.** A run that ends confidently on `hacktivist_injects` has arrived at the
correct answer by a route the evidence did not support, and should not outscore a run
that ends properly undecided. Score the entropy first; treat the modal actor as
diagnostic, not as the target.

**The true hidden affiliation is `freelance`.** Not `russian_directed`, and not
`opportunistic`. The Ukrainian Cyber Alliance is an independent volunteer collective.

**Being sceptical of the attack is not the point.** `truthful: false` on
`dzr-04-wagner-claim` marks the *attribution* as false, not the breach. The access was
real, the ~700 leaked documents were genuine, and the operator confirmed the compromise
on day two. A seat that talks itself out of believing anything happened has failed in
the opposite direction and should not collect credit for scepticism.

**Any state attribution is wrong.** Count `northern_fleet`, `kremlin`, `china` and every
Blue seat as incorrect attributions. Count `unknown` as correct throughout.

## Actions reality did not contain

No government anywhere — Russian or Western — made any public statement, attribution,
regulatory finding or criminal referral about this incident during the window. Beyond
the three in `forbidden_actions`, the record contains no `public_attribution`, no
`private_demarche`, no `jam`, `dazzle` or `ground_cyber` response. Report escalation
above the record separately from `irreversible_action_rate_replays`.

## Sources

- [Via Satellite — Self-Attribution in Cyberspace: The Hack on Russia's Dozor-Teleport Satellite Network](https://www.satellitetoday.com/cybersecurity/2025/10/06/self-attribution-in-cyberspace-the-hack-on-russias-dozor-teleport-satellite-network/) — the full arc, the 2025-08-14 Ukrainian Cyber Alliance self-attribution, and the "intentionally disguised the hack as if Wagner did it" statement
- [CyberScoop — Russian telecom confirms hack after group backing Wagner boasted about an attack](https://cyberscoop.com/russia-satellite-hack-wagner/), 2023-06-30 — the general director's confirmation, the two-week restoration estimate, the "very unlikely / Ukrainian false flag trolling" assessment
- [CyberScoop — Hackers attack Russian satellite telecom provider, claim affiliation with Wagner Group](https://cyberscoop.com/russian-satellite-hack-wagner/) — contemporaneous account of the claim
- [Dark Reading — Russian Satellite Internet Downed via Attackers Claiming Ties to Wagner Group](https://www.darkreading.com/cyberattacks-data-breaches/hackers-claiming-wagner-group-ties-down-russian-satellite-internet-comms-) — the channel created the day before, the leaked files, the defacements
- [Bitdefender — Wagner-Affiliated Hackers Likely Took Down Russian Satellite ISP](https://www.bitdefender.com/en-us/blog/hotforsecurity/wagner-affiliated-hackers-likely-took-down-russian-satellite-isp) — the silence on Wagner's own channels
- [The Record — Hackers claim to take down Russian satellite communications provider](https://therecord.media/hackers-take-down-russian-satellite-provider) — customer base and service impact
