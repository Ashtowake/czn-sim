const MAGIC = [0x42, 0x50];
const VERSION = 4;
const KEY_BYTES = new TextEncoder().encode("ssr.bp.codec.v2clip.copy");
const DICTIONARY = new TextEncoder().encode(
  "TALENT_REPLICATIONTALENT_CATEGORY_UNIQUECATEGORY_ENCOUNTERCATEGORY_PUBLICCATEGORY_NONE" +
  "rsp1_c_rsp2_c_rsp3_c_rsp4_c_rsp5_c_add_r_sparklbk_c_pot_c_assault_" +
  "card_c__srt1_srt2_srt3_srt4_uni1_uni2_uni3_uni4_rsp1_rsp2_rsp3_rsp4_rsp5_lbk_pot_eps_col_col2",
);

const FLAGS = {
  REMOVED: 1,
  R_SPARK: 2,
  ADD_TALENTS: 4,
  COST_CHANGED: 8,
  COST_SET: 16,
  COST_SUBTRACT: 32,
  GOD_R_SPARK: 64,
};

const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];

function reverseBits(value, length) {
  let result = 0;
  for (let index = 0; index < length; index += 1) {
    result = (result << 1) | (value & 1);
    value >>>= 1;
  }
  return result;
}

function buildHuffman(lengths) {
  const maxLength = Math.max(0, ...lengths);
  const counts = Array(maxLength + 1).fill(0);
  for (const length of lengths) if (length) counts[length] += 1;
  const next = Array(maxLength + 1).fill(0);
  let code = 0;
  for (let bits = 1; bits <= maxLength; bits += 1) {
    code = (code + (counts[bits - 1] || 0)) << 1;
    next[bits] = code;
  }
  const table = new Map();
  lengths.forEach((length, symbol) => {
    if (!length) return;
    const reversed = reverseBits(next[length]++, length);
    table.set(`${length}:${reversed}`, symbol);
  });
  return { table, maxLength };
}

class BitReader {
  constructor(bytes) { this.bytes = bytes; this.byte = 0; this.bit = 0; }
  bits(count) {
    let value = 0;
    for (let index = 0; index < count; index += 1) {
      if (this.byte >= this.bytes.length) throw new Error("Truncated DEFLATE stream.");
      value |= ((this.bytes[this.byte] >>> this.bit) & 1) << index;
      this.bit += 1;
      if (this.bit === 8) { this.bit = 0; this.byte += 1; }
    }
    return value;
  }
  align() { if (this.bit) { this.bit = 0; this.byte += 1; } }
  symbol(tree) {
    let code = 0;
    for (let length = 1; length <= tree.maxLength; length += 1) {
      code |= this.bits(1) << (length - 1);
      const symbol = tree.table.get(`${length}:${code}`);
      if (symbol !== undefined) return symbol;
    }
    throw new Error("Invalid Huffman code.");
  }
}

function fixedTrees() {
  const literals = Array(288).fill(0).map((_, symbol) => symbol <= 143 ? 8 : symbol <= 255 ? 9 : symbol <= 279 ? 7 : 8);
  return [buildHuffman(literals), buildHuffman(Array(32).fill(5))];
}

function dynamicTrees(reader) {
  const literalCount = reader.bits(5) + 257;
  const distanceCount = reader.bits(5) + 1;
  const codeCount = reader.bits(4) + 4;
  const order = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
  const codeLengths = Array(19).fill(0);
  for (let index = 0; index < codeCount; index += 1) codeLengths[order[index]] = reader.bits(3);
  const codeTree = buildHuffman(codeLengths);
  const lengths = [];
  while (lengths.length < literalCount + distanceCount) {
    const symbol = reader.symbol(codeTree);
    if (symbol <= 15) lengths.push(symbol);
    else if (symbol === 16) {
      if (!lengths.length) throw new Error("Invalid repeated code length.");
      const repeat = reader.bits(2) + 3;
      for (let index = 0; index < repeat; index += 1) lengths.push(lengths.at(-1));
    } else if (symbol === 17) {
      const repeat = reader.bits(3) + 3;
      for (let index = 0; index < repeat; index += 1) lengths.push(0);
    } else {
      const repeat = reader.bits(7) + 11;
      for (let index = 0; index < repeat; index += 1) lengths.push(0);
    }
  }
  return [buildHuffman(lengths.slice(0, literalCount)), buildHuffman(lengths.slice(literalCount, literalCount + distanceCount))];
}

