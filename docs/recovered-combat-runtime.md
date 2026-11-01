# Recovered combat runtime notes

Status: reverse-engineering baseline for client build 133. This document records
behavior recovered from the installed client runtime and extracted resource DB.
It is deliberately separate from the simulator implementation: a mechanic is
not considered established merely because the current `engine.js` implements it.

## Evidence and tooling

- Runtime archive: `runtime/bin/x86_64/main.jbin` from the installed client.
- Matching V8 snapshot: `ssr-stove-shield.exe`, offset `0x226ecd8`, length
  `0x4871f`, V8 `12.4.254.21`.
- Extracted DB: the build-133 JSON tables under the local ripper output.
- Reproducible inspection helper: `scripts/recover_runtime.py`.

The PLPcK archive contains 2,269 JavaScript modules. Its complete contiguous
chunk list must be walked; the hash-chain traversal only exposes 1,727 modules
and omits important modules such as `stress_proc.js`.

The recovery helper also restores map-verified BytecodeArrays whose final
instruction is a loop back-edge. The generic v8asm candidate detector requires
a terminal final instruction and consequently omitted two valid functions from
`battle_worktable.js`, including `checkLightDarkCombine`.

## Canonical battle ownership and health

The player side has one battle entity, `battle.char`, with one `status` object.
Its `S_CURRENT_HP`, `S_HP`, and shield are the player team's combat resources.
The combatants in `battle_stage.chars` retain individual stats and individual
stress/collapse state, but they are not ordinary independently damageable party
members.

Evidence:

- `battle_stage_worktable.refreshTeamStat` refreshes every combatant and applies
  each `S_HP` delta to both `battle_stage.player.status.info[S_CURRENT_HP]` and
  `S_HP`, clamped to at least 1. It averages active combatants' `S_ATK`, `S_DEF`,
  and `S_DEF_SHIELD` onto the shared player status. Leaved combatants are
  excluded.
- `skill_effect_proc.procDamageApply` changes the target status' shared current
  HP and shield. Enemy attacks target the player battle entity; a combatant ID
  may still accompany the action for animation, stress, or event attribution.
- `battle_worktable.checkGameEnd` evaluates `battle.char` HP and battle-wide
  fatal flags. It does not declare ordinary defeat because one combatant's
  personal HP reached zero.

Therefore, the current simulator's per-combatant `hp`, enemy target selection,
"living owner", and "all living units" damage model is not game behavior and
must be removed rather than adjusted.

## Recovered state/phase loop

The main loop is distributed between `battle_state_proc.js` and
`battle_worktable.js`:

1. `procTimingTurnBegin`
   - Handles next-wave transitions.
   - Resets used/exhausted turn bookkeeping.
   - Removes the player's turn shield and processes term expiration.
   - Advances to Add Energy.
2. Draw Before
   - On turn 1, runs `checkOpening`.
   - Advances to Draw.
3. Draw
   - Runs `turnDraw`.
   - Advances to Draw After.
4. Draw After
   - Processes deferred/next-wave work.
   - Runs `checkLightDarkTurnStart`, reactions, and player-turn events.
   - Marks `player_turn = true`, checks Link Crash and lead behavior, then enters
     Main Phase.
5. Main Phase
   - Card resolution settles reactions, repeats, interrupts, game-end checks,
     and `checkLightDark` before returning control or turning over.
6. Turnover
   - Resolves conditions/events, discards the turn's cards, performs energy
     maintenance, and enters the monster sequence.
7. Monster sequence
   - Removes monster shields, checks fatal attacks, and resolves each eligible
     monster action.
8. Player Sequence Start
   - Increments the turn, runs events, generates TP/EP, applies turn-start
     stress, and returns to Turn Begin.

This ordering matters. Light/Dark transformations, Bind, stress, reactions, and
game-end checks are not safely modeled as callbacks attached only to a card-play
button.

## Deck construction and opening hand

Constants recovered from `game_constants.js` and the DB:

- Base turn draw: 5.
- Base hand maximum: 10.

The standard path is not the current simulator's "shuffle the combined deck,
put Innate cards on top, then fill to hand size" behavior.

- `battle_stage_worktable.getCardDeck` constructs the deck using `card_deck`
  rows, `DeckListType`, explicit order, `after_shuffle_order`, and the seeded
  `SEED_TYPE.INGAME` random stream. `LIST_TYPE_FORCE`, `LIST_TYPE_ORDER`, and
  `LIST_TYPE_DECK_ORDER` have distinct append/shuffle behavior.
- `battle_worktable.setData(all, deck, initialHand)` installs all cards, the deck
  order, and an explicitly pre-placed hand subset. It then moves those supplied
  card IDs from deck to hand. The full result is emitted as
  `action_deck_setting`; the client battle controller applies that snapshot
  through `battle_logic.initializeDeckSetting`.
