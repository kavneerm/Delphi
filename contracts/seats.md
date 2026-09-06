# SEATS. DRAFT until a human deletes this line.

Nine LLM personas, six rule actors. Folded from an earlier twelve-seat cut; see **Design notes** at the bottom for what moved where and why.

## LLM personas (9)

| id | side | seat | one line |
|---|---|---|---|
| northcom | blue | NORTHCOM / JTF-North commander | operational seat that goes blind; wants awareness and coordination back |
| usspacecom | blue | USSPACECOM commander | attribution seat; natural/hostile/unknown; authorizes non-kinetic space measures |
| nsc | blue | NSC / Deputies — **human-playable** | escalation and release authority; the only seat that can take irreversible action; slowest clock |
| norway | ally | Norway | operates ASBM (hosts EPS-R), owns SvalSat/Andøya/Vardø and the two Svalbard cables, Northern Fleet expert, treaty-bound |
| northern_fleet | red | Russian Northern Fleet commander | hidden type: storm_reposition / opportunistic_isr / action_under_cover; psyche field |
| kremlin | red | Kremlin / MFA | denial and narrative; Svalbard-treaty grievance; release authority for Red; knows less than the Fleet |
| china | green | China | interested bystander with own SSA data; hidden honesty type; statements and offers only |
| starlink | commercial | Starlink/Starshield-analog | the hit constellation; holds resolving telemetry; CEO idiosyncrasy term |
| iridium | commercial | Iridium-analog | the survivor; holds scarce Arctic bandwidth; allocation decisions |

**northcom** — Runs the operational picture for the Arctic approaches and is the seat that actually loses it. Has no space assets of its own and no attribution machinery; what it has is a mission that degrades by the hour and a set of requests it can make of people who outrank it or do not work for it. Can ask a commercial operator for priority, can share what it sees, can disclose that it has a problem. Cannot attribute publicly and cannot act on the upper ladder. The seat's characteristic failure is escalating by proxy: pushing USSPACECOM and NSC toward a conclusion its own feeds do not support, because waiting is intolerable when the picture is gone.

**usspacecom** — The attribution seat. Holds SSA tracks, interference signatures and the technical means to tell space weather from electronic attack, which is exactly the discrimination the scenario is built to make hard. Authorizes non-kinetic space measures — jam, dazzle, ground cyber, close approach — on its own or with release. Its characteristic failure is the reverse of NORTHCOM's: over-trusting a signature because the signature is the only thing in the picture that looks like evidence.

**nsc** — Escalation authority, release authority, and the slowest clock in the game. The only seat that can take an irreversible action on the Blue side: kinetic and terrestrial response run through here, and every `requires_release` action anywhere on Blue waits on this seat's answer. **This is the human-playable seat.** In a live demo a person sits here and the engine routes release requests and irreversible actions to them, pausing the clock until they answer. In a headless run the same seat is filled by an LLM persona, or by an auto-approval rule with a fixed approval probability — see `release_policy` in `contracts/env_config_schema.json`. Both paths emit the same event log, so a human-played episode and a headless episode are the same object to Eval and to the UI.

**norway** — The seat with the most to lose and the least room. Operates ASBM, which hosts EPS-R; owns the ground segment on Svalbard — SvalSat, the two subsea cables — plus Andøya and Vardø; and knows the Northern Fleet better than anyone else at the table. Treaty-bound in two directions at once: the Svalbard Treaty constrains what may be done on the archipelago, and Article 5 constrains what may be done without allies. Because the ground stations are Norway's, the downlink chokepoint is Norway's decision — it can throttle or suspend, and every actor's picture degrades when it does. Its alliance-cohesion utility term is where NATO now lives on this side of the board.

**northern_fleet** — The seat that may or may not be doing anything. Its hidden `private_type` — `storm_reposition`, `opportunistic_isr`, `action_under_cover` — is the ground truth the whole Blue side is trying to infer, and only one of the three values makes it an adversary in the sense Blue means. Carries a `psyche` as well. Holds jam, dazzle and maneuver on its own authority; needs Kremlin release for cyber, close approach, kinetic and terrestrial action. The seat is under a storm it did not order, with an exercise window it did not choose, and a chain of command that will read whatever happens as either initiative or insubordination.

**kremlin** — Denial, narrative and release. Knows less than the Fleet does, which is the point: it is answering for actions it has not been told the truth about, on a clock set by other people's press cycles. Holds the Svalbard-treaty grievance and will use it whether or not anything is happening. Grants or withholds release for Red's upper-ladder actions. Carries a `psyche`. Its characteristic move is a public statement that is true in every particular and false in aggregate.

**china** — Interested bystander with its own SSA and its own reasons. Statements, offers and telemetry sharing only — no physical action on this board. Hidden `private_type`: `honest_broker` genuinely helps resolve the ambiguity, `opportunistic_amplifier` helps in a way that widens it, `coordinated_with_russia` helps in a way that is not help. Because it can share tracks nobody can call self-interested in the Atlantic sense, it is the fastest available route out of attribution ambiguity — and the one whose reliability nobody can check.