function inflateRaw(bytes, dictionary = new Uint8Array()) {
  const reader = new BitReader(bytes);
  const output = [...dictionary];
  const dictionaryLength = output.length;
  let final = false;
  while (!final) {
    final = Boolean(reader.bits(1));
    const type = reader.bits(2);
    if (type === 0) {
      reader.align();
      const length = reader.bits(16);
      const inverse = reader.bits(16);
      if (((length ^ 0xffff) & 0xffff) !== inverse) throw new Error("Invalid stored DEFLATE block.");
      for (let index = 0; index < length; index += 1) output.push(reader.bits(8));
      continue;
    }
    if (type === 3) throw new Error("Reserved DEFLATE block type.");
    const [literalTree, distanceTree] = type === 1 ? fixedTrees() : dynamicTrees(reader);
    while (true) {
      const symbol = reader.symbol(literalTree);
      if (symbol < 256) { output.push(symbol); continue; }
      if (symbol === 256) break;
      const lengthIndex = symbol - 257;
      if (lengthIndex < 0 || lengthIndex >= LENGTH_BASE.length) throw new Error("Invalid DEFLATE length.");
      const length = LENGTH_BASE[lengthIndex] + reader.bits(LENGTH_EXTRA[lengthIndex]);
      const distanceSymbol = reader.symbol(distanceTree);
      if (distanceSymbol >= DIST_BASE.length) throw new Error("Invalid DEFLATE distance.");
      const distance = DIST_BASE[distanceSymbol] + reader.bits(DIST_EXTRA[distanceSymbol]);
      if (distance > output.length) throw new Error("DEFLATE distance exceeds preset dictionary and output.");
      for (let index = 0; index < length; index += 1) output.push(output[output.length - distance]);
    }
  }
  return Uint8Array.from(output.slice(dictionaryLength));
}

function deflateStored(bytes) {
  const result = [];
  for (let offset = 0; offset < bytes.length || offset === 0; offset += 65535) {
    const length = Math.min(65535, bytes.length - offset);
    const final = offset + length >= bytes.length;
    result.push(final ? 1 : 0, length & 255, length >>> 8, (~length) & 255, ((~length) >>> 8) & 255);
    for (let index = 0; index < length; index += 1) result.push(bytes[offset + index]);
    if (final) break;
  }
  return Uint8Array.from(result);
}

function fnv1a(bytes) {
  let hash = 0x811c9dc5;
  for (const byte of bytes) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  return hash;
}

function crypt(bytes) {
  const output = Uint8Array.from(bytes);
  let state = fnv1a(KEY_BYTES);
  for (let offset = 0; offset < output.length; offset += 4) {
    state ^= state << 13; state >>>= 0;
    state ^= state >>> 17; state >>>= 0;
    state ^= state << 5; state >>>= 0;
    for (let index = 0; index < 4 && offset + index < output.length; index += 1) {
      output[offset + index] ^= (state >>> (index * 8)) & 255;
    }
  }
  return output;
}

