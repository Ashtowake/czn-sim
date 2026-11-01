const RARITY_MEMORY = {
  RARITY_NORMAL: 10,
  RARITY_COMMON: 10,
  RARITY_RARE: 20,
  RARITY_EPIC: 30,
  RARITY_LEGEND: 40,
  RARITY_UNIQUE: 40,
};

export const asArray = (value) => {
  if (Array.isArray(value)) return value.filter((item) => item !== "" && item !== "none" && item !== "-1");
  if (value === undefined || value === null || value === "" || value === "none" || value === "-1") return [];
  return [value];
};

export const number = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export function createId(prefix = "instance") {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function buildDataMaps(data) {
  const map = (rows) => new Map((rows || []).map((row) => [String(row.id), row]));
  const maps = {
    combatants: map(data.combatants), partners: map(data.partners), cards: map(data.cards),
    equipment: map(data.equipment), pieces: map(data.pieces), pieceOptions: map(data.pieceOptions),
    pieceSets: map(data.pieceSets), epiphanies: map(data.cardEpiphanies),
    randomEpiphanies: map(data.randomEpiphanies), enemies: map(data.enemies),
    effects: map(data.effects), cs: map(data.cs),
  };
  maps.uniqueByCard = new Map();
  for (const row of data.cardEpiphanies || []) {
    const rows = maps.uniqueByCard.get(String(row.link_card_id)) || [];
    rows.push(row);
    maps.uniqueByCard.set(String(row.link_card_id), rows);
  }
  return maps;
}

export function inferCardOwner(cardId) {
  return String(cardId || "").match(/^c_(\d+)_/)?.[1] || "";
}

export function cardFamilyId(cardId) {
  return String(cardId || "")
    .replace(/_rsp\d+(?=_(?:mut\d+)$|$)/, "")
    .replace(/_(?:pot|lbk)\d*$/, "");
}

const ROMAN_NUMERALS = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

export function cardDisplayName(card, data) {
  if (!card) return "Unknown card";
  const variant = String(card.id || "").match(/^(.*)_rsp(\d+)$/);
  if (variant) {
    const base = data.cards.find((row) => row.id === variant[1]);
    const baseName = data.text?.[base?.name] || base?.id || variant[1];
    const number = Number(variant[2]);
    return `${baseName} ${ROMAN_NUMERALS[number] || number}`;
  }
  return data.text?.[card.name] || card.id || "Unknown card";
}

function localizedCardText(data, key) {
  if (!key || key === "none") return "";
  const localized = data.text?.[key];
  if (localized && localized !== "none") return localized;
  return key.includes("@") ? "" : key;
}

function variantBaseCard(card, data) {
  const match = String(card?.id || "").match(/^(.*)_rsp\d+$/);
  return match ? data.cards.find((row) => row.id === match[1]) : null;
}

function staticArithmetic(expression) {
  const tokens = String(expression).match(/\d+(?:\.\d+)?|[()+\-*/]/g) || [];
  if (!tokens.length || tokens.join("") !== String(expression).replace(/\s+/g, "")) return null;
  let cursor = 0;
  const primary = () => {
    const token = tokens[cursor++];
    if (token === "(") {
      const value = addSubtract();
      if (tokens[cursor++] !== ")") return Number.NaN;
      return value;
    }
    if (token === "+") return primary();
    if (token === "-") return -primary();
    return Number(token);
  };
  const multiplyDivide = () => {
    let value = primary();
    while (["*", "/"].includes(tokens[cursor])) {
      const operator = tokens[cursor++];
      const right = primary();
      value = operator === "*" ? value * right : value / right;
    }
    return value;
  };
  function addSubtract() {
    let value = multiplyDivide();
    while (["+", "-"].includes(tokens[cursor])) {
      const operator = tokens[cursor++];
      const right = multiplyDivide();
      value = operator === "+" ? value + right : value - right;
    }
    return value;
  }
  const result = addSubtract();
  return cursor === tokens.length && Number.isFinite(result) ? result : null;
}

const displayNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? String(Number(parsed.toFixed(4))) : "";
};

/**
 * Resolve the stat-independent subset of the game's tooltip grammar. Dynamic
 * battle values intentionally remain marked instead of being presented as an
 * exact amount. See docs/card-runtime-implementation-reference.md.
 */
