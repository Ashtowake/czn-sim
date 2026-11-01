export const asList = (value) => {
  if (Array.isArray(value)) return value.filter((item) => item !== "" && item !== "none" && item !== "-1");
  if (value === undefined || value === null || value === "" || value === "none" || value === "-1") return [];
  return [value];
};

export const asNumber = (value, fallback = 0) => {
  if (Array.isArray(value)) return asNumber(value[0], fallback);
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const statLabel = (statId) => ({
  S_ATK: "ATK", S_DEF: "DEF", S_HP: "HP", S_CRI: "Crit rate", S_CRI_DMG_RATE: "Crit damage",
  S_ATK_INC_ADD_OUT: "ATK", S_DEF_INC_ADD_OUT: "DEF", S_HP_INC_ADD_OUT: "HP",
  S_ATK_INC_RATE_OUT: "ATK %", S_DEF_INC_RATE_OUT: "DEF %", S_HP_INC_RATE_OUT: "HP %",
  S_CRI_INC_ADD: "Crit rate", S_CRI_DMG_RATE_INC_ADD: "Crit damage",
  S_CHARGING_POWER_INC_ADD: "Passion", S_ADDI_ATK_DMG_RATE_INC_ADD: "Additional attack damage",
  S_DOT_ATK_DMG_RATE_INC_ADD: "DoT damage", S_RED_DMG_RATE_INC_ADD: "Red damage",
  S_GREEN_DMG_RATE_INC_ADD: "Green damage", S_BLUE_DMG_RATE_INC_ADD: "Blue damage",
  S_PURPLE_DMG_RATE_INC_ADD: "Purple damage", S_ORANGE_DMG_RATE_INC_ADD: "Orange damage",
}[statId] || statId || "Unknown stat");

const statKey = (statId) => ({
  S_ATK: "atk", S_DEF: "def", S_HP: "hp", S_CRI: "crit", S_CRI_DMG_RATE: "critDamage",
  S_ATK_INC_ADD_OUT: "atkFlat", S_DEF_INC_ADD_OUT: "defFlat", S_HP_INC_ADD_OUT: "hpFlat",
  S_ATK_INC_RATE_OUT: "atkRate", S_DEF_INC_RATE_OUT: "defRate", S_HP_INC_RATE_OUT: "hpRate",
  S_CRI_INC_ADD: "crit", S_CRI_DMG_RATE_INC_ADD: "critDamage",
  S_CHARGING_POWER_INC_ADD: "chargingPower", S_ADDI_ATK_DMG_RATE_INC_ADD: "additionalDamage",
  S_DOT_ATK_DMG_RATE_INC_ADD: "dotDamage", S_RED_DMG_RATE_INC_ADD: "redDamage",
  S_GREEN_DMG_RATE_INC_ADD: "greenDamage", S_BLUE_DMG_RATE_INC_ADD: "blueDamage",
  S_PURPLE_DMG_RATE_INC_ADD: "purpleDamage", S_ORANGE_DMG_RATE_INC_ADD: "orangeDamage",
}[statId] || null);

const valuesForRarity = (option, rarity = "RARITY_LEGEND", suffix = "value") => {
  const key = String(rarity).replace("RARITY_", "").toLowerCase();
  return asList(option?.[`${key}_${suffix}`]).map((value) => asNumber(value)).filter(Number.isFinite);
};

export function gearRollValue(option, quality = "max", reinforce = 0, rarity = "RARITY_LEGEND") {
  if (!option) return 0;
  const baseValues = valuesForRarity(option, rarity, "value");
  const reinforceValues = valuesForRarity(option, rarity, "reinforce_value");
  const pick = (values) => quality === "min" ? Math.min(...values) : Math.max(...values);
  const base = baseValues.length ? pick(baseValues) : 0;
  const increase = reinforceValues.length ? pick(reinforceValues) : 0;
  return base + Math.max(0, asNumber(reinforce)) * increase;
}

const makeMaps = (data) => ({
  combatants: new Map(data.combatants.map((row) => [row.id, row])),
  partners: new Map(data.partners.map((row) => [row.id, row])),
  cards: new Map(data.cards.map((row) => [row.id, row])),
  enemyCards: new Map(data.enemyCards.map((row) => [row.id, row])),
  effects: new Map(data.effects.map((row) => [row.id, row])),
  cs: new Map(data.cs.map((row) => [row.id, row])),
  nb: new Map(data.nbEffects.map((row) => [row.id, row])),
  equipment: new Map(data.equipment.map((row) => [row.id, row])),
  pieces: new Map(data.pieces.map((row) => [row.id, row])),
  pieceOptions: new Map(data.pieceOptions.map((row) => [row.id, row])),
  pieceSets: new Map(data.pieceSets.map((row) => [row.id, row])),
  enemies: new Map(data.enemies.map((row) => [row.id, row])),
  conditionObjects: new Map((data.conditionObjects || []).map((row) => [row.id, row])),
  conditionControls: new Map((data.conditionControls || []).map((row) => [row.id, row])),
  conditionCards: new Map((data.conditionCards || []).map((row) => [row.id, row])),
  conditionUnits: new Map((data.conditionUnits || []).map((row) => [row.id, row])),
  stressBattle: new Map((data.stressBattle || []).map((row) => [row.id, row])),
});

const curveAtLevel = (curve, level) => {
  if (!curve?.length) return {};
  let selected = curve[0];
  for (const row of curve) {
    if (asNumber(row.level) <= level) selected = row;
    else break;
  }
  return selected.stats || {};
};

const applyStat = (stats, statId, value) => {
  const key = statKey(statId);
  if (!key) return false;
  stats[key] = (stats[key] || 0) + asNumber(value);
  return true;
};

const tokenStat = (token) => {
  const normalized = String(token || "").toLowerCase();
  const magnitude = asNumber(normalized.match(/_(\d+(?:\.\d+)?)$/)?.[1], 0);
  if (normalized.includes("atk_inc_rate")) return ["atkRate", magnitude];
  if (normalized.includes("def_inc_rate")) return ["defRate", magnitude];
  if (normalized.includes("hp_inc_rate")) return ["hpRate", magnitude];
  if (normalized.includes("cri_dmg")) return ["critDamage", magnitude];
  if (normalized.includes("cri_inc")) return ["crit", magnitude];
  if (normalized.includes("atk_inc_add")) return ["atkFlat", magnitude];
  if (normalized.includes("def_inc_add")) return ["defFlat", magnitude];
  if (normalized.includes("hp_inc_add")) return ["hpFlat", magnitude];
  return [null, 0];
};

const applyDamageModifier = (stats, effect) => {
  const value = asNumber(effect.eff_value);
  const sign = effect.eff_value_math_sign;
  if (sign === "MATHSIGN_ADD_HUND_MULTIPLY_PCT") stats.damageRate += value;
  else if (sign === "MATHSIGN_MULTIPLY_PCT") stats.damageMultiplier *= value / 100;
  else if (sign === "MATHSIGN_MULTIPLY") stats.damageMultiplier *= value;
  else if (sign === "MATHSIGN_ADD") stats.skillPowerAdd += value;
  else return false;
  return true;
};

function applyPassiveGraph(unit, maps, roots, source) {
  const seen = new Set();
  const applyEffect = (effectId) => {
    if (seen.has(`e:${effectId}`)) return;
    seen.add(`e:${effectId}`);
    const effect = maps.effects.get(effectId);
    if (!effect) { unit.approximations.add(`Missing effect ${effectId}`); return; }
    if (asList(effect.eff_link_condition_id).length) {
      unit.approximations.add(`Conditional passive ${effect.eff_link_condition_id}`);
      return;
    }
    if (effect.eff === "SKILL_EFF_DAMAGE_VALUE_ADD") {
      if (applyDamageModifier(unit.stats, effect)) unit.sources.push(source);
    } else if (effect.eff === "SKILL_EFF_CRITICAL_PCT_VALUE_ADD") {
      unit.stats.crit += asNumber(effect.eff_value);
      unit.sources.push(source);
    }
    for (const csId of asList(effect.link_cs_id)) applyCs(csId);
    for (const child of [...asList(effect.during_eff_0_link_skill_eff_id), ...asList(effect.during_eff_1_link_skill_eff_id)]) applyEffect(child);
  };
  const applyCs = (csId) => {
    if (seen.has(`c:${csId}`)) return;
    seen.add(`c:${csId}`);
    const cs = maps.cs.get(csId);
    if (!cs) { unit.approximations.add(`Missing CS ${csId}`); return; }
    for (const effectId of asList(cs.link_skill_eff_id)) applyEffect(effectId);
  };
  const applyNb = (nbId) => {
    const nb = maps.nb.get(nbId);
    if (!nb) { unit.approximations.add(`Missing NB effect ${nbId}`); return; }
    if (["EFF_STAT_UP_OWNER", "EFF_STAT_UP_TEAM", "EFF_STAT_UP_PARTNER"].includes(nb.nb_eff)) {
      let applied = false;
      for (const token of asList(nb.opt_multiple_link)) {
        const [key, encoded] = tokenStat(token);
        if (key) {
          unit.stats[key] = (unit.stats[key] || 0) + (encoded || asNumber(nb.eff_value));
          applied = true;
        }
      }
      if (applied) unit.sources.push(source);
      else unit.approximations.add(`${nb.nb_eff} ${nbId}`);
    } else if (nb.nb_eff === "EFF_HP_MAX_UP_PCT") {
      unit.stats.hpRate += asNumber(nb.eff_value);
      unit.sources.push(source);
    } else {
      unit.approximations.add(`${nb.nb_eff || "NB"} ${nbId}`);
    }
    for (const effectId of asList(nb.battle_start_link_skill_eff_id)) applyEffect(effectId);
    for (const csId of asList(nb.stage_maintain_link_cs_id)) applyCs(csId);
  };
  for (const root of roots) {
    if (root.kind === "cs") applyCs(root.id);
    else if (root.kind === "nb") applyNb(root.id);
    else applyEffect(root.id);
  }
}

export function computeUnitPreview(data, config) {
  const maps = makeMaps(data);
  const combatant = maps.combatants.get(config.combatantId);
  if (!combatant) return null;
  const level = Math.max(1, Math.min(combatant.maxLevel, asNumber(config.level, combatant.maxLevel)));
  const growth = curveAtLevel(combatant.levelCurve, level);
  const stats = {
    atk: asNumber(combatant.stats.atk) + asNumber(growth.S_ATK),
    def: asNumber(combatant.stats.def) + asNumber(growth.S_DEF),
    hp: asNumber(combatant.stats.hp) + asNumber(growth.S_HP),
    crit: asNumber(combatant.stats.crit), critDamage: asNumber(combatant.stats.critDamage, 125),
    weakDamage: asNumber(combatant.stats.weakDamage, 100), atkFlat: 0, defFlat: 0, hpFlat: 0,
    atkRate: 0, defRate: 0, hpRate: 0, damageRate: 0, damageMultiplier: 1, skillPowerAdd: 0,
    chargingPower: 0, additionalDamage: asNumber(combatant.stats.additionalAttackDamage),
    dotDamage: asNumber(combatant.stats.dotDamage), redDamage: 0, greenDamage: 0, blueDamage: 0,
    purpleDamage: 0, orangeDamage: 0,
  };
  const unit = {
    id: combatant.id, name: config.name || combatant.name, combatant, partner: null, level, stats,
    sources: [], approximations: new Set(), statuses: [], shield: 0,
  };
  const partner = maps.partners.get(config.partnerId);
  if (partner) {
    unit.partner = partner;
    const partnerLevel = Math.max(1, Math.min(partner.maxLevel, asNumber(config.partnerLevel, partner.maxLevel)));
    const pg = curveAtLevel(partner.levelCurve, partnerLevel);
    stats.atkFlat += asNumber(partner.stats.atk) + asNumber(pg.S_ATK_INC_ADD_OUT);
    stats.defFlat += asNumber(partner.stats.def) + asNumber(pg.S_DEF_INC_ADD_OUT);
    stats.hpFlat += asNumber(partner.stats.hp) + asNumber(pg.S_HP_INC_ADD_OUT);
    const passives = partner.passives || [];
    if (passives.length) {
      const passive = passives.reduce((best, row) => asNumber(row.level) > asNumber(best.level) ? row : best, passives[0]);
      applyPassiveGraph(unit, maps, [
        ...asList(passive.link_cs_id).map((id) => ({ kind: "cs", id })),
        ...asList(passive.link_nb_eff_id).map((id) => ({ kind: "nb", id })),
      ], `Partner: ${partner.id}`);
    }
  }
  for (const [relicType, relicId] of Object.entries(config.relics || {})) {
    const relic = maps.equipment.get(relicId);
    const starLevel = Math.max(1, Math.min(5, asNumber(config.equipment?.[relicType]?.starLevel, 5)));
    for (const slot of relic?.slots?.filter((item) => item.slot <= starLevel) || []) {
      if (!asList(slot.cs).length && !asList(slot.nb).length) continue;
      applyPassiveGraph(unit, maps, [
        ...asList(slot.cs).map((id) => ({ kind: "cs", id })),
        ...asList(slot.nb).map((id) => ({ kind: "nb", id })),
      ], `Relic: ${relic.id} (${slot.slot}★)`);
    }
  }
  const setCounts = new Map();
  for (const gear of config.gear || []) {
    const piece = maps.pieces.get(gear.pieceId);
    if (!piece) continue;
    setCounts.set(piece.setId, (setCounts.get(piece.setId) || 0) + 1);
    const main = maps.pieceOptions.get(gear.main?.optionId);
    if (main) applyStat(stats, main.link_stat_list_id, gearRollValue(main, gear.main.quality, gear.main.reinforce, piece.rarity));
    for (const sub of gear.substats || []) {
      const option = maps.pieceOptions.get(sub.optionId);
      if (option) applyStat(stats, option.link_stat_list_id, gearRollValue(option, sub.quality, sub.reinforce, piece.rarity));
    }
  }
  for (const [setId, count] of setCounts) {
    const set = maps.pieceSets.get(setId);
    if (!set) continue;
    for (const threshold of [2, 4, 6]) {
      if (count < threshold) continue;
      const type = set[`set${threshold}_type`];
      const option = set[`set${threshold}_option_multiple_link`];
      const value = set[`set${threshold}_value`];
      if (type === "SET_TYPE_STAT") applyStat(stats, option, value);
      else if (type === "SET_TYPE_CS") applyPassiveGraph(unit, maps, [{ kind: "cs", id: option }], `Set ${setId} (${threshold})`);
      else if (type === "SET_TYPE_NB_EFF") applyPassiveGraph(unit, maps, [{ kind: "nb", id: option }], `Set ${setId} (${threshold})`);
    }
  }
  stats.atk = (stats.atk + stats.atkFlat) * (1 + stats.atkRate / 100);
  stats.def = (stats.def + stats.defFlat) * (1 + stats.defRate / 100);
  stats.hp = (stats.hp + stats.hpFlat) * (1 + stats.hpRate / 100);
  Object.assign(unit, stats);
  unit.maxHp = Math.max(1, Math.round(stats.hp));
  return unit;
}

class SeededRandom {
  constructor(seed) { this.seed = (asNumber(seed, 133) >>> 0) || 133; }
  next() { this.seed = (1664525 * this.seed + 1013904223) >>> 0; return this.seed / 4294967296; }
  pick(items) { return items[Math.floor(this.next() * items.length)]; }
}

class LegacyBattleEngine {
  constructor(data, config) {
    this.data = data;
    this.config = config;
    this.maps = makeMaps(data);
    this.random = new SeededRandom(config.seed);
    this.uid = 0;
    this.events = [];
    this.approximations = new Set();
    this.eventStacks = new Map();
    this.state = this.createState();
  }

  display(value, fallback = value) {
    return this.data.text?.[value] || fallback || value;
  }

  createState() {
    const team = this.config.units.map((unit) => computeUnitPreview(this.data, unit)).filter(Boolean);
    const enemyDef = Math.max(0, asNumber(this.config.enemy.def, 100));
    const enemyHp = Math.max(1, asNumber(this.config.enemy.hp, 10000));
    const state = {
      turn: 1, phase: "player", ap: this.config.ap, maxAp: this.config.ap, handSize: this.config.handSize,
      team, enemy: {
        ...this.maps.enemies.get(this.config.enemy.id), name: this.config.enemy.name || this.maps.enemies.get(this.config.enemy.id)?.name,
        hp: enemyHp, maxHp: enemyHp,
        atk: Math.max(1, asNumber(this.config.enemy.atk, 200)), def: enemyDef, shield: 0, statuses: [],
      },
      hand: [], drawPile: [], discardPile: [], exhaustPile: [], over: false, result: null,
      turnEvents: {},
    };
    state.drawPile = this.config.deck.map((entry) => ({
      ...entry,
      uid: entry.uid || `card-${++this.uid}`,
      cardId: entry.cardId,
      baseCardId: entry.baseCardId || entry.cardId,
      ownerIndex: entry.ownerIndex,
      epiphanyId: entry.epiphanyId || entry.uniqueId || "",
      addedTalents: [...asList(entry.addedTalents)],
      removedTalents: [...asList(entry.removedTalents)],
      addedEffectIds: [...asList(entry.addedEffectIds)],
    }));
    this.shuffle(state.drawPile);
    this.state = state;
    const innate = state.drawPile.filter((instance) => asList(this.getCard(instance)?.talent).includes("TALENT_INNATE"));
    if (innate.length) state.drawPile = [
      ...state.drawPile.filter((instance) => !innate.includes(instance)),
      ...innate,
    ];
    for (const unit of team) for (const item of unit.approximations) this.approximations.add(item);
    if (state.enemy.startCard) this.resolveEnemyCard(state.enemy.startCard, true);
    this.moveStartTurnCardsToHand();
    this.drawToHand("turn");
    this.orderRossweisseShards();
    this.log(`Battle started against ${this.display(state.enemy.name, state.enemy.id)}.`, "system");
    return state;
  }

  shuffle(items) {
    for (let index = items.length - 1; index > 0; index -= 1) {
      const other = Math.floor(this.random.next() * (index + 1));
      [items[index], items[other]] = [items[other], items[index]];
    }
  }

  log(message, type = "system", meta = {}) {
    this.events.push({ turn: this.state?.turn || 1, phase: this.state?.phase || "setup", type, message, ...meta });
  }

  warn(message) {
    this.approximations.add(message);
    this.log(message, "warning");
  }

  drawOne(source = "ability") {
    const state = this.state;
    if (!state.drawPile.length && state.discardPile.length) {
      state.drawPile = state.discardPile.splice(0);
      this.shuffle(state.drawPile);
      this.log("Discard pile reshuffled into the draw pile.");
    }
    const card = state.drawPile.pop();
    if (card) {
      this.enterHand(card);
      this.emitEvent("cardsDrawn", { ownerIndex: card.ownerIndex, count: 1, card, source });
    }
    return card;
  }

  drawToHand(source = "turn") {
    while (this.state.hand.length < this.state.handSize && (this.state.drawPile.length || this.state.discardPile.length)) this.drawOne(source);
  }

  getCard(instance) {
    const base = this.maps.cards.get(instance.cardId);
    if (!base) return null;
    const removed = new Set(asList(instance.removedTalents));
    const talent = [...new Set([...asList(base.talent), ...asList(instance.addedTalents)])]
      .filter((entry) => !removed.has(entry));
    const cost = instance.costSet === null || instance.costSet === undefined
      ? asNumber(base.cost) + asNumber(instance.costDelta)
      : asNumber(instance.costSet);
    return {
      ...base,
      cost: cost < 0 ? cost : Math.max(0, cost),
      talent,
      link_skill_eff_id: [...asList(base.link_skill_eff_id), ...asList(instance.addedEffectIds)],
    };
  }

  enterHand(instance, position = "right") {
    const card = this.getCard(instance);
    const talents = asList(card?.talent);
    const bindTalent = talents.find((talent) => String(talent).startsWith("TALENT_BIND"));
    if (bindTalent) {
      const existing = this.state.hand.find((item) => item.cardId === instance.cardId && item.ownerIndex === instance.ownerIndex);
      if (existing) {
        const maximum = Math.max(1, asNumber(String(bindTalent).match(/_(\d+)$/)?.[1], 999));
        existing.bindStacks = Math.min(maximum, asNumber(existing.bindStacks, 1) + asNumber(instance.bindStacks, 1));
        this.log(`${this.display(card.name, card.id)} stacked to ${existing.bindStacks}.`, "card", { cardId: card.id });
        return [existing];
      }
      instance.bindStacks = Math.max(1, asNumber(instance.bindStacks, 1));
    }
    if (card && talents.includes("TALENT_LIGHT_DARK") && instance.lastPolarizedTurn !== this.state.turn) {
      return this.polarizeRossweisse(instance, card);
    }
    if (talents.includes("TALENT_LIGHT")) position = "left";
    else if (talents.includes("TALENT_DARK")) position = "right";
    if (position === "left") this.state.hand.unshift(instance);
    else this.state.hand.push(instance);
    return [instance];
  }

  moveStartTurnCardsToHand() {
    const state = this.state;
    const pulled = [];
    const takeMatching = (pile, predicate) => {
      for (let index = pile.length - 1; index >= 0; index -= 1) {
        if (!predicate(pile[index])) continue;
        pulled.push(pile.splice(index, 1)[0]);
      }
    };
    const isForced = (instance) => {
      const talents = asList(this.getCard(instance)?.talent);
      return talents.includes("TALENT_LIGHT_DARK") || talents.includes("TALENT_LIGHT") || talents.includes("TALENT_DARK");
    };
    takeMatching(state.hand, (instance) => asList(this.getCard(instance)?.talent).includes("TALENT_LIGHT_DARK"));
    takeMatching(state.drawPile, isForced);
    takeMatching(state.discardPile, isForced);
    for (const instance of pulled) this.enterHand(instance);
    if (pulled.length) this.log(`Moved ${pulled.length} Light/Dark card${pulled.length === 1 ? "" : "s"} to hand for turn start.`, "card");
    this.orderRossweisseShards();
  }

  polarizeRossweisse(instance, card) {
    const children = asList(card.child_link_card_id);
    const lightId = children.find((id) => /_mut1$/.test(id));
    const darkId = children.find((id) => /_mut2$/.test(id));
    if (!lightId || !darkId || !this.maps.cards.has(lightId) || !this.maps.cards.has(darkId)) {
      this.state.hand.push(instance);
      this.warn(`${card.id} has LIGHT_DARK but its shard cards are missing.`);
      return [instance];
    }
    const pairId = `polar-${++this.uid}`;
    const common = {
      ...instance,
      pairId,
      parentCardId: card.id,
      parentBaseCardId: instance.baseCardId,
      coalesced: false,
      lastPolarizedTurn: this.state.turn,
      addedTalents: [...asList(instance.addedTalents)],
      removedTalents: [...asList(instance.removedTalents)],
      addedEffectIds: [...asList(instance.addedEffectIds)],
    };
    const light = { ...common, uid: `${pairId}-light`, cardId: lightId, shard: "light" };
    const dark = { ...common, uid: `${pairId}-dark`, cardId: darkId, shard: "dark" };
    this.state.hand.unshift(light);
    this.state.hand.push(dark);
    this.log(`${this.display(card.name, card.id)} polarized into Shard: Light and Shard: Dark.`, "card", { cardId: card.id });
    return [light, dark];
  }

  orderRossweisseShards() {
    const lights = this.state.hand.filter((card) => card.shard === "light");
    const darks = this.state.hand.filter((card) => card.shard === "dark");
    if (!lights.length && !darks.length) return;
    const middle = this.state.hand.filter((card) => !card.shard);
    this.state.hand = [...lights, ...middle, ...darks];
  }

  coalesceRossweisse() {
    const pairs = new Map();
    for (const instance of this.state.hand) {
      if (!instance.pairId) continue;
      const pair = pairs.get(instance.pairId) || {};
      pair[instance.shard] = instance;
      pairs.set(instance.pairId, pair);
    }
    for (const [pairId, pair] of pairs) {
      if (!pair.light || !pair.dark) continue;
      const ownerIndex = pair.light.ownerIndex;
      const allowed = this.state.hand.every((instance) =>
        instance.pairId === pairId || (instance.cardId === "c_30134_cre1" && instance.ownerIndex === ownerIndex));
      if (!allowed) continue;
      const tassels = this.state.hand.filter((instance) => instance.cardId === "c_30134_cre1" && instance.ownerIndex === ownerIndex);
      const tasselStacks = tassels.reduce((sum, item) => sum + asNumber(item.bindStacks, 1), 0);
      this.state.hand = this.state.hand.filter((instance) => instance.pairId !== pairId && !tassels.includes(instance));
      const parent = {
        ...pair.light,
        uid: `card-${++this.uid}`,
        cardId: pair.light.parentCardId,
        baseCardId: pair.light.parentBaseCardId || pair.light.baseCardId,
        shard: undefined,
        pairId: undefined,
        parentCardId: undefined,
        parentBaseCardId: undefined,
        coalesced: true,
        oneShotDamageRate: asNumber(pair.light.oneShotDamageRate) + 80 * tasselStacks,
      };
      this.state.hand.push(parent);
      this.log(`Shard: Light and Shard: Dark coalesced into ${this.display(this.maps.cards.get(parent.cardId)?.name, parent.cardId)} with ${tasselStacks} Sword Tassel stack${tasselStacks === 1 ? "" : "s"}.`, "card", { cardId: parent.cardId });
      return parent;
    }
    return null;
  }

  emitEvent(type, payload = {}) {
    const event = { type, ...payload };
    this.handleRossweisseTriggers(event);
  }

  handleRossweisseTriggers(event) {
    const shards = [...this.state.hand].filter((instance) => instance.shard && /c_30134_srt4/.test(instance.cardId));
    for (const shard of shards) {
      const key = `${shard.uid}:${this.state.turn}`;
      const tracker = this.state.turnEvents[key] ||= { activations: 0, otherCards: 0 };
      const rsp = shard.cardId.match(/_rsp(\d+)_mut/)?.[1] || "0";
      const activationLimit = rsp === "3" ? 1 : 2;
      if (tracker.activations >= activationLimit) continue;
      let trigger = false;
      if (rsp === "5") {
        trigger = shard.shard === "light"
          ? event.type === "apGained" && event.source === "ability"
          : event.type === "cardPlayed" && asNumber(event.cost) >= 1;
      } else if (rsp === "2") {
        trigger = shard.shard === "light"
          ? event.type === "cardDiscarded" && event.ownerIndex === shard.ownerIndex && event.source === "ability"
          : event.type === "cardsDrawn" && event.ownerIndex === shard.ownerIndex && event.source === "ability";
      } else if (rsp === "3") {
        trigger = shard.shard === "light"
          ? event.type === "unitAttacked" && event.ownerIndex === shard.ownerIndex
          : event.type === "shieldGained" && event.ownerIndex === shard.ownerIndex;
      } else if (rsp !== "4" && event.type === "cardPlayed") {
        if (shard.shard === "light") trigger = event.ownerIndex === shard.ownerIndex;
        else if (event.ownerIndex !== shard.ownerIndex) {
          tracker.otherCards += 1;
          trigger = tracker.otherCards % 2 === 0;
        }
      }
      if (trigger) this.triggerRossweisseShard(shard, tracker, activationLimit);
    }
  }

  triggerRossweisseShard(instance, tracker, activationLimit = 2) {
    const card = this.getCard(instance);
    const actor = this.state.team[instance.ownerIndex];
    if (!card || !actor) return;
    tracker.activations += 1;
    const context = {
      damageRate: asNumber(instance.effectDamageRate), multiplier: 1, skillPowerAdd: 0, crit: 0, critDamage: 0,
      cureRate: 0, shieldRate: 0, visited: new Set(), card, instance, destination: null,
    };
    const damageEffect = asList(card.link_skill_eff_id).map((id) => this.maps.effects.get(id))
      .find((effect) => effect?.operation === "OPERATION_ACTIVE" && ["SKILL_EFF_DMG", "SKILL_EFF_DMG_IGNORE_COND"].includes(effect.eff));
    if (damageEffect) this.resolveEffect(damageEffect.id, actor, "player", context, 0);
    const tassel = { uid: `card-${++this.uid}`, cardId: "c_30134_cre1", baseCardId: "c_30134_cre1", ownerIndex: instance.ownerIndex, generated: true, bindStacks: 1 };
    this.enterHand(tassel);
    this.log(`${this.display(card.name, card.id)} activated (${tracker.activations}/${activationLimit}) and created Sword Tassel.`, "card", { cardId: card.id });
  }

  playerCard(cardUid) {
    const state = this.state;
    if (state.over || state.phase !== "player") return { ok: false, error: "It is not the player phase." };
    const index = state.hand.findIndex((card) => card.uid === cardUid);
    if (index < 0) return { ok: false, error: "Card is no longer in hand." };
    const instance = state.hand[index];
    const card = this.getCard(instance);
    const owner = state.team[instance.ownerIndex];
    if (!card || !owner || owner.hp <= 0) return { ok: false, error: "This card has no living owner." };
    if (asList(card.talent).includes("TALENT_UNPLAYABLE")) return { ok: false, error: "This card cannot be played directly." };
    const printedCost = asNumber(card.cost);
    const cost = printedCost < 0 ? state.ap : Math.max(0, printedCost);
    if (cost > state.ap) return { ok: false, error: `Not enough AP: ${cost} required.` };
    state.ap -= cost;
    state.hand.splice(index, 1);
    this.log(`${owner.name || owner.id} played ${this.display(card.name, card.id)} (${cost} AP).`, "card", { cardId: card.id });
    const context = this.resolveCardEffects(card, owner, "player", instance);
    this.emitEvent("cardPlayed", { ownerIndex: instance.ownerIndex, card, instance, cost });
    const resolvedCard = this.getCard(instance) || card;
    instance.coalesced = false;
    instance.oneShotDamageRate = 0;
    const resolvedTalents = asList(resolvedCard.talent);
    if (context.destination === "exhaust" || resolvedTalents.includes("TALENT_EXHAUST")) state.exhaustPile.push(instance);
    else if (context.destination === "hand") state.hand.push(instance);
    else if (context.destination === "deck") state.drawPile.unshift(instance);
    else if (resolvedTalents.includes("TALENT_RECALL")) {
      instance.removedTalents = [...new Set([...asList(instance.removedTalents), "TALENT_RECALL"])];
      this.enterHand(instance);
      this.log(`${this.display(card.name, card.id)} returned to hand and lost Retrieve.`, "card", { cardId: card.id });
    } else state.discardPile.push(instance);
    this.coalesceRossweisse();
    this.checkEnd();
    return { ok: true };
  }

  endTurn() {
    const state = this.state;
    if (state.over || state.phase !== "player") return;
    for (const instance of state.hand.splice(0)) {
      const card = this.getCard(instance);
      if (asList(card?.talent).includes("TALENT_RETAIN")) state.hand.push(instance);
      else if (asList(card?.talent).includes("TALENT_ETHEREAL")) state.exhaustPile.push(instance);
      else state.discardPile.push(instance);
    }
    this.coalesceRossweisse();
    state.phase = "enemy";
    this.enemyTurn();
    if (state.over) return;
    state.turn += 1;
    state.phase = "player";
    state.ap = state.maxAp;
    state.turnEvents = {};
    this.tickStatuses();
    this.moveStartTurnCardsToHand();
    this.drawToHand("turn");
    this.orderRossweisseShards();
    this.coalesceRossweisse();
    this.log(`Player turn ${state.turn} began with ${state.ap} AP.`);
  }

  enemyTurn() {
    const enemy = this.state.enemy;
    const actions = (enemy.actions || []).filter((action) => asNumber(action.weight) > 0 && (!action.condition || action.condition === "none"));
    if (!actions.length) {
      this.warn(`Enemy ${enemy.id} has no unconditional weighted action in the extracted phase.`);
      return;
    }
    const total = actions.reduce((sum, action) => sum + asNumber(action.weight), 0);
    let roll = this.random.next() * total;
    let action = actions[actions.length - 1];
    for (const candidate of actions) {
      roll -= asNumber(candidate.weight);
      if (roll <= 0) { action = candidate; break; }
    }
    this.resolveEnemyCard(action.cardId, false);
    this.checkEnd();
  }

  resolveEnemyCard(cardId, opening) {
    const card = this.maps.enemyCards.get(cardId);
    if (!card) { this.warn(`Missing enemy card ${cardId}`); return; }
    this.log(`${opening ? "Opening" : "Enemy"} action: ${card.name && card.name !== "none" ? this.display(card.name, card.id) : card.id}.`, "enemy", { cardId });
    this.resolveCardEffects(card, this.state.enemy, "enemy");
  }

  resolveCardEffects(card, actor, side, instance = null) {
    const context = {
      damageRate: asNumber(instance?.effectDamageRate) + asNumber(instance?.oneShotDamageRate), multiplier: 1, skillPowerAdd: 0, crit: 0, critDamage: 0,
      cureRate: 0, shieldRate: 0, visited: new Set(), card, instance, destination: null,
    };
    for (const effectId of asList(card.link_skill_eff_id)) this.resolveEffect(effectId, actor, side, context, 0);
    return context;
  }

  resolveEffect(effectId, actor, side, context, depth) {
    if (depth > 10 || context.visited.has(effectId)) return;
    context.visited.add(effectId);
    const effect = this.maps.effects.get(effectId);
    if (!effect) { this.warn(`Missing skill effect ${effectId}`); return; }
    if (asNumber(effect.run_pct, 100) < 100 && this.random.next() * 100 >= asNumber(effect.run_pct, 100)) return;
    const conditions = asList(effect.eff_link_condition_id);
    const ignoresCondition = effect.eff?.includes("IGNORE_COND");
    if (conditions.length && !ignoresCondition) {
      this.warn(`Skipped conditional branch ${conditions.join(", ")} on ${context.card.id}.`);
      return;
    }
    const type = effect.eff;
    if (type === "SKILL_EFF_DAMAGE_VALUE_ADD") applyDamageModifier(context, effect);
    else if (type === "SKILL_EFF_DMG" || type === "SKILL_EFF_DMG_IGNORE_COND") this.applyDamage(effect, actor, side, context);
    else if (["SKILL_EFF_CURE", "SKILL_EFF_HEAL"].includes(type)) this.applyHealing(effect, actor, side, context);
    else if (type === "SKILL_EFF_SHIELD") this.applyShield(effect, actor, side, context);
    else if (type === "SKILL_EFF_CRITICAL_PCT_VALUE_ADD") context.crit += asNumber(effect.eff_value);
    else if (type === "SKILL_EFF_CRITICAL_DAMAGE_VALUE_ADD") context.critDamage += asNumber(effect.eff_value);
    else if (type === "SKILL_EFF_CURE_VALUE_ADD") context.cureRate += asNumber(effect.eff_value);
    else if (type === "SKILL_EFF_SHIELD_VALUE_ADD") context.shieldRate += asNumber(effect.eff_value);
    else if (type === "SKILL_EFF_CARD_DRAW") {
      const count = Math.max(1, Math.round(asNumber(effect.eff_count_value, asNumber(effect.eff_value, 1))));
      for (let index = 0; index < count; index += 1) this.drawOne("ability");
      this.log(`Drew ${count} card${count === 1 ? "" : "s"}.`, "card");
    } else if (["SKILL_EFF_CARD_GET", "SKILL_EFF_CARD_GET_USER"].includes(type)) this.cardGet(effect, actor, side, context);
    else if (type === "SKILL_EFF_CARD_DISCARD") this.cardDiscard(effect, context);
    else if (["SKILL_EFF_ENERGY_CHANGE", "SKILL_EFF_ENERGY_FORCE_CHANGE"].includes(type) && side === "player") {
      const delta = asNumber(effect.eff_value);
      this.state.ap = Math.max(0, this.state.ap + delta);
      this.log(`AP changed by ${delta}.`, "system");
      if (delta > 0) this.emitEvent("apGained", { amount: delta, source: "ability", ownerIndex: this.state.team.indexOf(actor) });
    } else if (["SKILL_EFF_CS_SET_ADD", "SKILL_EFF_CS_SET_ADD_AUTO", "SKILL_EFF_CS_SET_ADD_IGNORE_COND", "SKILL_EFF_CS_SET_ADD_IGNORE_BLOCK"].includes(type)) {
      for (const csId of asList(effect.link_cs_id)) this.addStatus(csId, actor, side, asNumber(effect.eff_value, 1), context, depth + 1, effect.target_unit_type);
    } else if (type === "SKILL_EFF_TRIGGER_CS") this.triggerStatus(effect, actor, side, context, depth + 1);
    else if (["SKILL_EFF_CARD_TALENT_ADD", "SKILL_EFF_CARD_TALENT_REMOVE", "SKILL_EFF_CARD_TALENT_REPLACE"].includes(type)) this.changeCardTalent(effect, context);
    else if (type === "SKILL_EFF_CARD_COST_CHANGE") this.changeCardCost(effect, context);
    else if (type === "SKILL_EFF_CARD_CHANGE") this.changeCard(effect, context);
    else if (["SKILL_EFF_CARD_COPY_TO", "SKILL_EFF_CARD_COPY_TO_ORIGIN"].includes(type)) this.copyCard(effect, context);
    else if (["SKILL_EFF_CARD_RAN_SELECT_USE", "SKILL_EFF_CARD_OPTION_SELECT"].includes(type)) this.useOptionCard(effect, actor, side, context, depth + 1);
    else if (["SKILL_EFF_CARD_USE_ADDITIONAL", "SKILL_EFF_CARD_USE"].includes(type)) this.useAdditionalCard(effect, actor, side, context, depth + 1);
    else if (type === "SKILL_EFF_CARD_MOVE_TO" || type === "SKILL_EFF_CARD_EXHAUST") this.moveCurrentCard(effect, context);
    else if (!["SKILL_EFF_NONE", "SKILL_EFF_TRIGGER_PYEONRIN"].includes(type)) {
      this.warn(`Unmodeled effect ${type} (${effectId}).`);
    }
    this.resolveChildBranch(effect, 0, actor, side, context, depth);
    this.resolveChildBranch(effect, 1, actor, side, context, depth);
  }

  resolveChildBranch(effect, branch, actor, side, context, depth) {
    const children = asList(effect[`during_eff_${branch}_link_skill_eff_id`]);
    if (!children.length) return;
    const conditions = asList(effect[`during_eff_${branch}_link_condition_id`]);
    if (conditions.length) {
      this.warn(`Skipped conditional branch ${conditions.join(", ")} on ${context.card.id}.`);
      return;
    }
    for (const child of children) this.resolveEffect(child, actor, side, context, depth + 1);
  }

  statusModifiers(actor) {
    const result = { damageRate: 0, multiplier: 1, skillPowerAdd: 0, crit: 0 };
    for (const status of actor.statuses || []) {
      const cs = this.maps.cs.get(status.csId);
      for (const effectId of asList(cs?.link_skill_eff_id)) {
        const effect = this.maps.effects.get(effectId);
        if (!effect || asList(effect.eff_link_condition_id).length) continue;
        if (effect.eff === "SKILL_EFF_DAMAGE_VALUE_ADD") applyDamageModifier(result, effect);
        if (effect.eff === "SKILL_EFF_CRITICAL_PCT_VALUE_ADD") result.crit += asNumber(effect.eff_value);
      }
    }
    return result;
  }

  applyDamage(effect, actor, side, context) {
    const targetType = String(effect.target_unit_type || "");
    const targets = side === "player"
      ? [this.state.enemy]
      : targetType.includes("ALL")
        ? this.state.team.filter((unit) => unit.hp > 0)
        : [this.pickPartyTarget(targetType)];
    const attrs = asList(effect.eff_attr);
    const count = Math.max(1, Math.round(asNumber(effect.eff_count_value, 1)));
    const status = this.statusModifiers(actor);
    for (const target of targets.filter(Boolean)) {
      const base = attrs.includes("DMG_ATTR_BASE_ON_DEF") ? actor.def : actor.atk;
      let amount = attrs.includes("DMG_ATTR_FIX") ? asNumber(effect.eff_value) : base * ((asNumber(effect.eff_value) + context.skillPowerAdd + status.skillPowerAdd) / 100);
      if (!attrs.includes("DMG_ATTR_IGNORE_DEF") && !attrs.includes("DMG_ATTR_NO_DMG_REDUCE")) amount *= 503 / (Math.max(0, target.def) + 503);
      amount *= (1 + ((actor.damageRate || 0) + context.damageRate + status.damageRate) / 100);
      amount *= (actor.damageMultiplier || 1) * context.multiplier * status.multiplier;
      if (side === "player") {
        amount *= asNumber(this.config.weakness, 1);
        const critChance = Math.max(0, Math.min(100, (actor.crit || 0) + status.crit + context.crit));
        if (this.random.next() * 100 < critChance) {
          amount *= Math.max(1, (asNumber(actor.critDamage, 125) + context.critDamage) / 100);
          this.log("Critical hit.", "system");
        }
      }
      amount *= count;
      const dealt = this.dealDamage(target, amount);
      this.log(`${actor.name || actor.id} dealt ${Math.round(dealt)} damage with ${this.display(context.card.name, context.card.id)}.`, "damage", { amount: dealt });
      if (side === "enemy") this.emitEvent("unitAttacked", { ownerIndex: this.state.team.indexOf(target), target, amount: dealt });
    }
  }

  dealDamage(target, raw) {
    let amount = Math.max(0, raw);
    const absorbed = Math.min(target.shield || 0, amount);
    target.shield = Math.max(0, (target.shield || 0) - absorbed);
    amount -= absorbed;
    const dealt = Math.min(target.hp, amount);
    target.hp = Math.max(0, target.hp - dealt);
    return dealt;
  }

  friendlyTargets(actor, side, targetType) {
    if (side === "enemy") return [this.state.enemy];
    const living = this.state.team.filter((unit) => unit.hp > 0);
    if (String(targetType).includes("ALL")) return living;
    if (String(targetType).includes("OWNER") || String(targetType).includes("CASTER") || String(targetType).includes("USER")) return [actor];
    return [living.sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0] || actor];
  }

  applyHealing(effect, actor, side, context) {
    for (const target of this.friendlyTargets(actor, side, effect.target_unit_type)) {
      const amount = Math.max(0, actor.atk * asNumber(effect.eff_value) / 100 * (1 + context.cureRate / 100));
      const healed = Math.min(target.maxHp - target.hp, amount);
      target.hp += healed;
      this.log(`${target.name || target.id} recovered ${Math.round(healed)} HP.`, "heal", { amount: healed });
    }
  }

  applyShield(effect, actor, side, context) {
    for (const target of this.friendlyTargets(actor, side, effect.target_unit_type)) {
      const base = asList(effect.eff_attr).includes("DMG_ATTR_BASE_ON_DEF") ? actor.def : actor.atk;
      const amount = Math.max(0, base * asNumber(effect.eff_value) / 100 * (1 + context.shieldRate / 100));
      target.shield = (target.shield || 0) + amount;
      this.log(`${target.name || target.id} gained ${Math.round(amount)} shield.`, "shield", { amount });
      if (side === "player") this.emitEvent("shieldGained", { ownerIndex: this.state.team.indexOf(target), target, amount });
    }
  }

  cardGet(effect, actor, side, context = null) {
    if (side !== "player") return;
    const options = [...asList(effect.link_card_id), ...asList(effect.card_link_id), ...asList(effect.eff_opt_multiple_link), ...asList(effect.eff_opt)];
    if (options.includes("trigger_pyeonrin")) options.push(...asList(context?.card?.child_link_card_id));
    const possible = options
      .filter((cardId) => this.maps.cards.has(cardId));
    if (!possible.length) { this.warn(`Card generation parameters for ${effect.id} are not decoded.`); return; }
    for (const cardId of possible.slice(0, Math.max(1, asNumber(effect.eff_count_value, 1)))) {
      const ownerIndex = this.state.team.indexOf(actor);
      this.enterHand({ uid: `card-${++this.uid}`, cardId, baseCardId: cardId, ownerIndex, generated: true });
      const generated = this.maps.cards.get(cardId);
      this.log(`Generated ${this.display(generated?.name, cardId)}.`, "card");
    }
  }

  cardDiscard(effect, context = null) {
    const count = Math.max(1, Math.round(asNumber(effect.eff_count_value, asNumber(effect.eff_value, 1))));
    for (let index = 0; index < count && this.state.hand.length; index += 1) {
      let candidates = [...this.state.hand];
      if (/_rsp4_mut2$/.test(context?.card?.id || "")) {
        candidates = candidates.filter((instance) => instance.ownerIndex !== context.instance?.ownerIndex);
      } else if (/_rsp4_mut1$/.test(context?.card?.id || "")) {
        candidates = candidates.filter((instance) => {
          const card = this.getCard(instance);
          return /CURSE|STATUS|AILMENT|INJURY/.test(`${card?.sort || ""} ${asList(card?.talent).join(" ")}`);
        });
      }
      if (!candidates.length) break;
      const discarded = this.random.pick(candidates);
      this.state.hand.splice(this.state.hand.indexOf(discarded), 1);
      this.state.discardPile.push(discarded);
      this.emitEvent("cardDiscarded", { ownerIndex: discarded.ownerIndex, card: discarded, source: "ability" });
    }
    this.log(`Discarded up to ${count} card${count === 1 ? "" : "s"}.`, "card");
  }

  addStatus(csId, actor, side, stacks, context, depth, targetType = "") {
    const cs = this.maps.cs.get(csId);
    if (!cs) { this.warn(`Missing CS ${csId}.`); return; }
    const isDebuff = String(cs.cs_buff_type || "").includes("DEBUFF");
    let targets;
    if (isDebuff && side === "player") targets = [this.state.enemy];
    else if (isDebuff && side === "enemy") {
      targets = String(targetType).includes("ALL")
        ? this.state.team.filter((unit) => unit.hp > 0)
        : [this.pickPartyTarget(targetType)];
    } else targets = this.friendlyTargets(actor, side, targetType || cs.own_type);
    for (const target of targets) {
      if (!target) continue;
      const existing = target.statuses.find((status) => status.csId === csId);
      if (existing) existing.stacks += stacks;
      else target.statuses.push({ csId, stacks, name: cs.link_tooltip_id || csId });
    }
    this.log(`Applied ${this.display(cs.link_tooltip_id, csId)} (${stacks}).`, "status");
    for (const effectId of asList(cs.link_skill_eff_id)) {
      const child = this.maps.effects.get(effectId);
      if (child?.operation === "OPERATION_ACTIVE") this.resolveEffect(effectId, actor, side, context, depth);
    }
  }

  triggerStatus(effect, actor, side, context, depth) {
    for (const csId of asList(effect.link_cs_id)) {
      const candidates = [...this.state.team, this.state.enemy].flatMap((target) =>
        (target.statuses || []).filter((status) => status.csId === csId).map(() => target));
      const cs = this.maps.cs.get(csId);
      if (!cs || !candidates.length) continue;
      for (const effectId of asList(cs.link_skill_eff_id)) this.resolveEffect(effectId, candidates[0], side, context, depth);
      this.log(`Triggered ${this.display(cs.link_tooltip_id, csId)}.`, "status");
    }
  }

  changeCardTalent(effect, context) {
    const instance = context.instance;
    if (!instance) { this.warn(`Card talent effect ${effect.id} has no resolvable card target.`); return; }
    instance.addedTalents ||= [];
    instance.removedTalents ||= [];
    const talents = asList(effect.eff_opt);
    if (effect.eff === "SKILL_EFF_CARD_TALENT_REMOVE") instance.removedTalents.push(...talents);
    else if (effect.eff === "SKILL_EFF_CARD_TALENT_REPLACE") {
      instance.removedTalents.push(...asList(context.card.talent));
      instance.addedTalents.push(...talents);
    } else instance.addedTalents.push(...talents);
    this.log(`Card talent changed: ${talents.join(", ") || effect.id}.`, "card");
  }

  changeCardCost(effect, context) {
    if (!context.instance) { this.warn(`Card cost effect ${effect.id} has no resolvable card target.`); return; }
    const value = asNumber(effect.eff_value);
    context.instance.costDelta = effect.eff_value_math_sign === "MATHSIGN_MULTIPLY"
      ? asNumber(context.instance.costDelta) * value
      : asNumber(context.instance.costDelta) + value;
    this.log(`Card cost changed by ${value}.`, "card");
  }

  changeCard(effect, context) {
    const replacement = [...asList(effect.eff_opt), ...asList(effect.eff_opt_multiple_link)]
      .find((cardId) => this.maps.cards.has(cardId));
    if (!context.instance || !replacement) { this.warn(`Card transform ${effect.id} could not resolve its target.`); return; }
    context.instance.cardId = replacement;
    context.card = this.maps.cards.get(replacement);
    this.log(`Card transformed into ${this.display(context.card.name, replacement)}.`, "card");
  }

  copyCard(effect, context) {
    if (!context.instance) { this.warn(`Card copy ${effect.id} has no resolvable card target.`); return; }
    const copy = { ...context.instance, uid: `card-${++this.uid}`, addedTalents: [...asList(context.instance.addedTalents)], removedTalents: [...asList(context.instance.removedTalents)] };
    const place = String(effect.eff_card_place || "");
    if (place.includes("DECK")) this.state.drawPile.push(copy);
    else if (place.includes("DISCARD")) this.state.discardPile.push(copy);
    else this.enterHand(copy);
    this.log(`Copied ${this.display(context.card.name, context.card.id)} to ${place || "hand"}.`, "card");
  }

  useOptionCard(effect, actor, side, context, depth) {
    const options = asList(effect.eff_opt_multiple_link).filter((cardId) => this.maps.cards.has(cardId));
    if (!options.length) { this.warn(`Card option effect ${effect.id} has no decoded choices.`); return; }
    const selected = effect.eff === "SKILL_EFF_CARD_RAN_SELECT_USE" ? this.random.pick(options) : options[0];
    if (effect.eff === "SKILL_EFF_CARD_OPTION_SELECT") this.warn(`Choice effect ${effect.id} currently selects its first extracted option.`);
    const card = this.maps.cards.get(selected);
    this.log(`Used option ${this.display(card.name, card.id)}.`, "card");
    const nested = { ...context, card, visited: new Set(context.visited) };
    for (const effectId of asList(card.link_skill_eff_id)) this.resolveEffect(effectId, actor, side, nested, depth);
  }

  useAdditionalCard(effect, actor, side, context, depth) {
    if (effect.operation === "OPERATION_TRIGGER") {
      this.warn(`Deferred trigger ${effect.id} requires event timing that is not decoded.`);
      return;
    }
    const options = [...asList(effect.eff_opt_multiple_link), ...asList(effect.eff_opt)].filter((cardId) => this.maps.cards.has(cardId));
    const card = options.length ? this.maps.cards.get(options[0]) : context.card;
    if (!card || depth > 8) return;
    const nested = { ...context, card, visited: new Set(context.visited) };
    this.log(`Additional use: ${this.display(card.name, card.id)}.`, "card");
    for (const effectId of asList(card.link_skill_eff_id)) this.resolveEffect(effectId, actor, side, nested, depth);
  }

  moveCurrentCard(effect, context) {
    if (!context.instance) return;
    const place = effect.eff === "SKILL_EFF_CARD_EXHAUST" ? "EXHAUST" : String(effect.eff_card_place || "");
    if (place.includes("EXHAUST")) context.destination = "exhaust";
    else if (place.includes("HAND")) context.destination = "hand";
    else if (place.includes("DECK")) context.destination = "deck";
    else if (place.includes("DISCARD")) context.destination = "discard";
  }

  pickPartyTarget(targetType) {
    const living = this.state.team.filter((unit) => unit.hp > 0);
    if (!living.length) return null;
    return this.random.pick(living);
  }

  tickStatuses() {
    // Term resolution is table-driven but several term branches live in the
    // compiled runtime. Battle-duration statuses remain active; turn-limited
    // statuses can be added here as their semantics are validated.
  }

  checkEnd() {
    if (this.state.enemy.hp <= 0) {
      this.state.over = true; this.state.result = "victory"; this.state.phase = "complete";
      this.log("Enemy defeated.", "victory");
    } else if (!this.state.team.some((unit) => unit.hp > 0)) {
      this.state.over = true; this.state.result = "defeat"; this.state.phase = "complete";
      this.log("The team was defeated.", "defeat");
    }
  }
}

