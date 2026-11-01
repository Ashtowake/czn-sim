# Card runtime implementation reference

Status: build-133 recovery notes and implementation handoff. This document is
intended to let a smaller coding model implement narrow pieces without inventing
game rules. `docs/recovered-combat-runtime.md` remains authoritative for the
battle phase loop, shared team HP, stress, and Rossweisse.

## Non-negotiable implementation rule

Do not infer card behavior from English text. The text is presentation. Execute
the card/effect/condition graph from `data/snapshot.json`, and use recovered
runtime behavior to interpret that graph. If a required enum or runtime branch
has not been recovered, mark the card or effect unsupported in the UI and battle
log. Do not substitute random targets, generic damage, or a guessed callback.

The primary local evidence is:

- Resource graph: `data/snapshot.json`
- Runtime archive: installed `runtime/bin/x86_64/main.jbin`
- Recovery tool: `scripts/recover_runtime.py`
- Effect executor: `gamecore/contents/skill_effect_proc.js`
- Tooltip resolver: `game/tooltip.js`
- Battle/deck loop: modules listed in `docs/recovered-combat-runtime.md`

Use the repository `.venv` when running the recovery script.

## Work packet 1: card provenance and Faint Memory

The combatant row has three different concepts which must not be merged:

- `startCards`: cards physically present at the start of a build/run. These
  become `CardInstance.isStartingCard = true` and are the only cards for which
  removal can consume `cd_remove_start`.
- `sparkCards`: character-owned unique cards which can be acquired during the
  run. They are eligible library cards, not initial cards. Acquiring one creates
  a non-starting instance. Removing it later is simply absence from the final
  deck; it does not create starter-removal cost.
- `collapseCard` and `potentialCards`: generated/special cards. They are not
  inserted into the initial deck unless another recovered setup rule explicitly
  does so.

Mika (`1039`) is the regression fixture:

| Kind | IDs | Display names |
| --- | --- | --- |
| True starters | `c_1039_srt1..srt4` | Water Arrow, Water Barrier, Source of Water, Surge |
| Run-added uniques | `c_1039_uni1..uni4` | Blessing of Waves, Tactical Analysis, Whirlpool, Deluge |

Expected model behavior:

1. `createCharacterBuild(data, "1039")` creates exactly four card instances,
   all from `startCards` and all marked `isStartingCard`.
2. Removing one true starter adds `cd_remove_start * 10`, currently 20.
3. A removed `c_1039_uni*` instance adds zero removal cost, even if an old save
   contains the obsolete `initialUnique` field.
4. A non-removed acquired card still contributes its acquisition cost through
   its exported `faintMemoryCost`/the applicable recovered acquisition rule.
5. Imported duplicate starters: only the original matched starter instance has
   `isStartingCard`; extra copies are non-starting duplicates.

Never use rarity alone to distinguish starters from acquired cards. Provenance
belongs to the instance and comes from `combatant.startCards` at build creation
or import normalization.

Relevant resource constants in `faintMemoryRules` are stored in tenths of the UI
capacity: `cd_remove_start=2`, `god_r_spark=2`,
`cd_copy_revise_by_count=[0,0,4]`, and `cd_relic_hammer=1`.

## Work packet 2: variant identity and display names

An R-Spark variant is a real card resource with its own effect graph, but many
variant rows intentionally have `name = none`. The UI name must be derived from
the base card; the raw resource ID must remain the execution identity.

For an ID ending in `_rspN`:

1. Strip only the terminal `_rspN` to find the base card.
2. Resolve the base card's localized name through `data.text`.
3. Append the Roman numeral for `N` (`I` through `X`, then numeric fallback).

Example: `c_1039_uni3_rsp5` displays as `Whirlpool V` while its execution card
ID remains `c_1039_uni3_rsp5`.

Do not mutate `cardId`, `baseCardId`, or use the display name as a lookup key.
For transformed IDs such as Light/Dark `_mut1`/`_mut2`, preserve transformation
identity separately and derive the R-Spark/base family before adding any
transformation label.