- Turn-one Draw still runs `turnDraw`, drawing the base five after draw-decrease
  passives and hand-capacity/restriction checks.
- `turnDraw` takes cards from the established deck order. Light, Dark, and
  LightDark cards are ordered to draw after ordinary cards in non-prebattle
  draws. It handles reshuffle, draw restrictions, capacity, events, Bind, and
  Light/Dark checks.
- `checkOpening` is separate from drawing. On turn 1 it finds cards with
  `TALENT_OPENING` across hand and deck, uses the seeded shuffle, and queues as
  many as current energy permits.
- `setHand` uses `getCheatCard`, manually replaces the hand, emits synthetic
  draw/deck actions, and jumps battle states. Its external reference is the
  cheat manager; it is not evidence for normal opening-hand selection.

Still unresolved: the caller that partitions the final deck into the
`setData` deck and initial-hand arguments is outside direct JavaScript call
references in this archive. Until that coordinator boundary is recovered, the
simulator must expose any pre-placed opening subset explicitly and must not
claim that an invented ordering is exact.

## Stress, collapse, Link Crash, and defeat

Stress belongs to individual active combatants while HP belongs to the team.
The relevant implementation is `gamecore/contents/stress_proc.js`.

- Maximum stress is loaded from `default_stress_max`.
- `setEgoStress` clamps to the valid range and rounds to two decimals.
- Positive stress changes pass through `calcIncreaseStress`, which applies
  passive modifiers, monster stress percentage, collapse penalties, potential
  reductions, nonbattle modifiers, and mode-specific modifiers. Positive
  results have a minimum of 1.
- Collapse is checked when stress rises across maximum. Invalid/leaved/already
  collapsed combatants and preview/end-turn-HP-preview paths are excluded.
- Base collapse cost is 5 plus 1 per previous collapse. DT uses 6 plus 2 per
  previous collapse. Passive reductions apply, with a minimum cost of 1.
- Damage stress is based on actual loss from the shared player HP payload, as a
  percentage of shared maximum HP. `stress_battle` resource thresholds choose
  the stress row and target-selection rule; selected combatants receive a
  resource min/max random amount before modifiers and collapse checks.
- Turn-start stress uses turn-keyed `stress_battle` rows, active non-collapsed
  combatants, seeded shuffling, and current-stress ordering. The special member
  value `-1` uses `top_stressed_target_pct` (default 50) to choose the top-stress
  or a non-top random target.

`StressProc.checkLinkCrash` and `applyHPLinkCrash` establish the zero-HP path:

- Solo parties do not select a Link Crash member through the normal multi-member
  path.
- At shared HP zero, normal eligible battles select a non-leaved combatant for
  Link Crash, set that combatant to maximum stress, run collapse handling, and
  emit the corresponding stress/Link Crash actions.
- If every active combatant is already collapsed and no Link Crash member is
  active, one is selected according to the runtime's scoring/random logic.
- `pickLinkCrashChar` shuffles tie-break indexes `[1,2,3]` with the in-game seed
  and sorts ascending by `-stress*100000 - collapseRemain*10 - (4-randomIndex)`.
  Thus highest stress wins first, then the most remaining required collapse-card
  uses, then the seeded tie break.
- Assault hardcore uses the fatal-auto-attack/fatal-end path instead.
- Fatal enemy targeting points at the Link Crash combatant for the fatal action;
  this is not ordinary independent combatant HP damage.
- `checkGameEnd` turns the shared-player-HP/fatal conditions into the stage loss.

## Rossweisse / Flicker Blade

The generic card runtime and the build-133 resource rows jointly define this
mechanic. The relevant runtime functions are `checkLightDarkTurnStart`,
`reserveLightDarkDivide`, `checkLightDark`, `checkLightDarkDivide`,
`hasLightDarkCombineBlocking`, `releaseLightDarkCombineWaiting`,
`checkLightDarkCombine`, `checkCardBind`, and
`skill_effect_proc.triggerPyeonrin`.

### Turn start and division

- Once per turn, `checkLightDarkTurnStart` scans unique cards across hand, deck,
  discard, and used piles for LightDark/Light/Dark talents and moves eligible
  locked/non-hand cards through the normal move pipeline.
- LightDark cards now in hand are reserved for division.
- `checkLightDarkDivide` only acts once per turn. It delays a reserved card while
  that card is participating in co-op, repeat, or use queues.
- A base card `X` divides into resource IDs `X_mut1` and `X_mut2`, after verifying
  that both resources exist and checking hand capacity.
- The original card instance is changed to `_mut1`; `_mut2` is generated in hand
  with the same owner. The original R-Spark state is deep-cloned and retained in
  `light_dark_origin_r_spark` so combination can restore it.