// The original prototype above is retained temporarily as a collection of
// table-driven effect handlers. The exported engine below replaces its
// disproven battle ownership, phase, opening-hand, stress, and Light/Dark
// behavior with the client-runtime rules documented in
// docs/recovered-combat-runtime.md.
export class BattleEngine extends LegacyBattleEngine {
  constant(id, fallback) { return asNumber(this.data.constants?.[id], fallback); }

  createState() {
    const team = (this.config.units || []).map((unit) => computeUnitPreview(this.data, unit)).filter(Boolean)
      .map((unit) => {
        const battleUnit = { ...unit, hpContribution: unit.maxHp, stress: 0, maxStress: this.constant("default_stress_max", 50), collapsed: false, collapseCount: 0, linkCrash: false };
        delete battleUnit.hp;
        delete battleUnit.maxHp;
        return battleUnit;
      });
    const enemyDefinition = this.maps.enemies.get(this.config.enemy.id) || {};
    const enemyHp = Math.max(1, asNumber(this.config.enemy.hp, 10000));
    const maxHp = Math.max(1, Math.round(team.reduce((sum, unit) => sum + unit.hpContribution, 0)));
    const average = (key) => team.length ? team.reduce((sum, unit) => sum + asNumber(unit[key]), 0) / team.length : 0;
    const state = {
      turn: 1, turnWaveReset: 0, phase: "setup",
      ap: asNumber(this.config.ap, this.constant("battle_base_energy", 3)),
      maxAp: asNumber(this.config.ap, this.constant("battle_base_energy", 3)),
      drawCount: asNumber(this.config.drawCount, this.constant("battle_base_draw_count", 5)),
      handMax: asNumber(this.config.handMax, this.constant("battle_base_hand_max_count", 10)),
      team,
      player: { id: "player-team", name: "Team", hp: maxHp, maxHp, atk: average("atk"), def: average("def"), shield: 0, statuses: [], fatal: false },
      enemy: {
        ...enemyDefinition, name: this.config.enemy.name || enemyDefinition.name,
        hp: enemyHp, maxHp: enemyHp, atk: Math.max(1, asNumber(this.config.enemy.atk, 200)),
        def: Math.max(0, asNumber(this.config.enemy.def, 100)), shield: 0, statuses: [],
      },
      hand: [], drawPile: [], discardPile: [], exhaustPile: [], over: false, result: null, linkCrashTurn: null,
    };
    state.drawPile = (this.config.deck || []).map((entry) => this.instantiateCard(entry));
    this.shuffle(state.drawPile);
    this.state = state;
    this.placeInitialHand(this.config.initialHand || []);
    for (const unit of team) for (const item of unit.approximations) this.approximations.add(item);
    if (state.enemy.startCard) this.resolveEnemyCard(state.enemy.startCard, true);
    this.log(`Battle started against ${this.display(state.enemy.name, state.enemy.id)}.`, "system");
    this.beginPlayerTurn();
    return state;
  }