function base64UrlEncode(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function base64UrlDecode(value) {
  const normalized = String(value).trim().replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

class Writer {
  constructor() { this.bytes = []; }
  uint(value) {
    let current = Number(value) >>> 0;
    do { const byte = current & 0x7f; current >>>= 7; this.bytes.push(byte | (current ? 0x80 : 0)); } while (current);
  }
  string(value) { const bytes = new TextEncoder().encode(String(value)); this.uint(bytes.length); this.bytes.push(...bytes); }
}

class Reader {
  constructor(bytes) { this.bytes = bytes; this.offset = 0; }
  byte() { if (this.offset >= this.bytes.length) throw new Error("Preset data ended unexpectedly."); return this.bytes[this.offset++]; }
  uint() {
    let value = 0; let shift = 0;
    while (shift < 35) { const byte = this.byte(); value |= (byte & 0x7f) << shift; if (!(byte & 0x80)) return value >>> 0; shift += 7; }
    throw new Error("Invalid variable-length integer.");
  }
  string() { const length = this.uint(); if (this.offset + length > this.bytes.length) throw new Error("Invalid preset string length."); const value = new TextDecoder().decode(this.bytes.subarray(this.offset, this.offset + length)); this.offset += length; return value; }
}

function decodeCurrent(code) {
  const decrypted = crypt(base64UrlDecode(code));
  if (decrypted[0] !== MAGIC[0] || decrypted[1] !== MAGIC[1]) throw new Error("Not a CZN BP preset.");
  if (decrypted[2] > VERSION) throw new Error(`Unsupported game preset version ${decrypted[2]}.`);
  const body = inflateRaw(decrypted.subarray(3), DICTIONARY);
  const reader = new Reader(body);
  const charId = String(reader.uint());
  const count = reader.uint();
  if (count > 500) throw new Error("Preset contains an unreasonable number of cards.");
  const cards = [];
  for (let index = 0; index < count; index += 1) {
    const flags = reader.byte();
    const cardId = reader.string();
    const record = { cardId, removed: Boolean(flags & FLAGS.REMOVED), duplicate: false, epiphanyId: "", commonIds: [], divineId: "", variantCardId: "" };
    if (flags & FLAGS.R_SPARK) {
      const sparkCount = reader.uint();
      const sparks = Array.from({ length: sparkCount }, () => reader.string());
      record.epiphanyId = sparks.find((id) => /^rsp\d+_/.test(id)) || "";
      record.commonIds = sparks.filter((id) => id !== record.epiphanyId);
      const match = record.epiphanyId.match(/^rsp(\d+)_(.+)$/);
      if (match) record.variantCardId = `${match[2]}_rsp${match[1]}`;
    }
    if (flags & FLAGS.GOD_R_SPARK) {
      record.divineId = reader.string();
      record.god = record.divineId.match(/^add_r_spark_([^_]+)_/)?.[1]?.toUpperCase() || "";
    }
    if (flags & FLAGS.ADD_TALENTS) {
      const talentCount = reader.uint();
      record.addedTalents = Array.from({ length: talentCount }, () => reader.string());
      record.duplicate = record.addedTalents.includes("TALENT_REPLICATION");
    }
    if (flags & FLAGS.COST_CHANGED) record.costDelta = reader.uint();
    if (flags & FLAGS.COST_SET) record.costSet = reader.uint();
    if (flags & FLAGS.COST_SUBTRACT) record.costSubtract = reader.uint();
    cards.push(record);
  }
  if (reader.offset !== body.length) throw new Error(`Preset has ${body.length - reader.offset} unsupported trailing byte(s).`);
  return { version: decrypted[2], format: "game", charId, cards };
}

function decodeLegacy(code) {
  const attempts = [String(code).trim(), new TextDecoder().decode(base64UrlDecode(code))];
  for (const value of attempts) {
    const candidate = value.replace(/^CZN(?:PRESET)?[:.]/i, "");
    try {
      const parsed = JSON.parse(candidate);
      const charId = parsed.charId ?? parsed.characterId ?? parsed.charResId;
      const cards = parsed.cards ?? parsed.deck;
      if (charId && Array.isArray(cards)) return { version: parsed.version ?? 0, format: "legacy", charId: String(charId), cards };
    } catch { /* try the next legacy representation */ }
  }
  throw new Error("The code is neither a current nor a supported legacy CZN preset.");
}

export function decodeGamePreset(code) {
  if (!String(code || "").trim()) throw new Error("Paste a game preset code first.");
  try { return decodeCurrent(String(code).trim()); } catch (currentError) {
    try { return decodeLegacy(String(code).trim()); } catch { throw currentError; }
  }
}

export function encodeGamePreset(characterBuild, options = {}) {
  const writer = new Writer();
  const charId = characterBuild.charId ?? characterBuild.combatantId;
  const cards = characterBuild.cards || [];
  if (!/^\d+$/.test(String(charId || ""))) throw new Error("A game preset needs a numeric combatant ID.");
  writer.uint(Number(charId));
  writer.uint(cards.length);
  for (const card of cards) {
    const sparks = [card.epiphanyId || card.uniqueId, ...(card.commonIds || [])].filter(Boolean);
    const talents = [...(card.addedTalents || [])];
    if (card.duplicate && !talents.includes("TALENT_REPLICATION")) talents.push("TALENT_REPLICATION");
    let flags = card.removed ? FLAGS.REMOVED : 0;
    if (sparks.length) flags |= FLAGS.R_SPARK;
    if (talents.length) flags |= FLAGS.ADD_TALENTS;
    if (card.divineId) flags |= FLAGS.GOD_R_SPARK;
    if (card.costDelta !== undefined && card.costDelta !== 0) flags |= FLAGS.COST_CHANGED;
    if (card.costSet !== undefined && card.costSet !== null) flags |= FLAGS.COST_SET;
    if (card.costSubtract !== undefined && card.costSubtract !== 0) flags |= FLAGS.COST_SUBTRACT;
    writer.bytes.push(flags);
    writer.string(card.baseCardId || card.cardId);
    if (sparks.length) { writer.uint(sparks.length); sparks.forEach((id) => writer.string(id)); }
    if (card.divineId) writer.string(card.divineId);
    if (talents.length) { writer.uint(talents.length); talents.forEach((talent) => writer.string(talent)); }
    if (flags & FLAGS.COST_CHANGED) writer.uint(Math.max(0, Number(card.costDelta)));
    if (flags & FLAGS.COST_SET) writer.uint(Math.max(0, Number(card.costSet)));
    if (flags & FLAGS.COST_SUBTRACT) writer.uint(Math.max(0, Number(card.costSubtract)));
  }
  const compressed = deflateStored(Uint8Array.from(writer.bytes));
  const version = Math.max(1, Math.min(VERSION, Number(options.version) || VERSION));
  const payload = Uint8Array.from([...MAGIC, version, ...compressed]);
  return base64UrlEncode(crypt(payload));
}

export function serializeSimulatorSave(state) {
  const payload = { type: "SimulatorSaveV1", version: 1, savedAt: new Date().toISOString(), state };
  return `CZNS1.${base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)))}`;
}

export async function deserializeSimulatorSave(codeOrFile) {
  const raw = typeof codeOrFile === "string" ? codeOrFile : await codeOrFile.text();
  const trimmed = raw.trim();
  let payload;
  if (trimmed.startsWith("CZNS1.")) payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(trimmed.slice(6))));
  else payload = JSON.parse(trimmed);
  if (payload?.type !== "SimulatorSaveV1" || payload?.version !== 1 || !payload.state) throw new Error("Unsupported simulator save format.");
  // Early simulator saves called the opening target "handSize". The recovered
  // runtime has separate base draw (5) and hand maximum (10) values.
  if (payload.state.battle?.handSize !== undefined) {
    if (payload.state.battle.drawCount === undefined) payload.state.battle.drawCount = payload.state.battle.handSize;
    if (payload.state.battle.handMax === undefined) payload.state.battle.handMax = 10;
    payload.state.battle.initialHand ||= [];
    delete payload.state.battle.handSize;
  }
  return payload.state;
}
