import { BattleEngine, computeUnitPreview } from "../engine.js";
import { materializeCard } from "../model.js";

const output = document.querySelector("#result");
const assert = (condition, message) => { if (!condition) throw new Error(message); };

try {
  const data = await fetch("../data/snapshot.json").then((response) => response.json());
  const effects = new Map(data.effects.map((row) => [row.id, row]));
  const cards = new Map(data.cards.map((row) => [row.id, row]));
  const enemyCards = new Map(data.enemyCards.map((row) => [row.id, row]));
  const units = data.combatants.slice(0, 3).map((combatant) => ({
    combatantId: combatant.id,
    level: combatant.maxLevel,
    partnerId: "",
    partnerLevel: 1,
    relics: {},
    gear: [],
    name: data.text[combatant.name] || combatant.id,
  }));
  const levelOne = computeUnitPreview(data, { ...units[0], level: 1 });
  const maxLevel = computeUnitPreview(data, units[0]);
  assert(maxLevel.atk > levelOne.atk, "Level selection did not affect ATK");
  const slotOnePiece = data.pieces.find((piece) => piece.type === "ITEM_PIECE_1");
  const mainOption = data.pieceOptions.find((option) => option.group === slotOnePiece.mainOptionGroup);
  const subOption = data.pieceOptions.find((option) => option.group === slotOnePiece.subOptionGroup && option.link_stat_list_id === "S_ATK_INC_RATE_OUT");
  const geared = computeUnitPreview(data, {
    ...units[0],
    gear: [{
      pieceId: slotOnePiece.id,
      main: { optionId: mainOption.id, quality: "max", reinforce: 4 },
      substats: [{ optionId: subOption.id, quality: "max", reinforce: 4 }],
    }],
  });
  assert(geared.atk > maxLevel.atk, "Selected gear main/substats did not affect ATK");

  const deck = [];
  units.forEach((unit, ownerIndex) => {
    const combatant = data.combatants.find((row) => row.id === unit.combatantId);
    combatant.startCards.forEach((cardId) => deck.push({ ownerIndex, baseCardId: cardId, cardId }));
  });
  const hasDamage = (card) => card?.link_skill_eff_id?.some((id) => ["SKILL_EFF_DMG", "SKILL_EFF_DMG_IGNORE_COND"].includes(effects.get(id)?.eff));
  assert(deck.some((entry) => hasDamage(cards.get(entry.cardId))), "Test deck has no direct damage card");

  const openingEngine = new BattleEngine(data, {
    units, deck,
    enemy: { id: data.enemies[0].id, name: data.text[data.enemies[0].name] || data.enemies[0].id, hp: 50000, atk: 1, def: 100 },
    weakness: 1, ap: 3, seed: 133,
  });
  assert(openingEngine.state.hand.length === Math.min(5, deck.length), "Default turn-one draw is not the recovered base draw of five");
  assert(openingEngine.state.handMax === 10, "Recovered base hand maximum is not ten");

  const enemy = data.enemies.find((row) => row.actions.some((action) => hasDamage(enemyCards.get(action.cardId)))) || data.enemies[0];
  const engine = new BattleEngine(data, {
    units,
    deck,
    enemy: { id: enemy.id, name: data.text[enemy.name] || enemy.id, hp: 50000, atk: 200, def: 100 },
    weakness: 1,
    ap: 12,
    drawCount: deck.length,
    handMax: deck.length,
    seed: 133,
  });
  const damageCard = engine.state.hand.find((instance) => hasDamage(cards.get(instance.cardId)));
  assert(damageCard, "No damage card was drawn");
  const hpBefore = engine.state.enemy.hp;
  const result = engine.playerCard(damageCard.uid);
  assert(result.ok, `Damage card could not be played: ${result.error}`);
  assert(engine.state.enemy.hp < hpBefore, "Playing a damage card did not reduce enemy HP");
  const mutable = { ...engine.state.discardPile[0], costDelta: -1, addedTalents: ["TALENT_RETAIN"] };
  const mutatedCard = engine.getCard(mutable);
  assert(mutatedCard.cost === Math.max(0, Number(cards.get(mutable.cardId).cost) - 1), "Runtime card cost mutation failed");
  assert(mutatedCard.talent.includes("TALENT_RETAIN"), "Runtime card talent mutation failed");

  const allTargetCard = data.enemyCards.find((card) => card.link_skill_eff_id.some((id) => {
    const effect = effects.get(id);
    return ["SKILL_EFF_DMG", "SKILL_EFF_DMG_IGNORE_COND"].includes(effect?.eff)
      && String(effect?.target_unit_type).includes("ALL")
      && !String(effect?.eff_link_condition_id || "").replace("none", "");
  }));
  assert(allTargetCard, "No all-party enemy damage card was found");
  const sharedHp = engine.state.player.hp;
  engine.resolveEnemyCard(allTargetCard.id, false);
  assert(engine.state.player.hp < sharedHp, "Enemy damage did not reduce the shared player HP pool");
  assert(engine.state.team.every((unit) => !("hp" in unit)), "Combatants still have independently damageable HP");
  assert(engine.state.team.some((unit) => unit.stress > 0), "Shared HP loss did not produce table-driven combatant stress");

  const crashEngine = new BattleEngine(data, {
    units: units.slice(0, 2), deck: [],
    enemy: { id: enemy.id, name: data.text[enemy.name] || enemy.id, hp: 50000, atk: 200, def: 100 },
    weakness: 1, ap: 3, drawCount: 0, handMax: 10, seed: 7331,
  });
  crashEngine.state.player.hp = 0.01;
  crashEngine.resolveEnemyCard(allTargetCard.id, false);
  const linked = crashEngine.state.team.filter((unit) => unit.linkCrash);
  assert(linked.length === 1 && linked[0].stress === linked[0].maxStress, `Shared zero HP did not select and max-stress one Link Crash combatant (hp=${crashEngine.state.player.hp}, linked=${linked.length}, stress=${linked[0]?.stress})`);
  assert(!crashEngine.state.over, "Link Crash incorrectly killed an individual combatant or immediately ended a multi-combatant battle");
  engine.endTurn();
  assert(engine.events.some((event) => event.type === "enemy"), "Enemy did not take an extracted pattern action");
  assert(engine.state.turn === 2 || engine.state.over, "Turn did not advance after enemy action");
  assert(data.cardEpiphanies.length > 0, "Epiphany variants are absent");

  const ross = data.combatants.find((row) => row.id === "30134");
  const other = data.combatants.find((row) => row.id !== "30134");
  const rossEngine = new BattleEngine(data, {
    units: [
      { combatantId: ross.id, level: ross.maxLevel, partnerId: "", partnerLevel: 1, relics: {}, gear: [] },
      { combatantId: other.id, level: other.maxLevel, partnerId: "", partnerLevel: 1, relics: {}, gear: [] },
    ],
    deck: [
      { ownerIndex: 0, cardId: "c_30134_srt4", baseCardId: "c_30134_srt4" },
      { ownerIndex: 0, cardId: ross.startCards[0], baseCardId: ross.startCards[0] },
    ],
    enemy: { id: enemy.id, name: data.text[enemy.name] || enemy.id, hp: 50000, atk: 1, def: 100 },
    weakness: 1, ap: 20, drawCount: 2, handMax: 10, seed: 133,
  });
  assert(rossEngine.state.hand.some((card) => card.cardId === "c_30134_srt4_mut1"), "Flicker Blade did not polarize into Light on draw");
  assert(rossEngine.state.hand.some((card) => card.cardId === "c_30134_srt4_mut2"), "Flicker Blade did not polarize into Dark on draw");
  const pushPlayable = (uid, cardId, ownerIndex) => rossEngine.state.hand.push({ uid, cardId, baseCardId: cardId, ownerIndex });
  const rossTrigger = rossEngine.state.hand.find((card) => card.cardId === ross.startCards[0]);
  pushPlayable("other-trigger-1", other.startCards[0], 1);
  pushPlayable("other-trigger-2", other.startCards[1] || other.startCards[0], 1);
  assert(rossEngine.playerCard(rossTrigger.uid).ok, "Could not play Rossweisse trigger card");
  assert(rossEngine.playerCard("other-trigger-1").ok, "Could not play first other-combatant card");
  assert(rossEngine.playerCard("other-trigger-2").ok, "Could not play second other-combatant card");
  assert(rossEngine.events.filter((event) => event.message.includes("triggered through cdc_02_30134")).length >= 2, "Light/Dark condition stacks did not trigger twice");
  const coalesced = rossEngine.state.hand.find((card) => card.cardId === "c_30134_srt4") || rossEngine.coalesceRossweisse();
  assert(coalesced?.cardId === "c_30134_srt4", "Light and Dark did not coalesce back into Flicker Blade");
  const tasselStatus = rossEngine.state.team[0].statuses.find((status) => status.csId === "cs_30134_18");
  assert(tasselStatus?.stacks >= 2, "Sword Tassel Bind stacks did not create the recovered cs_30134_18 turn status");
  const relicPreview = computeUnitPreview(data, { ...units[0], equipment: { armor: { relicId: "eq_arena_011", starLevel: 1 } }, relics: { armor: "eq_arena_011" } });
  assert(relicPreview.damageRate > maxLevel.damageRate, "Configured equipment effect did not alter combat stats");
  const compareConfig = (deckEntry) => ({
    units: [{ combatantId: ross.id, level: ross.maxLevel, partnerId: "", partnerLevel: 1, relics: {}, equipment: {}, gear: [] }],
    deck: [deckEntry], enemy: { id: enemy.id, name: data.text[enemy.name] || enemy.id, hp: 50000, atk: 1, def: 100 },
    weakness: 1, ap: 10, drawCount: 1, handMax: 10, seed: 991,
  });
  const plainEntry = { ownerIndex: 0, cardId: "c_30134_srt1", baseCardId: "c_30134_srt1" };
  const sparkEntry = materializeCard({ ...plainEntry, commonIds: ["add_r_spark_vitor_01"] }, 0, data);
  const plainEngine = new BattleEngine(data, compareConfig(plainEntry));
  const sparkEngine = new BattleEngine(data, compareConfig(sparkEntry));
  const plainHp = plainEngine.state.enemy.hp; plainEngine.playerCard(plainEngine.state.hand[0].uid);
  const sparkHp = sparkEngine.state.enemy.hp; sparkEngine.playerCard(sparkEngine.state.hand[0].uid);
  assert(sparkHp - sparkEngine.state.enemy.hp > plainHp - plainEngine.state.enemy.hp, "Configured epiphany did not affect actual card damage");
  output.textContent = `PASS damage=${Math.round(hpBefore - engine.state.enemy.hp)} rossStacks=${tasselStatus.stacks} events=${engine.events.length}`;
} catch (error) {
  output.textContent = `FAIL ${error.stack || error.message}`;
}