  instantiateCard(entry) {
    return {
      ...entry, uid: entry.uid || `card-${++this.uid}`, cardId: entry.cardId,
      baseCardId: entry.baseCardId || entry.cardId, ownerIndex: entry.ownerIndex,
      epiphanyId: entry.epiphanyId || entry.uniqueId || "",
      addedTalents: [...asList(entry.addedTalents)], removedTalents: [...asList(entry.removedTalents)],
      addedEffectIds: [...asList(entry.addedEffectIds)],
    };
  }

  placeInitialHand(initialHand) {
    for (const requested of initialHand) {
      const key = typeof requested === "string" ? requested : requested.uid || requested.cardId;
      const index = this.state.drawPile.findIndex((card) => card.uid === key || card.cardId === key);
      const instance = index >= 0 ? this.state.drawPile.splice(index, 1)[0] : (typeof requested === "object" ? this.instantiateCard(requested) : null);
      if (instance) this.enterHand(instance);
    }
  }

  beginPlayerTurn() {
    const state = this.state;
    state.phase = "turn_begin";
    state.player.shield = 0;
    state.ap = state.maxAp;
    this.expireTurnStatuses();
    this.eventStacks.clear();
    state.phase = "add_energy";
    state.phase = "draw_before";
    this.checkOpening();
    state.phase = "draw";
    this.turnDraw();
    state.phase = "draw_after";
    this.checkLightDarkTurnStart();
    this.settleLightDark();
    state.phase = "main_phase";
    this.log(`Player turn ${state.turn} entered Main Phase with ${state.ap} AP.`);
  }