**starlink** — The constellation that got hit, and the actor holding the telemetry that would settle what hit it. Commercial incentives run against fast disclosure: a public interference finding is a public admission of vulnerability, and the insurer is watching. Can geofence, throttle or suspend service over a region on its own authority — unilateral corporate power over an operational picture that governments are dependent on and do not control. Carries a CEO idiosyncrasy term, so it is the least predictable seat on the board and the one most likely to make policy by statement.

**iridium** — The survivor, which makes it the scarcity. Holds Arctic bandwidth that everyone now wants and must decide who gets it: military traffic, commercial customers, the fishing and cruise fleets, or the science stations. Every allocation is a political act it would rather not be making. Slower to disclose than Starlink and more exposed to liability, because its customers include people whose safety depends on the link.

---

## Rule actors (6)

Scripted, not modelled. They emit events and receive messages, never take menu actions, and never have a spec.

| id | role |
|---|---|
| swpc | NOAA space-weather forecasts with per-run accuracy draws; the seat-visible version of the storm, which may lag or disagree with the true state |
| insurer | reprices after any irreversible action; invokes war exclusions; the mechanism that makes commercial seats feel a decision they did not make |
| media_clock | public attribution pressure rising over time; also the pressure term standing in for allied and NATO expectation |
| osint_clock | publishes anomalies and movements on a schedule Red does not control; the reason a covert action has a deadline |
| civilians | Svalbard science stations, fishing and cruise fleets, Barentsburg; humanitarian pressure and narrative |
| hacktivist_injects | claimed attacks and leaks arriving as injects, with a hidden true affiliation — `russian_directed`, `freelance`, or `opportunistic` — drawn per run and never revealed until episode end. Deniable noise in the attribution channel: a claim may be true, false, or true about something nobody has noticed yet |

---

## Alliance cohesion, and where NATO and KSAT went

**NATO is not a seat; it is a term.** Alliance cohesion appears in three places instead:
1. `utility_weights.alliance_cohesion` in **norway**'s spec — the ally who cannot act alone and is scored on whether it keeps the alliance with it.
2. `utility_weights.alliance_cohesion` in **usspacecom**'s spec — the cost of unilateral action to a coalition the seat needs and does not command.
3. The **media_clock** rule actor's pressure schedule — allied and public expectation rising over time, which is what a NATO seat would mostly have generated anyway.

A modelled NATO seat spends most of a 72-hour episode producing consultative text on a days-scale clock. As a utility term it does the same work to the decisions that matter, at zero token cost and with no risk of a fifteen-seat episode timing out.

**KSAT's ground stations belong to norway.** SvalSat, the two Svalbard cables, and the downlink chokepoint under the aurora are Norway's assets and Norway's decision. Folding the operator into the state that hosts it loses the commercial-versus-sovereign tension inside the Norwegian position and keeps everything that made the chokepoint interesting: it is still the single point through which the picture flows, it is still in a treaty gray zone, and someone still has to decide whether to shut it.

---

## Design notes

**Why nine.** Every seat costs tokens per decision point, and the marginal seat has to earn its slot by changing somebody else's decision. Three did not. `nato` was consultation, which is a pressure curve. `ksat` was a chokepoint that a state already owns. `hacktivist` was deniable noise, which is an inject stream — and, as a seat, it had a two-action menu and no interesting private information problem of its own. Folding them costs three voices and buys headroom for the seats where the real disagreements happen: the attribution seat, the operational seat that has lost its picture, the ally, and the two commercial actors holding the evidence.

**What was preserved rather than cut.** Each fold kept its mechanism. Alliance cohesion is a utility term and a pressure clock. The downlink chokepoint is a Norwegian asset and a Norwegian decision. Deniable attack claims are `hacktivist_injects`, with a per-run hidden affiliation, which is exactly the epistemic problem the hacktivist seat existed to create — and it now creates it without needing to be modelled as an agent with preferences.

**Hidden types and psyche after the fold.** `private_type` remains on `northern_fleet` (`storm_reposition` / `opportunistic_isr` / `action_under_cover`) and `china` (`honest_broker` / `opportunistic_amplifier` / `coordinated_with_russia`). The third hidden type moved with the hacktivist: `russian_directed` / `freelance` / `opportunistic` is now the per-run affiliation draw behind `hacktivist_injects`, ground truth for scoring and never a seat's field. `psyche` — `revisionist` / `revanchist` / `opportunistic_cautious` / `regime_survival` — is Red-only and required on `northern_fleet` and `kremlin`.

**NSC as the human seat.** Putting the human on the release and irreversible-action authority is what makes the demo a wargame rather than a replay. It is also the seat where a human is cheapest: NSC's clock is the slowest on the board, so a person deliberating does not stall the simulation, and `clock_mode: checkpoint` makes the pause explicit rather than a race. The same seat runs headless under an LLM persona or an auto-approval rule; the event log is identical either way, so nothing downstream needs to know which was used.

**Cut order if the engine still strains.** china → kremlin → iridium. Never cut usspacecom, northern_fleet, northcom, starlink, nsc.