export function resolveCardDescription(card, data) {
  if (!card) return "No extracted description.";
  const base = variantBaseCard(card, data);
  const template = localizedCardText(data, card.desc)
    || localizedCardText(data, card.desc_outgame)
    || localizedCardText(data, base?.desc)
    || localizedCardText(data, base?.desc_outgame)
    || "No extracted description.";
  const effects = new Map((data.effects || []).map((row) => [String(row.id), row]));
  const top = asArray(card.link_skill_eff_id).map((id) => effects.get(String(id)));
  const effectValue = (index, field = "eff_value") => displayNumber(top[index]?.[field]);
  const duringValue = (effectIndex, duringIndex) => {
    const parent = top[effectIndex];
    if (!parent) return "";
    const linked = Object.keys(parent)
      .filter((key) => /^during_eff_\d+_link_skill_eff_id$/.test(key))
      .sort((left, right) => number(left.match(/\d+/)?.[0]) - number(right.match(/\d+/)?.[0]))
      .flatMap((key) => asArray(parent[key]));
    return displayNumber(effects.get(String(linked[duringIndex]))?.eff_value);
  };
  let result = template.replace(/#([a-z0-9_]+)#/gi, (whole, tag) => {
    let match = tag.match(/^result_(?:coeff_ev|ev|damage)_(\d+)$/);
    if (match) return effectValue(Number(match[1])) || `[unresolved:${tag}]`;
    match = tag.match(/^result_ecv_(\d+)$/);
    if (match) return effectValue(Number(match[1]), "eff_count_value") || `[unresolved:${tag}]`;
    match = tag.match(/^during_result_ev_(\d+)_(\d+)$/);
    if (match) return duringValue(Number(match[1]), Number(match[2])) || `[unresolved:${tag}]`;
    return `[unresolved:${tag}]`;
  });
  result = result.replace(/\{cal\}(.*?)\{\/\}/g, (whole, expression) => {
    const value = staticArithmetic(expression);
    return value === null ? `[unresolved:cal:${expression}]` : displayNumber(value);
  });
  return result;
}

export function cardSource(card) {
  const id = String(card?.id || "");
  if (/_srt\d/.test(id)) return "Starting";
  if (/_uni\d/.test(id)) return "Unique";
  if (/_eps(?:_|$)/.test(id)) return "Collapse";
  if (String(card?.sort).includes("SUPPORT")) return "Support";
  if (String(card?.sort).includes("FORMATION")) return "Formation";
  if (String(card?.sort).includes("TABOO")) return "Taboo";
  if (String(card?._source).includes("season")) return "Seasonal";
  return String(card?.sort || "Normal").replace(/^SORT_/, "").replaceAll("_", " ");
}

export function faintMemoryCost(card) {
  if (Number.isFinite(Number(card?.faintMemoryCost))) return Number(card.faintMemoryCost);
  if (["SORT_START", "SORT_UNIQUE"].includes(card?.sort)) return 0;
  if (String(card?.sort).includes("MONSTER") || String(card?.talent).includes("TALENT_UNPLAYABLE")) return 0;
  return RARITY_MEMORY[card?.rarity] ?? 20;
}

export function makeCardInstance(data, cardId, ownerId, options = {}) {
  const card = data.cards.find((row) => String(row.id) === String(cardId));
  return {
    instanceId: options.instanceId || createId("card"),
    cardId: String(cardId),
    baseCardId: String(options.baseCardId || cardId),
    ownerId: String(ownerId || inferCardOwner(cardId)),
    isStartingCard: Boolean(options.isStartingCard),
    initialUnique: Boolean(options.initialUnique),
    removed: Boolean(options.removed),
    duplicate: Boolean(options.duplicate),
    uniqueId: options.uniqueId || "",
    variantCardId: options.variantCardId || "",
    commonIds: [...(options.commonIds || [])],
    divineId: options.divineId || "",
    god: options.god || "",
    memoryCost: options.memoryCost ?? faintMemoryCost(card),
  };
}

