"""Export a compact, browser-friendly combat data snapshot from the extracted CZN DB.

The game client keeps most of the combat data in the SSRA archive while its runtime
logic is compiled bytecode.  This exporter intentionally keeps the data model close
to the client tables: cards point at skill effects, effects point at CS/conditions,
and equipment points at the same CS/effect/NB tables instead of being flattened into
anonymous stat bonuses.

Run with the repository virtual environment, for example:

    .\\.venv\\Scripts\\python.exe scripts\\export_snapshot.py

Override CZN_DB_ROOT when the extractor output lives elsewhere.
"""

from __future__ import annotations

import json
import os
from collections import deque
from pathlib import Path
from typing import Any, Iterable


REPO_ROOT = Path(__file__).resolve().parents[1]
DB_ROOT = Path(os.environ.get(
    "CZN_DB_ROOT",
    r"C:\Users\ithur\AppData\Local\Temp\czn-ripper-equipment\db",
))
TEXT_ROOT = Path(os.environ.get(
    "CZN_TEXT_ROOT",
    r"C:\Users\ithur\AppData\Local\Temp\czn-ripper-analysis\text",
))
OUT_FILE = Path(os.environ.get(
    "CZN_SNAPSHOT_OUT",
    str(REPO_ROOT / "data" / "snapshot.json"),
))


def load_file(path: Path) -> list[dict[str, Any]]:
    try:
        raw = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError):
        return []
    if isinstance(raw, list):
        return [x for x in raw if isinstance(x, dict)]
    if isinstance(raw, dict):
        return [raw] if raw else []
    return []


def split_bracket(value: str) -> list[str] | None:
    # A few rows in the extracted archive have a missing opening bracket while
    # retaining the closing one (for example a two-effect card link). Treat both
    # forms as the same client-side list instead of turning the string into
    # character-by-character IDs in the browser.
    if not (value.startswith("[") or value.endswith("]")):
        return None
    body = value[1:] if value.startswith("[") else value
    if body.endswith("]"):
        body = body[:-1]
    body = body.strip()
    if not body:
        return []
    # The DB uses comma-separated scalar IDs/values. Keep this small parser
    # deliberately conservative: values containing commas are left as-is.
    return [item.strip() for item in body.split(",")]


def normalize(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: normalize(item) for key, item in value.items()}
    if isinstance(value, list):
        return [normalize(item) for item in value]
    if isinstance(value, str):
        parsed = split_bracket(value)
        return [normalize(item) for item in parsed] if parsed is not None else value
    return value


def normalized_row(row: dict[str, Any], source: str | None = None) -> dict[str, Any]:
    result = normalize(row)
    if source:
        result["_source"] = source
    return result


def rows_matching(pattern: str, *, exclude: Iterable[str] = ()) -> list[dict[str, Any]]:
    excluded = tuple(exclude)
    rows: list[dict[str, Any]] = []
    for path in sorted(DB_ROOT.glob(pattern)):
        if any(token in path.name for token in excluded):
            continue
        rows.extend(normalized_row(row, path.name) for row in load_file(path))
    return rows