  checkOpening() {
    if (this.state.turn !== 1) return;
    const opening = [...this.state.hand, ...this.state.drawPile]
      .filter((instance) => asList(this.getCard(instance)?.talent).includes("TALENT_OPENING"));
    if (opening.length) this.warn("Opening talents exist, but the external automatic target/queue coordinator is unresolved; they were not auto-played.");
  }

  turnDraw() {
    const count = Math.min(Math.max(0, this.state.handMax - this.state.hand.length), Math.max(0, this.state.drawCount));
    for (let index = 0; index < count; index += 1) if (!this.drawOne("turn")) break;
  }

  drawOne(source = "card") {
    const state = this.state;
    if (state.hand.length >= state.handMax) return null;
    if (!state.drawPile.length && state.discardPile.length) {
      state.drawPile = state.discardPile.splice(0);
      this.shuffle(state.drawPile);
      this.log("Discard pile reshuffled into the draw pile.");
    }
    const instance = state.drawPile.pop();
    if (!instance) return null;
    this.enterHand(instance);
    this.emitEvent({
      conditionCard: source === "turn" ? "CONDITION_CARD_DRAW" : "CONDITION_CARD_DRAW_EXCEPT_TURN_DRAW",
      ownerIndex: instance.ownerIndex, source, card: this.getCard(instance), instance, amount: 1,
    });
    return instance;
  }

