import { decodeGamePreset, deserializeSimulatorSave, encodeGamePreset, serializeSimulatorSave } from "../codec.js";

const output = document.querySelector("#result");
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const sample = "v6l8cOjiNvfFzwd5bz8N5Gb2ZkVEaMFcD5GzNsHxt0GoRYG4L-qZQpfQ548wnl7K93xs-a7r1k1PWwKzFdL7HNlH9h89ICMdPPr4ZYZ0IUOaqK0WmQJlq4rtioGOP47821CGGJefDHNsnA";

try {
  const decoded = decodeGamePreset(sample);
  assert(decoded.charId === "30134", `Expected character 30134, received ${decoded.charId}`);
  assert(decoded.cards.length === 10, `Expected ten records, received ${decoded.cards.length}`);
  assert(decoded.cards.filter((card) => card.removed).length === 3, "Removed starters were not decoded");
  assert(decoded.cards.filter((card) => card.duplicate).length === 2, "Replication talents were not decoded");
  assert(decoded.cards.filter((card) => card.epiphanyId).length === 6, "Unique variants were not decoded");
  assert(decoded.cards.filter((card) => card.divineId).length === 4, "Divine epiphanies were not decoded");
  const roundTrip = decodeGamePreset(encodeGamePreset(decoded));
  assert(roundTrip.charId === decoded.charId && roundTrip.cards.length === decoded.cards.length, "Current game-code round trip failed");
  assert(roundTrip.cards.every((card, index) => card.cardId === decoded.cards[index].cardId && card.removed === decoded.cards[index].removed && card.duplicate === decoded.cards[index].duplicate), "Game-code card semantics changed during round trip");
  const legacyBinary = decodeGamePreset(encodeGamePreset(decoded, { version: 3 }));
  assert(legacyBinary.version === 3 && legacyBinary.cards.length === 10, "Legacy BP payload was not decoded");
  const legacyJson = btoa(JSON.stringify({ version: 1, characterId: 30134, deck: [{ cardId: "c_30134_srt4" }] })).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  assert(decodeGamePreset(legacyJson).format === "legacy", "Legacy JSON/base64 preset was not decoded");
  const state = { version: 1, sandbox: true, slots: [{ combatantId: "30134", cards: decoded.cards }], enemy: { id: "test" }, battle: { seed: 133 } };
  const restored = await deserializeSimulatorSave(serializeSimulatorSave(state));
  assert(JSON.stringify(restored) === JSON.stringify(state), "Simulator save round trip failed");
  let corruptRejected = false;
  try { decodeGamePreset(sample.slice(0, -4) + "xxxx"); } catch { corruptRejected = true; }
  assert(corruptRejected, "Corrupt game code was accepted");
  output.textContent = `PASS char=${decoded.charId} cards=${decoded.cards.length} removed=3 duplicate=2 divine=4`;
} catch (error) {
  output.textContent = `FAIL ${error.stack || error.message}`;
}