## Work packet 3: descriptions and value placeholders

Descriptions are templates, not final strings. `game/tooltip.js` resolves them
in this order through `getDescSkillCardApply`, `procHashTagDuring`,
`procHashTagNew`, `procHashTag`, variable processors, then `procTagCalc`.

The tooltip runtime builds positional arrays from the card's
`link_skill_eff_id` list. Important tags include:

| Template tag | Resource source |
| --- | --- |
| `#result_coeff_ev_N#` | calculated/display coefficient for top-level effect N |
| `#result_ev_N#` | calculated value for top-level effect N |
| `#result_ecv_N#` | calculated `eff_count_value` for effect N |
| `#during_result_ev_N_M#` | value of during-effect M linked from top-level effect N |
| `#result_damage_N#` | damage display value for effect N after value-type processing |
| `{cal}...{/}` | arithmetic expression evaluated only after inner tags resolve |

There are more families (`ecdv`, `ecdcv`, card target counts, CS values, runtime
stats, R-Spark value changes). A first implementation may resolve only a proven
subset, but unresolved tags must remain visibly marked, for example
`[unresolved:result_foo_0]`. Replacing every unknown tag with the word `value`
is deceptive and forbidden.

Value processing is not always `Number(eff_value)`. `getEffValue` and
`getEffCountValue` apply value types, stat sources, passives, R-Spark changes,
and battle context. The static builder may show the base coefficient when a
dynamic battle value is unavailable, but it must label that as a coefficient,
not a final amount.

### Missing variant description fallback

If a variant has `desc = none` or its localization key is absent:

1. Use the base card's description template.
2. Resolve positional placeholders against the variant's own
   `link_skill_eff_id` graph.
3. Do not copy the already-resolved base-card text, because variant values and
   value types may differ.

Whirlpool is the mandatory fixture:

- Base `c_1039_uni3`: effect 0 is 200 damage to all enemies; its linked during
  effect is 50 Cure. Effect 1 is 50 Cure multiplied by the previous effect's
  target count. The displayed template resolves to 200% damage and 50% heal per
  target hit.
- `c_1039_uni3_rsp1` has no own description. Its variant effect graph is 200
  damage and 100 Cure. Applying the base template to the variant graph must show
  200% damage and 100% heal per target hit, never `none`.
- `c_1039_uni3_rsp5` has an explicit template. Effect 0 Cure is 100; effect 1
  damage has base 100 with `VALUE_BEFORE_EFF_APPLIED_COEFF_VALUE_ADD`. The
  `{cal}` segment combines the resolved values. Do not hard-code this result to
  Whirlpool; implement the placeholder/arithmetic pipeline.

## Work packet 4: generic interactive card selection

Card effects can pause resolution for user input. This needs an engine-level
pending choice, not a card-specific modal that directly mutates cards.

Recovered `procCardSelect(worktable, skill_id, selectedIds)` behavior:

1. It requires `battle.current_interrupt.type == CARD`.
2. The interrupt owns `candidates`, `min`, and `max`.
3. It rejects a selection count outside `[min,max]` with
   `err:invalid_card_select_amount`.
4. Every selected ID must occur in the candidate pool. An invalid ID dirties the
   battle save and throws `err:invalid_card_select`.
5. Each accepted selection emits `CONDITION_SELECTED_CARD` with
   `CARD_PLACE_NONE`.
6. The effect-specific branch runs using the exact selected card instances.
7. The interrupt is cleared only after resolution finishes.

Recommended simulator contract:

```js
pendingChoice = {
  type: "card",
  sourceSkillId,
  sourceEffectId,
  candidateInstanceIds,
  min,
  max,
  prompt,
  continuation
};
```

`playCard` should stop at this boundary and return a `needs_input` result.
`submitCardChoice(instanceIds)` validates against the saved candidate snapshot,
records selected-card events, resumes the stored continuation, and either
settles to main phase or exposes the next pending choice. Do not recompute the
candidate pool at submit time; game state may have changed through reactions.