  bindMaximum(card) {
    const talent = asList(card?.talent).find((entry) => String(entry).startsWith("TALENT_BIND"));
    return talent ? Math.max(1, asNumber(String(talent).match(/_(\d+)$/)?.[1], 999)) : 0;
  }

  enterHand(instance, position = "right") {
    const card = this.getCard(instance);
    const talents = asList(card?.talent);
    const maximum = this.bindMaximum(card);
    if (maximum) {
      const existing = this.state.hand.find((item) => item.cardId === instance.cardId && item.ownerIndex === instance.ownerIndex);
      if (existing) {
        existing.bindStacks = Math.min(maximum, asNumber(existing.bindStacks, 1) + asNumber(instance.bindStacks, 1));
        this.log(`${this.display(card.name, card.id)} stacked to ${existing.bindStacks}.`, "card", { cardId: card.id });
        return [existing];
      }
      instance.bindStacks = Math.max(1, asNumber(instance.bindStacks, 1));
    }
    if (talents.includes("TALENT_LIGHT")) position = "left";
    else if (talents.includes("TALENT_DARK")) position = "right";
    if (position === "left") this.state.hand.unshift(instance); else this.state.hand.push(instance);
    return [instance];
  }

  checkLightDarkTurnStart() {
    const pulled = [];
    const eligible = (instance) => asList(this.getCard(instance)?.talent)
      .some((talent) => ["TALENT_LIGHT_DARK", "TALENT_LIGHT", "TALENT_DARK"].includes(talent));
    for (const pile of [this.state.drawPile, this.state.discardPile]) {
      for (let index = pile.length - 1; index >= 0; index -= 1) if (eligible(pile[index])) pulled.push(pile.splice(index, 1)[0]);
    }
    for (const instance of pulled) this.enterHand(instance);
    if (pulled.length) this.log(`Moved ${pulled.length} Light/Dark card${pulled.length === 1 ? "" : "s"} to hand during Draw After.`, "card");
  }