export function createCharacterBuild(data, combatantId) {
  const combatant = data.combatants.find((row) => String(row.id) === String(combatantId));
  if (!combatant) return null;
  return {
    combatantId: String(combatant.id),
    level: number(combatant.maxLevel, 1),
    depth: 15,
    nightmare: true,
    partnerId: "",
    partnerLevel: 1,
    equipment: { weapon: null, armor: null, accessory: null },
    gear: Array.from({ length: 6 }, (_, index) => ({ slot: index + 1, pieceId: "", main: null, substats: [], reinforce: 0 })),
    cards: [
      ...(combatant.startCards || []).map((cardId) => makeCardInstance(data, cardId, combatant.id, { isStartingCard: true, memoryCost: 0 })),
    ],
  };
}

export function createSimulatorState(data) {
  const boss = data.enemies.find((row) => row.grade === "GRADE_BOSS") || data.enemies[0];
  const preferred = data.combatants.find((row) => String(row.id) === "30134") || data.combatants[0];
  return {
    version: 1,
    sandbox: false,
    activeSlot: 0,
    activeTab: "deck",
    slots: [createCharacterBuild(data, preferred.id), null, null],
    enemy: { id: boss?.id || "", hp: 30000, atk: 240, def: 120, weakness: 1 },
    battle: { ap: 3, drawCount: 5, handMax: 10, initialHand: [], seed: 133 },
  };
}

export function calculateCap(depth, nightmare) {
  return 30 + (Math.min(number(depth, 1) + Number(Boolean(nightmare)), 16) - 1) * 10;
}

export function calculateFaintMemory(build, data) {
  if (!build) return { total: 0, cap: 0, remaining: 0, additions: 0, removals: 0, duplicates: 0, divine: 0, hammer: 0 };
  const maps = buildDataMaps(data);
  const additions = build.cards.filter((card) => !card.isStartingCard && !card.removed)
    .reduce((sum, entry) => sum + (entry.memoryCost ?? faintMemoryCost(maps.cards.get(entry.baseCardId))), 0);
  const removedCards = build.cards.filter((card) => card.isStartingCard && card.removed);
  const removals = removedCards.length * 20;
  const duplicateCount = build.cards.filter((card) => card.duplicate && !card.removed).length;
  const duplicateSteps = [0, 0, 40];
  let duplicates = 0;
  for (let index = 0; index < duplicateCount; index += 1) duplicates += duplicateSteps[Math.min(index, duplicateSteps.length - 1)];
  const divineCount = build.cards.filter((card) => card.divineId && !card.removed).length;
  const divine = divineCount * 20;
  const hammer = Object.values(build.equipment || {}).some((item) => item?.hammerRelicId) ? 10 : 0;
  const total = additions + removals + duplicates + divine + hammer;
  const cap = calculateCap(build.depth, build.nightmare);
  return {
    additions, removals, duplicates, divine, hammer, total, cap, remaining: cap - total,
    removalCount: removedCards.length, duplicateCount, divineCount,
  };
}

const hasIntersection = (left, right) => left.some((value) => right.includes(value));

export function epiphanyCompatibility(effect, card, combatant) {
  if (!effect || !card) return { ok: false, reasons: ["Unknown epiphany or card."] };
  const reasons = [];
  const categories = asArray(effect.target_card_category);
  if (categories.length && !categories.includes(card.card_category)) reasons.push(`Requires ${categories.join(" / ")}.`);
  const min = number(effect.target_card_cost_min, -1);
  const max = number(effect.target_card_cost_max, 99);
  const cost = number(card.cost);
  if (cost < min || cost > max) reasons.push(`Requires AP cost ${min}–${max}.`);
  const talents = asArray(card.talent);
  const requiredTalents = asArray(effect.target_card_include_talent);
  const excludedTalents = asArray(effect.target_card_exclude_talent);
  if (requiredTalents.length && !requiredTalents.every((talent) => talents.includes(talent))) reasons.push(`Requires ${requiredTalents.join(", ")}.`);
  if (hasIntersection(excludedTalents, talents)) reasons.push(`Excluded talent: ${excludedTalents.filter((value) => talents.includes(value)).join(", ")}.`);
  const tags = asArray(card.r_spark_tag_default);
  const requiredTags = asArray(effect.r_spark_tag);
  const excludedTags = asArray(effect.r_spark_exclude_tag);
  if (requiredTags.length && !requiredTags.every((tag) => tags.includes(tag))) reasons.push(`Requires tag ${requiredTags.join(", ")}.`);
  if (hasIntersection(excludedTags, tags)) reasons.push(`Excluded tag: ${excludedTags.filter((value) => tags.includes(value)).join(", ")}.`);
  const classes = asArray(effect.target_link_base_class_define_id);
  if (classes.length && !classes.includes(combatant?.className)) reasons.push(`Requires class ${classes.join(" / ")}.`);
  return { ok: reasons.length === 0, reasons };
}