- Division emits `CONDITION_CARD_DIVIDE`.

### Triggered shard effects and Sword Tassel

Both ordinary shards contain active effects marked `trigger_pyeonrin`: one deals
80% damage to a random enemy and one creates one `c_30134_cre1` Sword Tassel in
the owner's hand. Their trigger effect is `SKILL_EFF_TRIGGER_PYEONRIN`.

`triggerPyeonrin` collects every marked effect from the shard and attached
continue skills, chooses one seeded random valid target when a selected target
is required, assigns one reaction-group ID, and queues all marked effects in
that group. How often this may happen is controlled by the generic event stack,
not by `triggerPyeonrin` itself.

All eight shard conditions use `STACK_DEDUCTION_PER_STACK_NON_RESET` and reset
at turn begin. For this stack type, `condition_*_count` is the number of
matching events required for one activation, while `stack_value` is the number
of activations available before the next reset. After an activation, condition
counters reset and one allowance is deducted.

| Variant | Light `_mut1` | Dark `_mut2` | Per-turn allowance | Trigger damage |
| --- | --- | --- | ---: | ---: |
| Base | Each card used by the owner | Every 2 cards used by other combatants | 2 each | 80% |
| R-Spark 1 | Same conditions | Same conditions | 2 each | 120% |
| R-Spark 2 | Each effect-driven discard | Each non-turn effect draw | 2 each | 120% |
| R-Spark 3 | Each time the player is hit | Each qualifying card/Ego shield gain | 1 each | 240% |
| R-Spark 4 | No condition trigger; the zero-cost Retrieve shard resolves its active effects when played and discards a card | Same | n/a | 240% |
| R-Spark 5 | Each non-turn-start energy gain from a card/Ego skill | Each card used with cost at least 1 | 2 each | 120% |

Sword Tassel is unplayable, retained, and `TALENT_BIND_1_20`; duplicate tassels
are merged by the generic Bind system up to 20 stacks.

### Combination

`checkLightDarkCombine` is repeatedly evaluated after the runtime settles card
work. Exact recovered rules:

- If Light/Dark cards exist while interrupts, Pyeonrin trigger/reaction queues,
  or relevant tassel hand-copy work is pending, combination is marked waiting
  and deferred.
- The hand must contain at least two cards.
- Every hand card must be a Light card, a Dark card, or a qualifying Bind card
  with a defined Bind maximum. Any unrelated card prevents combination.
- Relevant cards currently in co-op, repeat, or use queues are not consumed.
- `_mut1` and `_mut2` are paired only when stripping their suffix yields the
  same base resource ID.
- The Light instance is changed back to the base card. If it retained an origin
  R-Spark, a restored card instance is constructed with that spark state.
- The paired Dark card and all qualifying material cards are moved out of hand
  and removed. The unique Sword Tassel emits `CONDITION_CARD_COMBINE` with
  `combine_material_only` before removal.
- Tassel's trigger adds `cs_30134_18` with term value equal to its Bind stack.
  Each stack adds 80 percentage points to Flicker Blade's listed damage effect
  for the whole turn. This is a character condition stack, not an arbitrary
  one-shot field stored on the merged card.
- The combined-card event is emitted, then the routine loops and checks whether
  another valid pair can combine.

## Known contradictions in the current simulator

The following current behavior is disproven and must not be used as a baseline:

- Per-combatant HP, individual death, living-owner checks, and enemy party-member
  targeting.
- Filling a fixed hand size after shuffling and moving Innate cards to the top.
- Treating end turn as a small direct callback sequence instead of the recovered
  phase/event loop.
- Rossweisse's hand-written pair IDs, event shortcuts, and one-shot merged-card
  damage field. The current special-case activation caps happen to match the DB
  rows, but bypass the generic event counters, source filters, reset timing, and
  stack semantics that establish those caps.
- Treating generated tassels as a special-case list rather than ordinary Bind
  cards resolved by the card/event/condition systems.

## Required recovery before broad simulator implementation

The next implementation pass should not pretend to be complete until these
boundaries are recovered and represented:

1. The exact external coordinator that supplies `setData`'s deck and pre-placed
   hand. The emitted snapshot and client application path are recovered, but
   the producer's partitioning decision is not present in direct JS references.
2. Extend the implemented generic condition-stack evaluator beyond the current
   card/unit event subset to timing conditions and compound target filters.
3. Generic CS term/overlay/removal semantics.
4. Monster action selection and target/event attribution through the shared
   player entity.
5. Mode-specific stress-table overrides and collapse-card remaining-count state
   used by the now-recovered Link Crash score.
6. Skill-effect target selection, card movement, reaction groups, interrupts,
   repeats, and generated-card ownership.

Until those are implemented, the UI should label a mechanic unsupported rather
than silently substitute a plausible rule.