  settleLightDark() {
    for (const instance of [...this.state.hand]) {
      if (asList(this.getCard(instance)?.talent).includes("TALENT_LIGHT_DARK") && instance.lastPolarizedTurn !== this.state.turn) this.polarizeRossweisse(instance);
    }
    let combined;
    do { combined = this.coalesceRossweisse(); } while (combined);
    this.orderRossweisseShards();
  }

  polarizeRossweisse(instance) {
    const card = this.getCard(instance);
    const children = asList(card?.child_link_card_id);
    const lightId = children.find((id) => /_mut1$/.test(id));
    const darkId = children.find((id) => /_mut2$/.test(id));
    if (!lightId || !darkId || !this.maps.cards.has(lightId) || !this.maps.cards.has(darkId)) {
      this.warn(`${card?.id || instance.cardId} has LIGHT_DARK but its shard resources are missing.`);
      return [];
    }
    const index = this.state.hand.indexOf(instance);
    if (index >= 0) this.state.hand.splice(index, 1);
    const origin = { cardId: instance.cardId, baseCardId: instance.baseCardId, epiphanyId: instance.epiphanyId, addedTalents: [...asList(instance.addedTalents)], removedTalents: [...asList(instance.removedTalents)], addedEffectIds: [...asList(instance.addedEffectIds)] };
    instance.lightDarkOrigin = origin;
    instance.cardId = lightId;
    instance.shard = "light";
    instance.lastPolarizedTurn = this.state.turn;
    const dark = { ...instance, uid: `card-${++this.uid}`, cardId: darkId, shard: "dark", lightDarkOrigin: { ...origin }, generated: true };
    this.state.hand.unshift(instance);
    this.state.hand.push(dark);
    this.log(`${this.display(card.name, card.id)} divided into Shard: Light and Shard: Dark.`, "card", { cardId: card.id });
    return [instance, dark];
  }

  orderRossweisseShards() {
    const light = [], middle = [], dark = [];
    for (const instance of this.state.hand) {
      const talents = asList(this.getCard(instance)?.talent);
      if (talents.includes("TALENT_LIGHT")) light.push(instance);
      else if (talents.includes("TALENT_DARK")) dark.push(instance);
      else middle.push(instance);
    }
    this.state.hand = [...light, ...middle, ...dark];
  }

  shardBase(cardId) { return String(cardId || "").replace(/_mut[12]$/, ""); }

  coalesceRossweisse() {
    if (this.state.hand.length < 2) return null;
    const rows = this.state.hand.map((instance) => ({ instance, card: this.getCard(instance) }));
    if (!rows.every(({ card }) => {
      const talents = asList(card?.talent);
      return talents.includes("TALENT_LIGHT") || talents.includes("TALENT_DARK") || this.bindMaximum(card) > 0;
    })) return null;
    const lights = rows.filter(({ card }) => asList(card?.talent).includes("TALENT_LIGHT"));
    const darks = rows.filter(({ card }) => asList(card?.talent).includes("TALENT_DARK"));
    const light = lights.find(({ instance }) => darks.some(({ instance: other }) => this.shardBase(other.cardId) === this.shardBase(instance.cardId)));
    if (!light) return null;
    const dark = darks.find(({ instance }) => this.shardBase(instance.cardId) === this.shardBase(light.instance.cardId));
    const materials = rows.filter(({ card }) => this.bindMaximum(card) > 0).map(({ instance }) => instance);
    const tasselStacks = materials.filter((instance) => instance.cardId === "c_30134_cre1").reduce((sum, instance) => sum + asNumber(instance.bindStacks, 1), 0);
    const parent = light.instance;
    const origin = parent.lightDarkOrigin || {};
    parent.cardId = origin.cardId || this.shardBase(parent.cardId);
    parent.baseCardId = origin.baseCardId || parent.baseCardId;
    parent.epiphanyId = origin.epiphanyId || parent.epiphanyId;
    parent.addedTalents = [...asList(origin.addedTalents)];
    parent.removedTalents = [...asList(origin.removedTalents)];
    parent.addedEffectIds = [...asList(origin.addedEffectIds)];
    delete parent.shard;
    delete parent.lightDarkOrigin;
    this.state.hand = this.state.hand.filter((instance) => instance !== dark.instance && !materials.includes(instance));
    if (!this.state.hand.includes(parent)) this.state.hand.push(parent);
    this.emitEvent({ conditionCard: "CONDITION_CARD_COMBINE", ownerIndex: parent.ownerIndex, card: this.getCard(parent), instance: parent, materials, amount: 1 }, materials);
    this.log(`Light and Dark combined into ${this.display(this.getCard(parent)?.name, parent.cardId)}; ${tasselStacks} Sword Tassel stack${tasselStacks === 1 ? "" : "s"} applied cs_30134_18.`, "card", { cardId: parent.cardId });
    return parent;
  }

  allTriggerCards(extra = []) {
    const seen = new Set();
    return [...this.state.hand, ...extra].filter((instance) => instance && !seen.has(instance.uid) && seen.add(instance.uid));
  }

  emitEvent(event, extraCards = []) {
    for (const instance of this.allTriggerCards(extraCards)) {
      const card = this.getCard(instance);
      for (const effectId of asList(card?.link_skill_eff_id)) {
        const effect = this.maps.effects.get(effectId);
        if (effect?.operation !== "OPERATION_TRIGGER" || !asList(effect.eff_link_condition_id).length) continue;
        if (this.advanceEventStack(instance, effect, event)) this.resolveTriggeredEffect(instance, card, effect);
      }
    }
  }

  stackControls(conditionId) {
    return (this.data.conditionControls || []).filter((row) => String(row.id).startsWith(`${conditionId}_`) && row.type === "stack");
  }

  advanceEventStack(instance, effect, event) {
    const conditionId = asList(effect.eff_link_condition_id)[0];
    const condition = this.maps.conditionObjects.get(conditionId);
    const controls = this.stackControls(conditionId);
    if (!condition || !controls.length) return false;
    const key = `${instance.uid}:${effect.id}:${this.state.turn}`;
    const stack = this.eventStacks.get(key) || { allowance: asNumber(condition.stack_value, -1), counters: new Map() };
    const checks = controls.flatMap((control) => [
      ...asList(control.link_cond_card_id).map((id) => ({ kind: "card", id, row: this.maps.conditionCards.get(id) })),
      ...asList(control.link_cond_unit_id).map((id) => ({ kind: "unit", id, row: this.maps.conditionUnits.get(id) })),
    ]).filter((check) => check.row);
    for (const check of checks) if (this.conditionMatches(check, instance, event)) stack.counters.set(check.id, (stack.counters.get(check.id) || 0) + 1);
    const met = (check) => (stack.counters.get(check.id) || 0) >= asNumber(check.row[check.kind === "card" ? "condition_card_count" : "condition_unit_count"], 1);
    const ready = checks.length > 0 && (controls[0]?.and_or === "OR" ? checks.some(met) : checks.every(met));
    if (!ready || (condition.stack_type === "STACK_DEDUCTION_PER_STACK_NON_RESET" && stack.allowance === 0)) {
      this.eventStacks.set(key, stack);
      return false;
    }
    stack.counters.clear();
    if (condition.stack_type === "STACK_DEDUCTION_PER_STACK_NON_RESET" && stack.allowance > 0) stack.allowance -= 1;
    this.eventStacks.set(key, stack);
    return true;
  }

  conditionMatches(check, ownerCard, event) {
    const row = check.row;
    if (check.kind === "card") {
      if (row.condition_card !== event.conditionCard) return false;
      const opts = asList(row.condition_card_opt);
      if (opts.includes("own_char") && event.ownerIndex !== ownerCard.ownerIndex) return false;
      if (opts.includes("own_other_char") && event.ownerIndex === ownerCard.ownerIndex) return false;
      if (opts.includes("by_char_eff") && !["card", "egoskill"].includes(event.source)) return false;
      if (opts.includes("card_with_this_cs") && !asList(event.materials).includes(ownerCard)) return false;
      const cost = asNumber(event.cost, asNumber(event.card?.cost, -1));
      if (cost < asNumber(row.condition_card_min_cost, -1) || cost > asNumber(row.condition_card_max_cost, 999)) return false;
      const requiredTalents = asList(row.condition_card_talent).filter((talent) => talent !== "TALENT_BIND");
      if (requiredTalents.length && !requiredTalents.every((talent) => asList(event.card?.talent).includes(talent))) return false;
      const linked = asList(row.condition_card_opt_link_card_id);
      if (linked.length && !linked.includes(event.card?.id) && !linked.includes(this.shardBase(event.card?.id))) return false;
      return true;
    }
    if (row.condition_unit !== event.conditionUnit) return false;
    const opts = asList(row.condition_unit_opt);
    if (opts.includes("card_or_egoskill") && !["card", "egoskill"].includes(event.source)) return false;
    if (opts.includes("except_turn_start") && event.source === "turn_start") return false;
    return asNumber(event.amount, 1) >= asNumber(row.condition_unit_value, 1);
  }