def unique_by_id(rows: Iterable[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for row in rows:
        ident = row.get("id")
        if not ident or ident in result:
            continue
        result[str(ident)] = row
    return result


def project(row: dict[str, Any], fields: Iterable[str]) -> dict[str, Any]:
    result = {key: row[key] for key in fields if key in row}
    if "id" in row:
        result["id"] = row["id"]
    if "_source" in row:
        result["_source"] = row["_source"]
    return result


def scalar_ids(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(item) for item in value if item not in (None, "", "none", "-1")]
    if value in ("", "none", "-1"):
        return []
    return [str(value)]


def number_or_zero(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0


def collect_links(row: dict[str, Any], key_fragments: Iterable[str]) -> set[str]:
    fragments = tuple(key_fragments)
    links: set[str] = set()
    for key, value in row.items():
        if any(fragment in key for fragment in fragments):
            links.update(scalar_ids(value))
    return links


def index_rows(pattern: str, *, exclude: Iterable[str] = ()) -> dict[str, dict[str, Any]]:
    return unique_by_id(rows_matching(pattern, exclude=exclude))


def level_curve(rows: Iterable[dict[str, Any]], group: str | None) -> list[dict[str, Any]]:
    if not group:
        return []
    candidates = [row for row in rows if row.get("group") == group]
    if not candidates:
        return []
    totals: dict[str, float] = {}
    curve: list[dict[str, Any]] = []
    for row in sorted(candidates, key=lambda item: int(str(item.get("level", "0")))):
        for index in range(1, 4):
            stat_id = row.get(f"stat{index}_link_stat_list_id")
            value = row.get(f"stat{index}_value")
            if stat_id and value is not None:
                try:
                    totals[str(stat_id)] = totals.get(str(stat_id), 0) + float(value)
                except (TypeError, ValueError):
                    pass
        curve.append({"level": int(str(row.get("level", "0"))), "stats": dict(totals)})
    return curve


def text_map(references: set[str]) -> dict[str, str]:
    candidates = sorted(TEXT_ROOT.rglob("text.json")) if TEXT_ROOT.exists() else []
    if not candidates:
        return {}
    result: dict[str, str] = {}
    for row in load_file(candidates[0]):
        ident = row.get("id")
        text = row.get("text")
        if ident in references and isinstance(text, str) and text:
            result[str(ident)] = text
    return result


def all_string_references(value: Any, output: set[str]) -> None:
    if isinstance(value, dict):
        for item in value.values():
            all_string_references(item, output)
    elif isinstance(value, list):
        for item in value:
            all_string_references(item, output)
    elif isinstance(value, str) and "@" in value:
        output.add(value)


def main() -> None:
    if not DB_ROOT.exists():
        raise SystemExit(f"Database directory does not exist: {DB_ROOT}")

    # The source tables are intentionally loaded separately. This preserves the
    # client graph and lets the browser explain where a passive came from.
    base_rows = index_rows("char_base@char_base.json")
    combatant_rows = index_rows("char_base@char_combatant.json")
    combatant_levels = rows_matching("char_base@combatant_level.json")
    partner_base_rows = index_rows("partner_base@char_base.json")
    partner_rows = index_rows("partner_base@char_partner.json")
    partner_levels = rows_matching("partner_base@partner_level.json")

    raw_cards = rows_matching("*@card.json", exclude=("monster",))
    cards = unique_by_id(raw_cards)
    raw_enemy_cards = rows_matching("monster*@monster_card.json") + rows_matching("card(monster)@card.json")
    enemy_cards = unique_by_id(raw_enemy_cards)
    card_epiphanies = unique_by_id(rows_matching("*@card_r_spark.json"))
    random_epiphanies = unique_by_id(rows_matching("r_spark@r_spark.json"))

    monster_patterns = unique_by_id(rows_matching("monster*@monster_pattern.json"))
    monster_pattern_cards = unique_by_id(rows_matching("monster*@monster_pattern_card.json"))
    monster_pattern_sets = unique_by_id(rows_matching("monster*@monster_pattern_set.json"))

    raw_effects = rows_matching("*@skill_eff.json")
    effects = unique_by_id(raw_effects)
    raw_cs = rows_matching("*@cs.json")
    cs = unique_by_id(raw_cs)
    raw_nb = rows_matching("*@nb_eff.json")
    nb_effects = unique_by_id(raw_nb)
    # Keep the condition tables separate. They deliberately reuse identifier
    # namespaces, and flattening them by ID loses the control/card/unit rows
    # required by the runtime's event-stack evaluator.
    condition_objects = unique_by_id(rows_matching("*@condition.json"))
    condition_controls = unique_by_id(rows_matching("*@condition_control.json"))
    condition_cards = unique_by_id(rows_matching("*@cond_card.json"))
    condition_units = unique_by_id(rows_matching("*@cond_unit.json"))
    condition_timings = unique_by_id(rows_matching("*@cond_timing.json"))
    stress_battle = unique_by_id(rows_matching("stress_battle@stress_battle.json"))
    constants = unique_by_id(rows_matching("constant_meta*@constant_meta.json"))

    relics = unique_by_id(
        rows_matching("relic*@relic.json")
    )
    piece_items = unique_by_id(rows_matching("item_piece@item.json"))
    piece_links = unique_by_id(rows_matching("item_piece@item_piece.json"))
    piece_options = unique_by_id(rows_matching("piece_option@piece_option.json"))
    piece_sets = unique_by_id(rows_matching("piece_set_option@piece_set_option.json"))
    piece_presets = unique_by_id(rows_matching("item_piece_preset@item_piece_preset.json"))
    valid_piece_settings = unique_by_id(rows_matching("piece_valid_setting@piece_valid_setting.json"))
    equip_stat_defines = unique_by_id(rows_matching("equip_stat_define@equip_stat_define.json"))
    savedata_point_defines = unique_by_id(rows_matching("savedata_point_define@savedata_point_define.json"))

    # Cards are the normal entry point to combat skills. Equipment, partner
    # passives, and set bonuses are additional roots into that same graph.
    root_effect_ids: set[str] = set()
    root_cs_ids: set[str] = set()
    root_nb_ids: set[str] = set()
    for row in list(cards.values()) + list(enemy_cards.values()):
        root_effect_ids.update(collect_links(row, ("link_skill_eff_id",)))
    for row in random_epiphanies.values():
        root_effect_ids.update(collect_links(row, ("link_skill_eff_id",)))
        root_cs_ids.update(collect_links(row, ("link_cs_id",)))
        root_nb_ids.update(collect_links(row, ("link_nb_eff_id",)))
    for row in relics.values():
        root_cs_ids.update(collect_links(row, ("link_cs_id",)))
        root_nb_ids.update(collect_links(row, ("link_nb_eff_id",)))
    for row in piece_sets.values():
        root_cs_ids.update(collect_links(row, ("option_multiple_link",)))
        root_nb_ids.update(collect_links(row, ("option_multiple_link",)))

    partner_passives = unique_by_id(
        rows_matching("partner_passive*@partner_passive.json")
    )
    partner_ego = unique_by_id(
        rows_matching("partner_ego_passive@partner_ego_passive.json")
    )
    for row in partner_passives.values():
        root_cs_ids.update(collect_links(row, ("link_cs_id",)))
        root_nb_ids.update(collect_links(row, ("link_nb_eff_id",)))
    for row in partner_ego.values():
        root_nb_ids.update(collect_links(row, ("link_partner_ego_passive_eff_key",)))

    # Follow the links that can be followed statically. Unknown link conventions
    # are retained in the source rows and reported by the app as unsupported.
    reachable_effects: set[str] = set(root_effect_ids)
    reachable_cs: set[str] = set(root_cs_ids)
    reachable_nb: set[str] = set(root_nb_ids)
    queue: deque[tuple[str, str]] = deque(
        [("effect", ident) for ident in root_effect_ids]
        + [("cs", ident) for ident in root_cs_ids]
        + [("nb", ident) for ident in root_nb_ids]
    )
    while queue:
        kind, ident = queue.popleft()
        if kind == "effect":
            row = effects.get(ident)
            if not row:
                continue
            for linked in collect_links(row, ("link_cs_id",)):
                if linked in cs and linked not in reachable_cs:
                    reachable_cs.add(linked)
                    queue.append(("cs", linked))
            for linked in collect_links(row, ("during_eff_", "link_skill_eff_id")):
                if linked in effects and linked not in reachable_effects:
                    reachable_effects.add(linked)
                    queue.append(("effect", linked))
        elif kind == "cs":
            row = cs.get(ident)
            if not row:
                continue
            for linked in collect_links(row, ("link_skill_eff_id",)):
                if linked in effects and linked not in reachable_effects:
                    reachable_effects.add(linked)
                    queue.append(("effect", linked))
        else:
            row = nb_effects.get(ident)
            if not row:
                continue
            for linked in collect_links(row, ("battle_start_link_skill_eff_id", "stage_maintain_link_cs_id")):
                if linked in effects and linked not in reachable_effects:
                    reachable_effects.add(linked)
                    queue.append(("effect", linked))
                if linked in cs and linked not in reachable_cs:
                    reachable_cs.add(linked)
                    queue.append(("cs", linked))

    # Build combatants with their max-level base row and card roots.
    combatants: list[dict[str, Any]] = []
    for ident, combatant in sorted(combatant_rows.items()):
        base = base_rows.get(ident, {})
        if base.get("char_use_playable") not in ("YES", None):
            continue
        start_cards = [
            str(combatant.get(f"start_{index}_link_card_id", ""))
            for index in range(1, 5)
            if combatant.get(f"start_{index}_link_card_id") in cards
        ]
        if not start_cards:
            continue
        spark_cards = [
            str(combatant.get(f"spark_card_{index}_link_card_id", ""))
            for index in range(1, 5)
            if combatant.get(f"spark_card_{index}_link_card_id") in cards
        ]
        collapse_card = str(combatant.get("collapse_skill_link_card_id", ""))
        potential_cards = scalar_ids(combatant.get("potential_link_card_id")) + scalar_ids(combatant.get("potential_target_link_card_id"))
        card_ids = list(dict.fromkeys(start_cards + spark_cards + ([collapse_card] if collapse_card in cards else []) + potential_cards))
        curve = level_curve(combatant_levels, combatant.get("link_combatant_level_group"))
        combatants.append({
            "id": ident,
            "name": base.get("name", ident),
            "englishName": base.get("english_name", ident),
            "description": base.get("description", ""),
            "rarity": base.get("rarity", ""),
            "color": base.get("color", "#6e83b9"),
            "faction": base.get("link_faction_id", ""),
            "egoType": combatant.get("link_ego_type_id", ""),
            "className": combatant.get("link_base_class_define_id", ""),
            "portraitResource": f"portrait_character_{ident}",
            "levelGroup": combatant.get("link_combatant_level_group", ""),
            "maxLevel": curve[-1]["level"] if curve else 1,
            "levelCurve": curve,
            "stats": {
                "atk": combatant.get("s_atk", 0),
                "def": combatant.get("s_def", 0),
                "hp": combatant.get("s_hp", 0),
                "crit": combatant.get("s_cri", 0),
                "critDamage": combatant.get("s_cri_dmg_rate", 0),
                "weakDamage": combatant.get("s_weak_ego_dmg_rate", 0),
                "additionalAttackDamage": combatant.get("s_addi_atk_dmg_rate", 0),
                "dotDamage": combatant.get("s_dot_atk_dmg_rate", 0),
            },
            "cards": card_ids,
            "startCards": start_cards,
            "sparkCards": spark_cards,
            "collapseCard": collapse_card if collapse_card in cards else "",
            "potentialCards": [card_id for card_id in potential_cards if card_id in cards],
            "collapsePassive": combatant.get("link_collapse_passive_id", ""),
            "pieceValidSetting": combatant.get("link_piece_valid_setting_id", ""),
        })

    partners: list[dict[str, Any]] = []
    for ident, partner in sorted(partner_rows.items()):
        base = partner_base_rows.get(ident, {})
        if base.get("char_use_playable") not in ("YES", None):
            continue
        group = partner.get("link_partner_passive_group", "")
        passive_rows = [row for row in partner_passives.values() if row.get("group") == group]
        curve = level_curve(partner_levels, partner.get("link_partner_level_group"))
        partners.append({
            "id": ident,
            "name": base.get("name", ident),
            "englishName": base.get("english_name", ident),
            "rarity": base.get("rarity", ""),
            "color": base.get("color", "#74a491"),
            "card": partner.get("link_card_id", ""),
            "passiveGroup": group,
            "passives": passive_rows,
            "egoPassiveKey": partner.get("link_partner_ego_passive_key", ""),
            "stats": {
                "atk": partner.get("default_atk_add", 0),
                "def": partner.get("default_def_add", 0),
                "hp": partner.get("default_hp_add", 0),
            },
            "levelGroup": partner.get("link_partner_level_group", ""),
            "maxLevel": curve[-1]["level"] if curve else 1,
            "levelCurve": curve,
        })

    # Equipment keeps its client-side links. The browser chooses which relic
    # slots are active and applies piece options/set thresholds at simulation time.
    equipment: list[dict[str, Any]] = []
    for ident, row in sorted(relics.items()):
        slots = []
        for index in range(1, 6):
            slots.append({
                "slot": index,
                "cs": scalar_ids(row.get(f"s{index}_link_cs_id")),
                "csValue": scalar_ids(row.get(f"s{index}_cs_value")),
                "nb": scalar_ids(row.get(f"s{index}_link_nb_eff_id")),
                "nbValue": scalar_ids(row.get(f"s{index}_nb_eff_value")),
                "description": row.get(f"s{index}_description", ""),
            })
        equipment.append({
            "id": ident,
            "name": row.get("name", ident),
            "rarity": row.get("rarity", ""),
            "type": row.get("relic_type", ""),
            "category": row.get("relic_category", ""),
            "icon": row.get("icon_name", ""),
            "recommendedCharacters": scalar_ids(row.get("recommend_link_char_base_id")),
            "slots": slots,
        })

    pieces: list[dict[str, Any]] = []
    for ident, item in sorted(piece_items.items()):
        link = piece_links.get(ident, {})
        pieces.append({
            "id": ident,
            "name": item.get("name", ident),
            "description": item.get("desc", ""),
            "rarity": item.get("rarity", ""),
            "type": item.get("item_type", ""),
            "icon": item.get("icon", ""),
            "setId": link.get("link_piece_set_option_id", ""),
            "mainOptionGroup": link.get("main_link_piece_option_group", ""),
            "subOptionGroup": link.get("sub_link_piece_option_group", ""),
            "fixedOptions": [
                link.get(f"fix_{index}_link_piece_option_group", "")
                for index in range(1, 5)
                if link.get(f"fix_{index}_link_piece_option_group", "") not in (None, "", "none")
            ],
        })

    monster_rows = unique_by_id(rows_matching("monster*@monster.json"))
    enemies: list[dict[str, Any]] = []
    for ident, row in sorted(monster_rows.items()):
        pattern_set_key = str(row.get("link_monster_pattern_set_key", ""))
        phases = [
            item for item in monster_pattern_sets.values()
            if str(item.get("id", "")).startswith(pattern_set_key + "_")
        ]
        phases.sort(key=lambda item: int(str(item.get("phase", "1"))))
        phase = phases[0] if phases else None
        pattern_id = str(phase.get("phase_link_monster_pattern_id", "")) if phase else ""
        pattern = monster_patterns.get(pattern_id, {})
        pattern_card_key = str(pattern.get("link_monster_pattern_card_key", ""))
        action_rows = [
            item for item in monster_pattern_cards.values()
            if pattern_card_key and str(item.get("id", "")).startswith(pattern_card_key + "_")
        ]
        actions = []
        for action in sorted(action_rows, key=lambda item: (number_or_zero(item.get("card_priority")), str(item.get("id", "")))):
            card_id = str(action.get("card_link_monster_card_id", ""))
            if card_id not in enemy_cards:
                continue
            actions.append({
                "id": action.get("id", ""),
                "cardId": card_id,
                "weight": action.get("card_select_ratio", 100),
                "priority": action.get("card_priority", 0),
                "useLimit": action.get("card_use_limit", -1),
                "condition": action.get("card_link_condition_id", "none"),
            })
        start_card = str(pattern.get("start_link_monster_card_id", ""))
        if not actions and start_card not in enemy_cards:
            continue
        enemies.append({
            "id": ident,
            "name": row.get("name", ident),
            "grade": row.get("grade", ""),
            "rank": row.get("rank", ""),
            "atkPct": row.get("stat_atk_pct", 100),
            "defPct": row.get("stat_def_pct", 100),
            "hpPctMin": row.get("stat_max_hp_pct_min", 100),
            "hpPctMax": row.get("stat_max_hp_pct_max", 100),
            "patternSet": pattern_set_key,
            "startCard": start_card if start_card in enemy_cards else "",
            "actions": actions,
        })

    # Keep the projected tables compact enough for a static web app. The fields
    # below are the fields used by the current simulator plus enough source context
    # to add new effect handlers without re-running the archive extractor.
    effect_fields = {
        "id", "eff", "operation", "eff_attr", "eff_value", "eff_value_type_1",
        "eff_value_type_2", "eff_value_math_sign", "target_unit_type", "link_cs_id",
        "eff_link_condition_id", "outline_link_condition_id", "during_eff_0_link_condition_id",
        "during_eff_0_link_skill_eff_id", "during_eff_1_link_condition_id",
        "during_eff_1_link_skill_eff_id", "eff_count_value", "eff_count_value_type",
        "eff_count_value_type_opt", "eff_count_value_type_opt_multiple_link", "eff_opt",
        "eff_opt_multiple_link", "eff_card_target_count", "eff_card_place", "run_pct",
        "card_draw_count", "card_get_count", "card_link_id", "link_card_id", "value_opt",
        "value_opt_1", "value_opt_1_multiple_link", "value_opt_2", "value_opt_2_multiple_link",
        "opt_multiple_link", "target_card_set", "target_card_set_list_count",
        "target_card_set_list_pick_type", "target_card_set_card_type", "target_card_set_talent",
        "target_card_set_opt_cost", "target_card_set_opt_rarity", "target_effect_flag",
        "eff_value_stat_source_target", "_source",
    }
    cs_fields = {
        "id", "own_type", "term_type_1", "term_type_2", "cs_buff_type", "overlay_rule",
        "operation_rule", "invoke_value_category", "link_skill_eff_id", "link_tooltip_id",
        "relic_effect_type", "show_type", "_source",
    }
    nb_fields = {
        "id", "nb_eff", "operation", "eff_value", "eff_opt", "opt_multiple_link",
        "value_opt", "value_type", "link_nb_condition_id", "battle_start_link_skill_eff_id",
        "stage_maintain_link_cs_id", "_source",
    }
    projected: dict[str, Any] = {
        "meta": {
            "clientBuild": "133",
            "patchContext": "pack-133-37cb23791ca5",
            "source": "Chaos Zero Nightmare build 133 SSRA/DB export",
            "generatedBy": "scripts/export_snapshot.py",
            "graph": {
                "combatants": len(combatants),
                "partners": len(partners),
                "cards": len(cards),
                "enemyCards": len(enemy_cards),
                "cardEpiphanies": len(card_epiphanies),
                "equipment": len(equipment),
                "pieces": len(pieces),
                "pieceSets": len(piece_sets),
                "effectsReachable": len(reachable_effects),
                "csReachable": len(reachable_cs),
                "nbEffectsReachable": len(reachable_nb),
            },
            "confidence": "interactive battle model with explicit approximations",
            "caveats": [
                "The client battle runtime is compiled bytecode; edge-case ordering and some formula branches are not fully recovered.",
                "Damage is an intentionally transparent approximation for relative comparisons, not a replacement for an in-game damage readout.",
                "Conditions that cannot be evaluated from the current event model are reported in the battle log instead of silently treated as true.",
            ],
        },
        "combatants": combatants,
        "partners": partners,
        "cards": [project(row, {
            "id", "name", "desc", "desc_outgame", "card_category", "ego_type",
            "cost", "rarity", "sort", "sct_name", "spine_model", "card_skin_set",
            "ownable_link_base_class_define_id", "require_owner_flag", "reward_ratio",
            "link_mercenary_id", "link_skill_eff_id", "child_link_card_id",
            "card_usable_link_condition_id", "target_for_ui", "motion_type", "talent",
            "r_spark_tag_default", "battle_r_spark_enable_flag", "_source",
        }) for row in cards.values()],
        "enemyCards": [project(row, {"id", "name", "desc", "card_category", "ego_type", "cost", "link_skill_eff_id", "motion_type", "monster_turn_count", "monster_noti_category", "_source"}) for row in enemy_cards.values()],
        "cardEpiphanies": list(card_epiphanies.values()),
        "randomEpiphanies": list(random_epiphanies.values()),
        "effects": [project(effects[ident], effect_fields) for ident in sorted(reachable_effects) if ident in effects],
        "cs": [project(cs[ident], cs_fields) for ident in sorted(reachable_cs) if ident in cs],
        "nbEffects": [project(nb_effects[ident], nb_fields) for ident in sorted(reachable_nb) if ident in nb_effects],
        # These rows stay close to their source schema. The browser evaluator
        # needs the count, source/owner filters, reset timing, and stack type;
        # projecting the former generic condition subset discarded those exact
        # fields and encouraged special-case callbacks.
        "conditionObjects": list(condition_objects.values()),
        "conditionControls": list(condition_controls.values()),
        "conditionCards": list(condition_cards.values()),
        "conditionUnits": list(condition_units.values()),
        "conditionTimings": list(condition_timings.values()),
        "stressBattle": list(stress_battle.values()),
        "constants": {
            ident: row.get("value")
            for ident, row in constants.items()
            if ident in {
                "battle_base_energy", "battle_base_draw_count", "battle_base_hand_max_count",
                "default_stress_max", "top_stressed_target_pct", "hp_linkcrash_stress_amount",
                "collapse_stress_heal_target", "collapse_stress_heal_other",
            }
        },
        "equipment": equipment,
        "pieces": pieces,
        "pieceOptions": list(piece_options.values()),
        "pieceSets": list(piece_sets.values()),
        "piecePresets": list(piece_presets.values()),
        "validPieceSettings": list(valid_piece_settings.values()),
        "equipStatDefines": list(equip_stat_defines.values()),
        "faintMemoryRules": list(savedata_point_defines.values()),
        "enemies": enemies,
    }

    point_values = {
        ident: number_or_zero(row.get("value")) * 10
        for ident, row in savedata_point_defines.items()
        if not isinstance(row.get("value"), list)
    }
    monster_costs = {
        "RARITY_COMMON": point_values.get("cd_get_sort_monster_common", 20),
        "RARITY_RARE": point_values.get("cd_get_sort_monster_rare", 50),
        "RARITY_LEGEND": point_values.get("cd_get_sort_monster_legend", 80),
        "RARITY_UNIQUE": point_values.get("cd_get_sort_monster_unique", 100),
    }
    for card in projected["cards"]:
        sort = card.get("sort", "")
        if sort == "SORT_MONSTER_UNIQUE":
            card["faintMemoryCost"] = monster_costs.get(card.get("rarity"), 20)
        elif sort in {"SORT_NEUTRAL", "SORT_SUPPORT", "SORT_ETC"}:
            card["faintMemoryCost"] = point_values.get("cd_get_job", 20)
        elif sort == "SORT_TABOO":
            card["faintMemoryCost"] = point_values.get("cd_get_taboo", 20)
        elif sort == "SORT_EIDOLON":
            card["faintMemoryCost"] = point_values.get("cd_get_eidolon", 20)
        else:
            card["faintMemoryCost"] = 0

    references: set[str] = set()
    all_string_references(projected, references)
    projected["text"] = text_map(references)

    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text(json.dumps(projected, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(json.dumps({
        "output": str(OUT_FILE),
        "bytes": OUT_FILE.stat().st_size,
        "combatants": len(combatants),
        "partners": len(partners),
        "cards": len(cards),
        "equipment": len(equipment),
        "pieces": len(pieces),
        "reachableEffects": len(reachable_effects),
        "reachableCs": len(reachable_cs),
        "reachableNbEffects": len(reachable_nb),
        "textEntries": len(projected["text"]),
    }, indent=2))


if __name__ == "__main__":
    main()
