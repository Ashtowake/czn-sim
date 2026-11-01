import { calculateCap, calculateFaintMemory, cardDisplayName, createCharacterBuild, epiphanyCompatibility, normalizeImportedBuild, resolveCardDescription, validateCharacterBuild } from "../model.js";
import { decodeGamePreset } from "../codec.js";

const output = document.querySelector("#result");
const assert = (condition, message) => { if (!condition) throw new Error(message); };

try {
  const data = await fetch("../data/snapshot.json").then((response) => response.json());
  const ross = data.combatants.find((row) => row.id === "30134");
  const build = createCharacterBuild(data, ross.id);
  assert(build.cards.length === 4, "Initial deck is not the four extracted starting cards");
  assert(calculateCap(15, true) === 180 && calculateCap(1, false) === 30, "Depth/Nightmare memory cap is wrong");
  assert(calculateFaintMemory(build, data).total === 0, "Initial deck consumes Faint Memory");
  const mika = data.combatants.find((row) => row.id === "1039");
  const mikaBuild = createCharacterBuild(data, mika.id);
  assert(mikaBuild.cards.length === 4 && mikaBuild.cards.every((card) => card.isStartingCard), "Run-added Mika uniques were incorrectly placed in the initial deck");
  const addedUnique = { ...mikaBuild.cards[0], instanceId: "mika-added-unique", cardId: mika.sparkCards[2], baseCardId: mika.sparkCards[2], isStartingCard: false, initialUnique: true, removed: true, memoryCost: 0 };
  mikaBuild.cards.push(addedUnique);
  assert(calculateFaintMemory(mikaBuild, data).removals === 0, "Removing a run-added unique consumed Faint Memory");
  assert(cardDisplayName(data.cards.find((card) => card.id === "c_1039_uni3_rsp5"), data) === "Whirlpool V", "Unique variant naming did not inherit the base name and Roman suffix");
  const whirlpool = resolveCardDescription(data.cards.find((card) => card.id === "c_1039_uni3"), data);
  const whirlpoolI = resolveCardDescription(data.cards.find((card) => card.id === "c_1039_uni3_rsp1"), data);
  const whirlpoolV = resolveCardDescription(data.cards.find((card) => card.id === "c_1039_uni3_rsp5"), data);
  assert(whirlpool.includes("200") && whirlpool.includes("50") && !whirlpool.includes("unresolved"), "Base Whirlpool tooltip values were not resolved");
  assert(whirlpoolI.includes("200") && whirlpoolI.includes("100") && !whirlpoolI.includes("none"), "Whirlpool I did not inherit the base template with variant values");
  assert(whirlpoolV.includes("200") && !whirlpoolV.includes("{cal}"), "Whirlpool V arithmetic tooltip value was not resolved");
  const sample = "v6l8cOjiNvfFzwd5bz8N5Gb2ZkVEaMFcD5GzNsHxt0GoRYG4L-qZQpfQ548wnl7K93xs-a7r1k1PWwKzFdL7HNlH9h89ICMdPPr4ZYZ0IUOaqK0WmQJlq4rtioGOP47821CGGJefDHNsnA";
  const imported = normalizeImportedBuild(data, decodeGamePreset(sample));
  const importedReport = validateCharacterBuild(imported, data, false);
  assert(importedReport.valid, `Supplied game build is rejected: ${importedReport.errors.join("; ")}`);
  assert(importedReport.memory.total === 140, `Supplied game build memory should be 140, received ${importedReport.memory.total}`);

  const removals = structuredClone(build);
  removals.cards.push({ ...structuredClone(build.cards[0]), instanceId: "extra-starter-1" }, { ...structuredClone(build.cards[1]), instanceId: "extra-starter-2" });
  removals.cards.slice(0, 6).forEach((card) => { card.removed = true; });
  assert(validateCharacterBuild(removals, data, false).errors.some((error) => error.includes("Too many removals")), "Six removals were accepted");

  const duplicates = structuredClone(build);
  for (let index = 0; index < 4; index += 1) {
    const copy = structuredClone(build.cards[0]);
    copy.instanceId = `duplicate-${index}`; copy.isStartingCard = false; copy.initialUnique = false; copy.duplicate = true;
    duplicates.cards.push(copy);
  }
  const duplicateReport = validateCharacterBuild(duplicates, data, false);
  assert(duplicateReport.errors.some((error) => error.includes("Too many duplicates")), "Fourth duplicate was accepted");
  const sandboxReport = validateCharacterBuild(duplicates, data, true);
  assert(sandboxReport.valid && sandboxReport.errors.length, "Sandbox did not preserve and override violations");

  const card = data.cards.find((row) => row.id === "c_30134_srt1");
  const common = data.randomEpiphanies.find((row) => row.rarity === "R_SPARK_RARITY_COMMON" && epiphanyCompatibility(row, card, ross).ok);
  const incompatible = data.randomEpiphanies.find((row) => !epiphanyCompatibility(row, card, ross).ok);
  assert(common && incompatible, "Compatibility filtering did not produce legal and rejected options");

  const geared = structuredClone(build);
  const piece = data.pieces.find((row) => row.type === "ITEM_PIECE_1");
  const sub = data.pieceOptions.find((row) => row.group === piece.subOptionGroup);
  geared.gear[0] = { slot: 1, pieceId: piece.id, main: null, substats: [
    { optionId: sub.id, quality: "min", reinforce: 0 },
    { optionId: sub.id, quality: "max", reinforce: 15 },
  ] };
  assert(validateCharacterBuild(geared, data, false).errors.some((error) => error.includes("repeats a stat")), "Duplicate gear substats were accepted");
  output.textContent = `PASS cap=180 cards=8 removals=5 duplicates=3 compatibility=true gear=true`;
} catch (error) {
  output.textContent = `FAIL ${error.stack || error.message}`;
}