  makeContext(card, instance = null) {
    return {
      damageRate: asNumber(instance?.effectDamageRate), multiplier: 1, skillPowerAdd: 0, crit: 0, critDamage: 0,
      cureRate: 0, shieldRate: 0, visited: new Set(), card, instance, destination: null,
    };
  }

  resolveTriggeredEffect(instance, card, effect) {
    const actor = this.state.team[instance.ownerIndex];
    if (!actor) return;
    if (effect.eff === "SKILL_EFF_TRIGGER_PYEONRIN") {
      const context = this.makeContext(card, instance);
      for (const effectId of asList(card.link_skill_eff_id)) {
        const marked = this.maps.effects.get(effectId);
        if (marked?.operation === "OPERATION_ACTIVE" && asList(marked.eff_opt).includes("trigger_pyeonrin")) this.resolveEffect(effectId, actor, "player", context, 0, true);
      }
      this.log(`${this.display(card.name, card.id)} triggered through ${asList(effect.eff_link_condition_id)[0]}.`, "card", { cardId: card.id });
      return;
    }
    this.resolveEffect(effect.id, actor, "player", this.makeContext(card, instance), 0, true);
  }

  playerCard(cardUid) {
    const state = this.state;
    if (state.over || state.phase !== "main_phase") return { ok: false, error: "It is not Main Phase." };
    const index = state.hand.findIndex((card) => card.uid === cardUid);
    if (index < 0) return { ok: false, error: "Card is no longer in hand." };
    const instance = state.hand[index];
    const card = this.getCard(instance);
    const owner = state.team[instance.ownerIndex];
    if (!card || !owner) return { ok: false, error: "This card has no active owner." };
    if (asList(card.talent).includes("TALENT_UNPLAYABLE")) return { ok: false, error: "This card cannot be played directly." };
    const printedCost = asNumber(card.cost);
    const cost = printedCost < 0 ? state.ap : Math.max(0, printedCost);
    if (cost > state.ap) return { ok: false, error: `Not enough AP: ${cost} required.` };
    state.ap -= cost;
    state.hand.splice(index, 1);
    this.log(`${owner.name || owner.id} played ${this.display(card.name, card.id)} (${cost} AP).`, "card", { cardId: card.id });
    const context = this.resolveCardEffects(card, owner, "player", instance);
    this.emitEvent({ conditionCard: "CONDITION_CARD_USE", ownerIndex: instance.ownerIndex, card, instance, cost, source: "card", amount: 1 });
    const resolvedTalents = asList(this.getCard(instance)?.talent || card.talent);
    if (context.destination === "exhaust" || resolvedTalents.includes("TALENT_EXHAUST")) state.exhaustPile.push(instance);
    else if (context.destination === "hand") state.hand.push(instance);
    else if (context.destination === "deck") state.drawPile.unshift(instance);
    else if (resolvedTalents.includes("TALENT_RECALL")) {
      instance.removedTalents = [...new Set([...asList(instance.removedTalents), "TALENT_RECALL"])];
      this.enterHand(instance);
    } else state.discardPile.push(instance);
    this.settleLightDark();
    this.checkEnd();
    return { ok: true };
  }

  resolveCardEffects(card, actor, side, instance = null) {
    const context = this.makeContext(card, instance);
    for (const effectId of asList(card.link_skill_eff_id)) {
      const effect = this.maps.effects.get(effectId);
      if (effect?.operation === "OPERATION_TRIGGER") continue;
      this.resolveEffect(effectId, actor, side, context, 0);
    }
    return context;
  }

  resolveEffect(effectId, actor, side, context, depth, ignoreTriggerCondition = false) {
    if (depth > 10 || context.visited.has(effectId)) return;
    context.visited.add(effectId);
    const effect = this.maps.effects.get(effectId);
    if (!effect) { this.warn(`Missing skill effect ${effectId}`); return; }
    if (asNumber(effect.run_pct, 100) < 100 && this.random.next() * 100 >= asNumber(effect.run_pct, 100)) return;
    const conditions = asList(effect.eff_link_condition_id);
    if (conditions.length && !ignoreTriggerCondition && !effect.eff?.includes("IGNORE_COND")) {
      if (effect.operation !== "OPERATION_TRIGGER") this.warn(`Unsupported inline condition ${conditions.join(", ")} on ${context.card.id}; effect was not executed.`);
      return;
    }
    const type = effect.eff;
    if (type === "SKILL_EFF_DAMAGE_VALUE_ADD") applyDamageModifier(context, effect);
    else if (["SKILL_EFF_DMG", "SKILL_EFF_DMG_IGNORE_COND"].includes(type)) this.applyDamage(effect, actor, side, context);
    else if (["SKILL_EFF_CURE", "SKILL_EFF_HEAL"].includes(type)) this.applyHealing(effect, actor, side, context);
    else if (type === "SKILL_EFF_SHIELD") this.applyShield(effect, actor, side, context);
    else if (type === "SKILL_EFF_CRITICAL_PCT_VALUE_ADD") context.crit += asNumber(effect.eff_value);
    else if (type === "SKILL_EFF_CRITICAL_DAMAGE_VALUE_ADD") context.critDamage += asNumber(effect.eff_value);
    else if (type === "SKILL_EFF_CURE_VALUE_ADD") context.cureRate += asNumber(effect.eff_value);
    else if (type === "SKILL_EFF_SHIELD_VALUE_ADD") context.shieldRate += asNumber(effect.eff_value);
    else if (type === "SKILL_EFF_CARD_DRAW") {
      const count = Math.max(1, Math.round(asNumber(effect.eff_count_value, asNumber(effect.eff_value, 1))));
      for (let index = 0; index < count; index += 1) this.drawOne("card");
    } else if (["SKILL_EFF_CARD_GET", "SKILL_EFF_CARD_GET_USER"].includes(type)) this.cardGet(effect, actor, side, context);
    else if (type === "SKILL_EFF_CARD_DISCARD") this.cardDiscard(effect, context);
    else if (["SKILL_EFF_ENERGY_CHANGE", "SKILL_EFF_ENERGY_FORCE_CHANGE"].includes(type) && side === "player") {
      const delta = asNumber(effect.eff_value);
      this.state.ap = Math.max(0, this.state.ap + delta);
      if (delta > 0) this.emitEvent({ conditionUnit: "CONDITION_CHAR_EARN_ENERGY", amount: delta, source: "card", ownerIndex: this.state.team.indexOf(actor) });
    } else if (["SKILL_EFF_CS_SET_ADD", "SKILL_EFF_CS_SET_ADD_AUTO", "SKILL_EFF_CS_SET_ADD_IGNORE_COND", "SKILL_EFF_CS_SET_ADD_IGNORE_BLOCK"].includes(type)) {
      let stacks = asNumber(effect.eff_value, 1);
      if (effect.eff_value_type_1 === "VALUE_THIS_CARD_TALENT_BIND_STACK_MULTIPLY") stacks *= asNumber(context.instance?.bindStacks, 1);
      for (const csId of asList(effect.link_cs_id)) this.addStatus(csId, actor, side, stacks, context, depth + 1, effect.target_unit_type);
    } else if (type === "SKILL_EFF_TRIGGER_CS") this.triggerStatus(effect, actor, side, context, depth + 1);
    else if (["SKILL_EFF_CARD_TALENT_ADD", "SKILL_EFF_CARD_TALENT_REMOVE", "SKILL_EFF_CARD_TALENT_REPLACE"].includes(type)) this.changeCardTalent(effect, context);
    else if (type === "SKILL_EFF_CARD_COST_CHANGE") this.changeCardCost(effect, context);
    else if (type === "SKILL_EFF_CARD_CHANGE") this.changeCard(effect, context);
    else if (["SKILL_EFF_CARD_COPY_TO", "SKILL_EFF_CARD_COPY_TO_ORIGIN"].includes(type)) this.copyCard(effect, context);
    else if (["SKILL_EFF_CARD_RAN_SELECT_USE", "SKILL_EFF_CARD_OPTION_SELECT"].includes(type)) this.useOptionCard(effect, actor, side, context, depth + 1);
    else if (["SKILL_EFF_CARD_USE_ADDITIONAL", "SKILL_EFF_CARD_USE"].includes(type)) this.useAdditionalCard(effect, actor, side, context, depth + 1);
    else if (["SKILL_EFF_CARD_MOVE_TO", "SKILL_EFF_CARD_EXHAUST"].includes(type)) this.moveCurrentCard(effect, context);
    else if (!["SKILL_EFF_NONE", "SKILL_EFF_TRIGGER_PYEONRIN"].includes(type)) this.warn(`Unmodeled effect ${type} (${effectId}).`);
    this.resolveChildBranch(effect, 0, actor, side, context, depth);
    this.resolveChildBranch(effect, 1, actor, side, context, depth);
  }

  statusModifiers(actor, targetEffect = null) {
    const result = { damageRate: 0, multiplier: 1, skillPowerAdd: 0, crit: 0 };
    for (const status of actor?.statuses || []) {
      const cs = this.maps.cs.get(status.csId);
      for (const effectId of asList(cs?.link_skill_eff_id)) {
        const effect = this.maps.effects.get(effectId);
        if (!effect) continue;
        if (effect.eff === "SKILL_EFF_VALUE_CHANGE_PASSIVE" && targetEffect && asList(effect.eff_opt_multiple_link).includes(targetEffect.id)) {
          if (effect.eff_value_math_sign === "MATHSIGN_ADD") result.damageRate += asNumber(effect.eff_value) * asNumber(status.stacks, 1);
        } else if (!asList(effect.eff_link_condition_id).length) {
          if (effect.eff === "SKILL_EFF_DAMAGE_VALUE_ADD") applyDamageModifier(result, effect);
          if (effect.eff === "SKILL_EFF_CRITICAL_PCT_VALUE_ADD") result.crit += asNumber(effect.eff_value) * asNumber(status.stacks, 1);
        }
      }
    }
    return result;
  }

  applyDamage(effect, actor, side, context) {
    const target = side === "player" ? this.state.enemy : this.state.player;
    const attrs = asList(effect.eff_attr);
    const count = Math.max(1, Math.round(asNumber(effect.eff_count_value, 1)));
    const status = this.statusModifiers(actor, effect);
    const base = attrs.includes("DMG_ATTR_BASE_ON_DEF") ? actor.def : actor.atk;
    let amount = attrs.includes("DMG_ATTR_FIX") ? asNumber(effect.eff_value) : base * ((asNumber(effect.eff_value) + context.skillPowerAdd + status.skillPowerAdd) / 100);
    if (!attrs.includes("DMG_ATTR_IGNORE_DEF") && !attrs.includes("DMG_ATTR_NO_DMG_REDUCE")) amount *= 503 / (Math.max(0, target.def) + 503);
    amount *= 1 + ((actor.damageRate || 0) + context.damageRate + status.damageRate) / 100;
    amount *= (actor.damageMultiplier || 1) * context.multiplier * status.multiplier;
    if (side === "player") {
      amount *= asNumber(this.config.weakness, 1);
      const critChance = Math.max(0, Math.min(100, (actor.crit || 0) + status.crit + context.crit));
      if (this.random.next() * 100 < critChance) amount *= Math.max(1, (asNumber(actor.critDamage, 125) + context.critDamage) / 100);
    }
    const dealt = this.dealDamage(target, amount * count);
    this.log(`${actor.name || actor.id} dealt ${Math.round(dealt)} damage with ${this.display(context.card.name, context.card.id)}.`, "damage", { amount: dealt });
    if (side === "enemy" && dealt > 0) {
      const eligible = this.state.team.filter((unit) => !unit.leaved);
      const attributed = eligible.length ? this.random.pick(eligible) : null;
      this.emitEvent({ conditionUnit: "CONDITION_CHAR_HIT", amount: dealt, source: "monster", ownerIndex: this.state.team.indexOf(attributed), target: attributed });
      this.applyDamageStress(dealt, attributed);
      if (this.state.player.hp <= 0) this.applyHpLinkCrash();
    }
  }