export function validateCharacterBuild(build, data, sandbox = false) {
  const maps = buildDataMaps(data);
  const errors = [];
  const warnings = [];
  const rejected = {};
  if (!build) return { valid: true, errors, warnings, rejected, memory: calculateFaintMemory(null, data) };
  const combatant = maps.combatants.get(String(build.combatantId));
  if (!combatant) errors.push(`Unknown combatant ${build.combatantId}.`);
  if (number(build.level) < 1 || number(build.level) > number(combatant?.maxLevel, 1)) errors.push("Level is outside this combatant's range.");
  if (number(build.depth) < 1 || number(build.depth) > 15) errors.push("Depth must be between 1 and 15.");
  const memory = calculateFaintMemory(build, data);
  if (memory.removalCount > 5) errors.push(`Too many removals (${memory.removalCount}/5).`);
  if (memory.duplicateCount > 3) errors.push(`Too many duplicates (${memory.duplicateCount}/3).`);
  if (memory.total > memory.cap) errors.push(`Faint Memory exceeded by ${memory.total - memory.cap}.`);
  (build.gear || []).forEach((gear, index) => {
    if (!gear?.pieceId) return;
    const piece = maps.pieces.get(String(gear.pieceId));
    if (!piece) { errors.push(`Gear slot ${index + 1} uses an unknown piece.`); return; }
    if (piece.type !== `ITEM_PIECE_${index + 1}`) errors.push(`Gear ${piece.id} cannot occupy slot ${index + 1}.`);
    if ((gear.substats || []).length > 4) errors.push(`Gear slot ${index + 1} has more than four substats.`);
    const configured = [gear.main, ...(gear.substats || [])].filter((item) => item?.optionId);
    const statIds = [];
    configured.forEach((item, optionIndex) => {
      const option = maps.pieceOptions.get(String(item.optionId));
      const expectedGroup = optionIndex === 0 && gear.main?.optionId === item.optionId ? piece.mainOptionGroup : piece.subOptionGroup;
      if (!option || option.group !== expectedGroup) errors.push(`Gear slot ${index + 1} has an invalid ${optionIndex === 0 ? "main" : "sub"} stat.`);
      if (option?.link_stat_list_id) statIds.push(option.link_stat_list_id);
      if (!['min', 'max'].includes(item.quality || 'max')) errors.push(`Gear slot ${index + 1} has an invalid roll quality.`);
      if (number(item.reinforce) < 0 || number(item.reinforce) > 15) errors.push(`Gear slot ${index + 1} reinforcement is outside 0–15.`);
    });
    if (new Set(statIds).size !== statIds.length) errors.push(`Gear slot ${index + 1} repeats a stat.`);
  });
  for (const entry of build.cards) {
    const card = maps.cards.get(String(entry.baseCardId || entry.cardId));
    const reasons = [];
    if (!card) reasons.push(`Unknown card ${entry.cardId}.`);
    const owner = inferCardOwner(card?.id);
    if (card?.require_owner_flag === "YES" && owner && owner !== String(build.combatantId)) reasons.push(`Owned by combatant ${owner}.`);
    const ownable = asArray(card?.ownable_link_base_class_define_id);
    if (ownable.length && !ownable.includes(combatant?.className)) reasons.push(`Restricted to ${ownable.join(" / ")}.`);
    if (entry.uniqueId) {
      const unique = maps.epiphanies.get(entry.uniqueId);
      if (!unique || cardFamilyId(unique.link_card_id) !== cardFamilyId(entry.baseCardId)) reasons.push("The unique epiphany does not belong to this card.");
    }
    for (const id of [...(entry.commonIds || []), entry.divineId].filter(Boolean)) {
      const compatibility = epiphanyCompatibility(maps.randomEpiphanies.get(id), maps.cards.get(entry.variantCardId) || card, combatant);
      reasons.push(...compatibility.reasons);
    }
    if (reasons.length) rejected[entry.instanceId] = reasons;
  }
  for (const reasons of Object.values(rejected)) errors.push(...reasons);
  const uniqueErrors = [...new Set(errors)];
  return { valid: sandbox || uniqueErrors.length === 0, errors: uniqueErrors, warnings, rejected, memory, sandbox };
}