Candidate generation must interpret `target_card_set`, card place, owner,
category, cost, talent, and exclusion fields generically. Preserve selected
instances as `beforeEffectTargets` so later effects with
`CARD_SET_BEFORE_EFF_TARGET` receive exactly those cards.

## Worked interaction: Orlea Growth Acceleration

Card `c_1024_uni1` has four ordered effects:

1. `c_1024_uni1_01`: `SKILL_EFF_CURE`, value 100, caster target.
2. `c_1024_uni1_02`: `SKILL_EFF_NONE`, count value 2, condition
   `cd_amt_oc_rtd_han_ge`. This supplies the displayed/conditional repeat count.
3. `c_1024_uni1_03`: `SKILL_EFF_TRIGGER_RETAINED`,
   `target_card_set=CARD_SET_CHAR`, target count 1. This establishes the
   one-card owner-scoped selection.
4. `c_1024_uni1_04`: `SKILL_EFF_TRIGGER_RETAINED`,
   `target_card_set=CARD_SET_BEFORE_EFF_TARGET`, place `CARD_PLACE_HAND`, target
   count 1. This consumes the previously selected instance.

The runtime's `SKILL_EFF_TRIGGER_RETAINED` selection branch:

- computes the trigger repeat count with `calcCountValue`;
- for each repeat and each selected card, increments that card's
  `trigger_retained_cnt`;
- obtains all card skill-effect IDs and queues only effects whose `eff_opts`
  contain `trigger_retained`;
- also scans the selected card's continue skills/CS entries and queues their
  `trigger_retained` effects.

Acceptance scenario:

1. Put Growth Acceleration and two eligible Orlea cards in hand.
2. Play Growth Acceleration; heal resolves, then battle pauses with exactly the
   eligible Orlea cards as candidates and min=max=1.
3. Selecting one card triggers that chosen card's Retain effects twice.
4. The other card is untouched. Cancel, zero selections, two selections, a
   foreign-owner card, and an ID not in the snapshot are rejected.
5. The selected card remains an ordinary owned card in hand unless one of its
   own triggered effects moves it.

## Effect executor architecture

Implement generic behavior in this order, with a test after every step:

1. Materialize resource graphs: card -> ordered top-level effects -> linked
   during effects -> linked CS/continue effects. Preserve IDs and ordering.
2. Add an explicit effect cursor/continuation so execution can pause and resume.
3. Implement candidate-set evaluation and `CARD_SET_BEFORE_EFF_TARGET`.
4. Implement the pending card-choice boundary and invalid-selection checks.
5. Implement `SKILL_EFF_TRIGGER_RETAINED` through generic effect options.
6. Add other `SKILL_EFF_*` enums one at a time from runtime evidence.
7. Only then enable cards whose complete effect graph is supported.

Every effect result should include its evidence-friendly IDs in the battle log:

```js
{ cardInstanceId, cardId, effectId, effectType, targets, value, status }
```

`status` should distinguish `resolved`, `needs_input`, and `unsupported`.

## Suggested interruptible commits for a smaller model

Each item is intentionally independent and should end with tests passing:

1. Preserve starter provenance and Mika Faint Memory tests.
2. Add base-name/Roman variant display tests.
3. Add a static description resolver for the five proven tags above and the
   Whirlpool base/I/V fixtures; leave unknown tags explicit.
4. Add engine `pendingChoice` state and validation without wiring any card.
5. Add generic card candidate evaluation for `CARD_SET_CHAR` and
   `CARD_SET_BEFORE_EFF_TARGET` in `CARD_PLACE_HAND`.
6. Add generic `trigger_retained` effect-option dispatch.
7. Wire Growth Acceleration and its acceptance scenario through only generic
   data interpretation; no `if (cardId === "c_1024_uni1")` branch.

For every packet, inspect existing workspace changes first and edit with
`apply_patch`. Do not rewrite unrelated battle work. Browser smoke tests are
required because this environment may not have Node installed.