  dealDamage(target, raw) {
    let amount = Math.max(0, raw);
    const absorbed = Math.min(target.shield || 0, amount);
    target.shield = Math.max(0, (target.shield || 0) - absorbed);
    amount -= absorbed;
    const dealt = Math.min(target.hp, amount);
    target.hp = Math.max(0, target.hp - dealt);
    return dealt;
  }

  applyHealing(effect, actor, side, context) {
    const target = side === "player" ? this.state.player : this.state.enemy;
    const amount = Math.max(0, actor.atk * asNumber(effect.eff_value) / 100 * (1 + context.cureRate / 100));
    const healed = Math.min(target.maxHp - target.hp, amount);
    target.hp += healed;
    this.log(`${target.name} recovered ${Math.round(healed)} shared HP.`, "heal", { amount: healed });
  }

  applyShield(effect, actor, side, context) {
    const target = side === "player" ? this.state.player : this.state.enemy;
    const base = asList(effect.eff_attr).includes("DMG_ATTR_BASE_ON_DEF") ? actor.def : actor.atk;
    const amount = Math.max(0, base * asNumber(effect.eff_value) / 100 * (1 + context.shieldRate / 100));
    target.shield += amount;
    this.log(`${target.name} gained ${Math.round(amount)} shared shield.`, "shield", { amount });
    if (side === "player") this.emitEvent({ conditionUnit: "CONDITION_CHAR_SHIELD", amount, source: "card", ownerIndex: this.state.team.indexOf(actor) });
  }

  friendlyTargets(actor, side, targetType) {
    if (side === "enemy") return [this.state.enemy];
    if (String(targetType).includes("ALL")) return this.state.team.filter((unit) => !unit.leaved);
    return [actor];
  }

  cardDiscard(effect, context = null) {
    const count = Math.max(1, Math.round(asNumber(effect.eff_count_value, asNumber(effect.eff_value, 1))));
    for (let index = 0; index < count && this.state.hand.length; index += 1) {
      const candidates = this.state.hand.filter((instance) => instance !== context?.instance);
      if (!candidates.length) break;
      const discarded = this.random.pick(candidates);
      this.state.hand.splice(this.state.hand.indexOf(discarded), 1);
      this.state.discardPile.push(discarded);
      this.emitEvent({ conditionCard: "CONDITION_CARD_DISCARD", ownerIndex: discarded.ownerIndex, card: this.getCard(discarded), instance: discarded, source: "card", amount: 1 });
    }
  }

  addStatusDirect(target, csId, stacks, appliedTurn = this.state.turn) {
    if (!target) return;
    target.statuses ||= [];
    const existing = target.statuses.find((status) => status.csId === csId);
    if (existing) { existing.stacks += stacks; existing.appliedTurn = appliedTurn; }
    else target.statuses.push({ csId, stacks, appliedTurn, name: this.maps.cs.get(csId)?.link_tooltip_id || csId });
  }

  addStatus(csId, actor, side, stacks, context, depth, targetType = "") {
    const cs = this.maps.cs.get(csId);
    if (!cs) { this.warn(`Missing CS ${csId}.`); return; }
    const debuff = String(cs.cs_buff_type || "").includes("DEBUFF");
    const targets = debuff ? [side === "player" ? this.state.enemy : this.state.player] : this.friendlyTargets(actor, side, targetType || cs.own_type);
    for (const target of targets) this.addStatusDirect(target, csId, stacks);
    this.log(`Applied ${this.display(cs.link_tooltip_id, csId)} (${stacks}).`, "status");
    for (const effectId of asList(cs.link_skill_eff_id)) {
      const child = this.maps.effects.get(effectId);
      if (child?.operation === "OPERATION_ACTIVE") this.resolveEffect(effectId, actor, side, context, depth);
    }
  }

  triggerStatus(effect, actor, side, context, depth) {
    for (const csId of asList(effect.link_cs_id)) {
      const candidates = [...this.state.team, this.state.player, this.state.enemy].filter((target) => (target.statuses || []).some((status) => status.csId === csId));
      const cs = this.maps.cs.get(csId);
      if (!cs || !candidates.length) continue;
      for (const effectId of asList(cs.link_skill_eff_id)) this.resolveEffect(effectId, candidates[0], side, context, depth);
    }
  }

  expireTurnStatuses() {
    for (const target of [...this.state.team, this.state.player, this.state.enemy]) {
      target.statuses = (target.statuses || []).filter((status) => {
        const cs = this.maps.cs.get(status.csId);
        return cs?.term_type_1 !== "TERM_TURN_VALUE_WHOLE" || status.appliedTurn >= this.state.turn;
      });
    }
  }

  endTurn() {
    const state = this.state;
    if (state.over || state.phase !== "main_phase") return;
    state.phase = "turnover";
    this.settleLightDark();
    for (const instance of state.hand.splice(0)) {
      const talents = asList(this.getCard(instance)?.talent);
      if (talents.includes("TALENT_RETAIN")) state.hand.push(instance);
      else if (talents.includes("TALENT_ETHEREAL")) state.exhaustPile.push(instance);
      else state.discardPile.push(instance);
    }
    state.phase = "monster_sequence";
    this.enemyTurn();
    if (state.over) return;
    state.phase = "player_sequence_start";
    state.turn += 1;
    this.applyTurnStartStress();
    this.beginPlayerTurn();
  }

  enemyTurn() {
    const state = this.state;
    const linked = state.team.find((unit) => unit.linkCrash);
    if (linked && state.linkCrashTurn !== null && state.linkCrashTurn < state.turn) {
      state.player.fatal = true;
      this.log(`Fatal attack resolved against Link Crash combatant ${linked.name || linked.id}.`, "enemy");
      this.checkEnd();
      return;
    }
    const actions = (state.enemy.actions || []).filter((action) => asNumber(action.weight) > 0 && (!action.condition || action.condition === "none"));
    if (!actions.length) { this.warn(`Enemy ${state.enemy.id} has no unconditional weighted action in the extracted phase.`); return; }
    const total = actions.reduce((sum, action) => sum + asNumber(action.weight), 0);
    let roll = this.random.next() * total;
    let selected = actions[actions.length - 1];
    for (const action of actions) { roll -= asNumber(action.weight); if (roll <= 0) { selected = action; break; } }
    this.resolveEnemyCard(selected.cardId, false);
    this.checkEnd();
  }

  randomRange(range) {
    const values = asList(range).map((value) => asNumber(value));
    if (values.length < 2) return asNumber(values[0]);
    return values[0] + this.random.next() * (values[1] - values[0]);
  }

  applyStress(unit, amount, reason) {
    if (!unit || unit.leaved || amount === 0) return;
    const previous = unit.stress;
    const adjusted = amount > 0 ? Math.max(1, amount) : amount;
    unit.stress = Math.round(Math.max(0, Math.min(unit.maxStress, previous + adjusted)) * 100) / 100;
    if (!unit.collapsed && previous < unit.maxStress && unit.stress >= unit.maxStress) {
      unit.collapsed = true;
      unit.collapseCount += 1;
      this.log(`${unit.name || unit.id} collapsed at maximum stress.`, "stress");
    }
    this.log(`${unit.name || unit.id}: stress ${previous} → ${unit.stress} (${reason}).`, "stress", { amount: unit.stress - previous });
  }

  applyDamageStress(damage, attributed) {
    if (damage <= 0 || this.state.player.maxHp <= 0) return;
    const pct = damage / this.state.player.maxHp * 100;
    const rows = (this.data.stressBattle || []).filter((row) => row.type === "STRESS_TYPE_DAMAGE" && asNumber(row.value) <= pct)
      .sort((left, right) => asNumber(left.value) - asNumber(right.value));
    const row = rows.at(-1);
    if (!row) return;
    const eligible = this.state.team.filter((unit) => !unit.leaved && !unit.collapsed);
    const target = eligible.includes(attributed) ? attributed : (eligible.length ? this.random.pick(eligible) : null);
    const rank = String(this.state.enemy.rank || "RANK_A").replace("RANK_", "").toLowerCase();
    const range = row[`dmg_rank_${rank}_stress`] || row.dmg_rank_a_stress;
    this.applyStress(target, this.randomRange(range), `${row.id}, ${pct.toFixed(1)}% shared HP loss`);
  }

  applyTurnStartStress() {
    const relativeTurn = this.state.turn - this.state.turnWaveReset;
    const rows = [1, 2, 3].map((index) => this.maps.stressBattle.get(`turn_${relativeTurn}_${index}`) || this.maps.stressBattle.get(`turn_0_${index}`)).filter(Boolean);
    const candidates = this.state.team.filter((unit) => !unit.leaved && !unit.collapsed).sort((left, right) => right.stress - left.stress);
    if (!rows.length || !candidates.length) return;
    const ordered = [...candidates];
    if (asNumber(rows[0].member) === -1 && candidates.length > 1) {
      const topPct = this.constant("top_stressed_target_pct", 50);
      const selected = this.random.next() * 100 < topPct ? candidates[0] : this.random.pick(candidates.slice(1));
      ordered.splice(ordered.indexOf(selected), 1);
      ordered.unshift(selected);
    }
    rows.forEach((row, index) => this.applyStress(ordered[index], this.randomRange(row.turn_stress), row.id));
  }

  pickLinkCrashCombatant() {
    const candidates = this.state.team.filter((unit) => !unit.leaved);
    const randomIndexes = [1, 2, 3];
    this.shuffle(randomIndexes);
    return candidates.map((unit, index) => ({ unit, score: -(unit.stress || 0) * 100000 - asNumber(unit.collapseRemainCount) * 10 - (4 - (randomIndexes[index] || index + 1)) }))
      .sort((left, right) => left.score - right.score)[0]?.unit || null;
  }

  applyHpLinkCrash() {
    if (this.state.team.length <= 1 || this.state.team.some((unit) => unit.linkCrash)) return;
    const target = this.pickLinkCrashCombatant();
    if (!target) return;
    target.linkCrash = true;
    this.state.linkCrashTurn = this.state.turn;
    if (!target.collapsed) this.applyStress(target, target.maxStress - target.stress, "HP Link Crash");
    this.log(`${target.name || target.id} entered Link Crash after shared HP reached zero.`, "stress");
  }

  checkEnd() {
    if (this.state.enemy.hp <= 0) {
      this.state.over = true; this.state.result = "victory"; this.state.phase = "complete";
      this.log("Enemy defeated.", "victory");
    } else if (this.state.player.fatal || (this.state.player.hp <= 0 && this.state.team.length <= 1)) {
      this.state.over = true; this.state.result = "defeat"; this.state.phase = "complete";
      this.log("The team was defeated.", "defeat");
    }
  }
}