function applyEpiphany(materialized, effect) {
  if (!effect) return;
  const sign = effect.add_cost_mathsign;
  const value = number(effect.add_cost_value);
  if (sign === "MATHSIGN_SUBTRACT_MIN_0") materialized.costDelta -= value;
  else if (sign === "MATHSIGN_ADD") materialized.costDelta += value;
  else if (sign === "MATHSIGN_SET") materialized.costSet = value;
  materialized.addedTalents.push(...asArray(effect.add_talent));
  materialized.addedEffectIds.push(...asArray(effect.add_link_skill_eff_id));
  const targetEffects = asArray(effect.add_target_eff);
  const multipliers = asArray(effect.add_multiply_pct_value).map((item) => number(item));
  if (targetEffects.some((item) => item.includes("DMG")) && multipliers.length) {
    materialized.effectDamageRate += Math.max(...multipliers);
  }
}

export function materializeCard(entry, ownerIndex, data) {
  const maps = buildDataMaps(data);
  const unique = entry.uniqueId ? maps.epiphanies.get(entry.uniqueId) : null;
  const cardId = entry.variantCardId || unique?.change_link_card_id || entry.cardId;
  const result = {
    ...entry,
    ownerIndex,
    cardId,
    baseCardId: entry.baseCardId || entry.cardId,
    costDelta: 0,
    costSet: null,
    addedTalents: entry.duplicate ? ["TALENT_REPLICATION"] : [],
    addedEffectIds: [],
    effectDamageRate: 0,
    epiphanyIds: [...(entry.commonIds || []), entry.divineId].filter(Boolean),
  };
  for (const id of result.epiphanyIds) applyEpiphany(result, maps.randomEpiphanies.get(id));
  return result;
}

export function toBattleConfig(state, data) {
  const occupied = state.slots.map((build, slotIndex) => ({ build, slotIndex })).filter(({ build }) => build);
  const units = occupied.map(({ build }) => ({
    combatantId: build.combatantId,
    level: build.level,
    partnerId: build.partnerId,
    partnerLevel: build.partnerLevel,
    relics: Object.fromEntries(Object.entries(build.equipment || {}).map(([key, value]) => [key, value?.relicId || value || ""])),
    equipment: build.equipment,
    gear: build.gear,
  }));
  const deck = occupied.flatMap(({ build }, ownerIndex) => build.cards
    .filter((entry) => !entry.removed)
    .map((entry) => materializeCard(entry, ownerIndex, data)));
  return {
    units,
    deck,
    enemy: state.enemy,
    weakness: state.enemy.weakness,
    ap: state.battle.ap,
    drawCount: state.battle.drawCount ?? 5,
    handMax: state.battle.handMax ?? 10,
    initialHand: state.battle.initialHand || [],
    seed: state.battle.seed,
  };
}

export function normalizeImportedBuild(data, decoded) {
  const build = createCharacterBuild(data, String(decoded.charId));
  if (!build) throw new Error(`Unknown combatant ${decoded.charId}.`);
  const starters = new Map(build.cards.map((entry) => [entry.baseCardId, entry]));
  build.cards = [];
  for (const raw of decoded.cards || []) {
    if (raw.removed) {
      const starter = starters.get(raw.cardId);
      if (starter) { build.cards.push({ ...starter, removed: true }); starters.delete(raw.cardId); }
      continue;
    }
    const starter = starters.get(raw.cardId);
    const unique = raw.epiphanyId || "";
    build.cards.push(makeCardInstance(data, raw.cardId, build.combatantId, {
      isStartingCard: Boolean(starter?.isStartingCard),
      initialUnique: Boolean(starter?.initialUnique),
      duplicate: Boolean(raw.duplicate),
      uniqueId: unique,
      variantCardId: raw.variantCardId || "",
      commonIds: raw.commonIds || [],
      divineId: raw.divineId || "",
      god: raw.god || "",
      memoryCost: starter?.memoryCost,
    }));
    if (starter) starters.delete(raw.cardId);
  }
  for (const starter of starters.values()) build.cards.push(starter);
  return build;
}
