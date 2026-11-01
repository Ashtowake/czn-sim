import { BattleEngine, asList, asNumber, computeUnitPreview, gearRollValue, statLabel } from "./engine.js";
import {
  buildDataMaps, calculateFaintMemory, cardDisplayName, cardSource, createCharacterBuild, createId,
  createSimulatorState, epiphanyCompatibility, makeCardInstance, normalizeImportedBuild,
  resolveCardDescription, toBattleConfig, validateCharacterBuild,
} from "./model.js";
import { decodeGamePreset, deserializeSimulatorSave, encodeGamePreset, serializeSimulatorSave } from "./codec.js";

const $ = (selector, root = document) => root.querySelector(selector);
const el = (tag, className = "", text = "") => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== "") node.textContent = text;
  return node;
};
const clone = (value) => structuredClone(value);
let data;
let maps;
let state;
let engine;
let lastBattleConfig;
let resultShown = false;

const rawText = (id, fallback = id) => data?.text?.[id] || fallback || id || "";
const clean = (value) => String(value || "")
  .replace(/<br\s*\/?>/gi, " ")
  .replace(/<[^>]+>/g, "")
  .replace(/\[\/?[^\]]+]/g, "")
  .replace(/\$([^$]+)\$/g, "$1")
  .replace(/\^card@([^\^]+)\^/g, "$1")
  .replace(/#([a-z0-9_]+)#/gi, "[unresolved:$1]")
  .replace(/\s+/g, " ").trim();
const label = (id, fallback = id) => clean(rawText(id, fallback));
const cardName = (card) => clean(cardDisplayName(card, data));
const cardDescription = (card) => clean(resolveCardDescription(card, data));
const activeBuild = () => state.slots[state.activeSlot];
const activeCombatant = () => maps.combatants.get(activeBuild()?.combatantId);
const assetPath = (resourceId) => maps.assets?.get(String(resourceId || ""))?.path || "";
const cardResource = (card) => [card?.sct_name, card?.spine_model, card?.card_skin_set].find((value) => value && value !== "none") || "";

function toast(message, type = "info") {
  const node = $("#toast");
  node.textContent = message;
  node.className = `toast ${type}`;
  node.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { node.hidden = true; }, 4200);
}

function button(text, onClick, className = "") {
  const node = el("button", className, text);
  node.type = "button";
  node.addEventListener("click", onClick);
  return node;
}

function field(caption, control, hint = "") {
  const wrapper = el("label", "field");
  wrapper.append(el("span", "field-label", caption), control);
  if (hint) wrapper.append(el("small", "field-hint", hint));
  return wrapper;
}

function select(rows, value, onChange, className = "") {
  const node = el("select", className);
  for (const row of rows) {
    const option = el("option", "", row.label);
    option.value = row.value;
    option.selected = String(value ?? "") === String(row.value);
    node.append(option);
  }
  node.addEventListener("change", () => onChange(node.value));
  return node;
}

function numberInput(value, min, max, onChange, step = 1) {
  const node = document.createElement("input");
  node.type = "number"; node.value = value; node.min = min; node.max = max; node.step = step;
  node.addEventListener("change", () => onChange(Math.max(min, Math.min(max, asNumber(node.value)))));
  return node;
}

function searchPicker({ items, value = "", name, onChange, empty = false, placeholder = "Search…" }) {
  const root = el("div", "search-picker");
  const input = document.createElement("input");
  input.type = "search"; input.placeholder = placeholder; input.autocomplete = "off";
  const menu = el("div", "search-menu"); menu.hidden = true;
  const current = items.find((item) => String(item.id) === String(value));
  input.value = current ? name(current) : "";
  const render = () => {
    const query = input.value.trim().toLowerCase();
    const found = items.filter((item) => `${name(item)} ${item.id}`.toLowerCase().includes(query)).slice(0, 80);
    menu.replaceChildren();
    const optionButton = (caption, choose) => {
      const option = el("button", "search-option", caption);
      option.type = "button";
      let chosen = false;
      const activate = (event) => {
        event.preventDefault();
        if (chosen) return;
        chosen = true;
        choose();
      };
      option.addEventListener("pointerdown", activate);
      option.addEventListener("click", activate);
      return option;
    };
    if (empty) menu.append(optionButton("— None —", () => { input.value = ""; menu.hidden = true; onChange(""); }));
    for (const item of found) menu.append(optionButton(name(item), () => { input.value = name(item); menu.hidden = true; onChange(String(item.id)); }));
    if (!found.length) menu.append(el("p", "empty-message", "No matches"));
  };
  input.addEventListener("focus", () => { input.select(); render(); menu.hidden = false; });
  input.addEventListener("input", () => { render(); menu.hidden = false; });
  root.addEventListener("focusout", () => setTimeout(() => { menu.hidden = true; }, 100));
  root.append(input, menu);
  return root;
}

function mutateBuild(mutator, successMessage = "") {
  const before = clone(activeBuild());
  mutator(activeBuild());
  const report = validateCharacterBuild(activeBuild(), data, state.sandbox);
  if (!state.sandbox && !report.valid) {
    state.slots[state.activeSlot] = before;
    toast(report.errors[0], "error");
    return false;
  }
  if (successMessage) toast(successMessage, "success");
  renderSetup();
  return true;
}

function renderSlotTabs() {
  const root = $("#slot-tabs"); root.replaceChildren();
  state.slots.forEach((build, index) => {
    const combatant = build && maps.combatants.get(build.combatantId);
    const node = button("", () => { state.activeSlot = index; renderSetup(); }, `slot-tab ${state.activeSlot === index ? "active" : ""}`);
    const portrait = combatant ? assetPath(combatant.portraitResource) : "";
    node.innerHTML = `${portrait ? `<img src="${portrait}" alt="" loading="lazy">` : `<span>${index + 1}</span>`}<strong>${combatant ? label(combatant.name, combatant.id) : "Empty slot"}</strong><small>${build ? `${build.cards.filter((card) => !card.removed).length} cards` : "Add combatant"}</small>`;
    root.append(node);
  });
}

function renderSlotHeader() {
  const root = $("#slot-header"); root.replaceChildren();
  const build = activeBuild();
  if (!build) {
    const empty = el("div", "empty-slot");
    empty.append(el("p", "kicker", `Combatant slot ${state.activeSlot + 1}`), el("h2", "", "Choose a combatant"), el("p", "", "Empty slots are ignored in battle, so one-character testing works without filler units."));
    empty.append(searchPicker({
      items: data.combatants,
      name: (row) => `${label(row.name, row.englishName || row.id)} · ${row.id}`,
      placeholder: "Search combatants by name or ID…",
      onChange: (id) => { state.slots[state.activeSlot] = createCharacterBuild(data, id); renderSetup(); },
    }));
    root.append(empty);
    return;
  }
  const combatant = activeCombatant();
  const memory = calculateFaintMemory(build, data);
  const head = el("div", "slot-header-row");
  const identity = el("div", "slot-identity");
  identity.append(el("p", "kicker", `Slot ${state.activeSlot + 1} · ${combatant.className || "combatant"}`), el("h2", "", label(combatant.name, combatant.id)), el("p", "", `${combatant.id} · ${label(combatant.description, combatant.englishName || "")}`));
  identity.append(searchPicker({
    items: data.combatants,
    value: build.combatantId,
    name: (row) => `${label(row.name, row.englishName || row.id)} · ${row.id}`,
    placeholder: "Search to change this combatant…",
    onChange: (id) => {
      if (!id || id === build.combatantId) return;
      state.slots[state.activeSlot] = createCharacterBuild(data, id);
      renderSetup();
      toast("Combatant changed; incompatible cards, equipment, and gear were reset.", "success");
    },
  }));
  const controls = el("div", "slot-controls");
  controls.append(
    field("Level", numberInput(build.level, 1, asNumber(combatant.maxLevel, 1), (value) => mutateBuild((target) => { target.level = value; }))),
    field("Depth", numberInput(build.depth, 1, 15, (value) => mutateBuild((target) => { target.depth = value; }))),
  );
  const nightmare = el("label", "check-field");
  const checkbox = document.createElement("input"); checkbox.type = "checkbox"; checkbox.checked = build.nightmare;
  checkbox.addEventListener("change", () => mutateBuild((target) => { target.nightmare = checkbox.checked; }));
  nightmare.append(checkbox, document.createTextNode(" Nightmare"));
  controls.append(nightmare, button("Clear slot", () => { state.slots[state.activeSlot] = null; renderSetup(); }, "danger-quiet"));
  head.append(identity, controls);
  const meter = el("div", `memory-meter ${memory.total > memory.cap ? "over" : ""}`);
  meter.innerHTML = `<div><strong>Faint Memory ${memory.total} / ${memory.cap}</strong><span>${memory.remaining} remaining</span></div><progress max="${memory.cap}" value="${Math.min(memory.total, memory.cap)}"></progress>`;
  root.append(head, meter);
}

const BUILD_TABS = [["deck", "Deck"], ["equipment", "Equipment / Relics"], ["gear", "Gear"], ["stats", "Stats"]];
function renderBuildTabs() {
  const root = $("#build-tabs"); root.replaceChildren();
  if (!activeBuild()) { root.hidden = true; return; }
  root.hidden = false;
  for (const [id, caption] of BUILD_TABS) root.append(button(caption, () => { state.activeTab = id; renderSetup(); }, state.activeTab === id ? "active" : ""));
}

function instanceCard(entry) {
  return maps.cards.get(entry.variantCardId) || maps.cards.get(maps.epiphanies.get(entry.uniqueId)?.change_link_card_id) || maps.cards.get(entry.cardId);
}

function renderCardTile(entry, index) {
  const card = instanceCard(entry);
  const tile = el("article", `deck-card ${entry.removed ? "removed" : ""}`);
  const art = el("div", "card-art");
  art.style.setProperty("--card-color", activeCombatant()?.color || "#6e83b9");
  const artPath = assetPath(cardResource(card));
  if (artPath) { const image = el("img"); image.src = artPath; image.alt = ""; image.loading = "lazy"; art.append(image); }
  art.append(el("span", "card-cost", asNumber(card?.cost) < 0 ? "X" : String(Math.max(0, asNumber(card?.cost)))));
  const body = el("div", "card-body");
  const badges = el("div", "badge-row");
  badges.append(el("span", "badge", String(card?.card_category || "CARD").replace("CARD_", "")), el("span", "badge", cardSource(card)));
  if (entry.isStartingCard) badges.append(el("span", "badge muted", "Starter"));
  if (entry.duplicate) badges.append(el("span", "badge warning", "Duplicate"));
  body.append(badges, el("h3", "", cardName(card)), el("p", "card-description", cardDescription(card)));
  const layers = el("div", "epiphany-chips");
  if (entry.uniqueId) layers.append(el("span", "chip unique", label(maps.epiphanies.get(entry.uniqueId)?.description, entry.uniqueId)));
  for (const id of entry.commonIds || []) layers.append(el("span", "chip common", label(maps.randomEpiphanies.get(id)?.description, id)));
  if (entry.divineId) layers.append(el("span", "chip divine", `${maps.randomEpiphanies.get(entry.divineId)?.god_type || "God"}: ${label(maps.randomEpiphanies.get(entry.divineId)?.description, entry.divineId)}`));
  if (!layers.childElementCount) layers.append(el("span", "chip empty", "No epiphanies"));
  body.append(layers);
  const actions = el("div", "card-actions");
  actions.append(
    button("Edit", () => openCardEditor(entry.instanceId)),
    button("Duplicate", () => mutateBuild((build) => {
      const copy = clone(entry); copy.instanceId = createId("card"); copy.isStartingCard = false; copy.initialUnique = false; copy.removed = false; copy.duplicate = true;
      build.cards.splice(index + 1, 0, copy);
    }, `Duplicated ${cardName(card)}.`)),
  );
  if (entry.isStartingCard) actions.append(button(entry.removed ? "Restore" : "Remove", () => mutateBuild((build) => { build.cards[index].removed = !build.cards[index].removed; }), entry.removed ? "" : "danger-quiet"));
  else actions.append(button("Remove", () => mutateBuild((build) => { build.cards.splice(index, 1); }), "danger-quiet"));
  tile.append(art, body, actions);
  return tile;
}

function eligibleLibraryCards() {
  const build = activeBuild();
  const combatant = activeCombatant();
  const excludedSorts = new Set(["SORT_MONSTER_UNIQUE", "SORT_NEGATIVE", "SORT_ARENA", "SORT_QUEST", "SORT_BREAK_IN"]);
  return data.cards.filter((card) => {
    if (/_rsp\d+|_mut\d+$|_cre\d+$/.test(card.id)) return false;
    if (excludedSorts.has(card.sort)) return false;
    if (asList(card.talent).includes("TALENT_UNPLAYABLE")) return false;
    const owner = card.id.match(/^c_(\d+)_/)?.[1];
    if (!state.sandbox && card.require_owner_flag === "YES" && owner && owner !== build.combatantId) return false;
    const classes = asList(card.ownable_link_base_class_define_id);
    if (!state.sandbox && classes.length && !classes.includes(combatant.className)) return false;
    return card.name && card.name !== "none";
  });
}

function renderDeckView(root) {
  const build = activeBuild();
  const toolbar = el("div", "deck-toolbar");
  const search = document.createElement("input"); search.type = "search"; search.placeholder = "Search the card library…";
  let renderLibrary = () => {};
  const typeFilter = select([{ value: "", label: "All card types" }, ...["CARD_ATK", "CARD_SKILL", "CARD_POWER", "CARD_ABILITY"].map((value) => ({ value, label: value.replace("CARD_", "") }))], "", () => renderLibrary());
  const sourceFilter = select([{ value: "", label: "All sources" }, ...["Starting", "Unique", "Collapse", "Support", "Formation", "Seasonal", "Public"].map((value) => ({ value, label: value }))], "", () => renderLibrary());
  toolbar.append(search, typeFilter, sourceFilter);
  const library = el("section", "card-library");
  const deck = el("section", "deck-list");
  const heading = el("div", "section-heading");
  heading.innerHTML = `<div><p class="kicker">Character deck</p><h3>${build.cards.filter((card) => !card.removed).length} active cards</h3></div><p>Each card keeps its owner during draw, discard, generation, and effect resolution.</p>`;
  deck.append(heading);
  const grid = el("div", "deck-grid");
  build.cards.forEach((entry, index) => grid.append(renderCardTile(entry, index)));
  deck.append(grid);
  renderLibrary = () => {
    const query = search.value.toLowerCase().trim();
    const cards = eligibleLibraryCards().filter((card) => {
      const source = cardSource(card);
      return (!query || `${cardName(card)} ${card.id} ${cardDescription(card)}`.toLowerCase().includes(query))
        && (!typeFilter.value || card.card_category === typeFilter.value)
        && (!sourceFilter.value || source.toLowerCase().includes(sourceFilter.value.toLowerCase()));
    }).slice(0, 100);
    library.replaceChildren();
    const libraryHead = el("div", "section-heading");
    libraryHead.innerHTML = `<div><p class="kicker">Card library</p><h3>${cards.length}${cards.length === 100 ? "+" : ""} results</h3></div><p>Normal, seasonal, support, collapse, desire, and special cards are sourced from the extracted client catalogue.</p>`;
    library.append(libraryHead);
    const results = el("div", "library-grid");
    for (const card of cards) {
      const row = el("article", "library-card");
      row.innerHTML = `<span class="mini-cost">${asNumber(card.cost) < 0 ? "X" : Math.max(0, asNumber(card.cost))}</span><div><strong>${cardName(card)}</strong><small>${cardSource(card)} · ${card.card_category?.replace("CARD_", "")} · ${card.id}</small></div>`;
      row.append(button("Add", () => mutateBuild((target) => {
        const duplicate = target.cards.some((entry) => !entry.removed && entry.baseCardId === card.id);
        target.cards.push(makeCardInstance(data, card.id, target.combatantId, { duplicate }));
      }, `Added ${cardName(card)}.`), "small-button"));
      results.append(row);
    }
    library.append(results);
  };
  search.addEventListener("input", renderLibrary);
  root.append(toolbar, deck, library);
  renderLibrary();
}

function epiphanyDescription(row) {
  return label(row?.description, row?.id || "Unknown effect");
}

function openCardEditor(instanceId) {
  const dialog = $("#card-editor");
  const render = () => {
    const build = activeBuild();
    const entry = build.cards.find((card) => card.instanceId === instanceId);
    if (!entry) { dialog.close(); return; }
    const card = instanceCard(entry);
    const root = $("#card-editor-content"); root.replaceChildren();
    const header = el("div", "dialog-header");
    header.append(el("div", "", ""), button("×", () => dialog.close(), "icon-button"));
    header.firstChild.append(el("p", "kicker", "Layered epiphany editor"), el("h2", "", cardName(card)), el("p", "", `${card.id} · ${cardDescription(card)}`));
    root.append(header);
    const preview = el("div", "before-after");
    const commonRows = (entry.commonIds || []).map((id) => maps.randomEpiphanies.get(id)).filter(Boolean);
    let cost = asNumber(card.cost);
    const talents = new Set(asList(card.talent));
    for (const row of commonRows) {
      if (row.add_cost_mathsign === "MATHSIGN_SUBTRACT_MIN_0") cost = Math.max(0, cost - asNumber(row.add_cost_value));
      asList(row.add_talent).forEach((talent) => talents.add(talent));
    }
    preview.innerHTML = `<div><small>Base</small><strong>${asNumber(card.cost)} AP</strong><span>${asList(card.talent).join(", ") || "No talents"}</span></div><div class="arrow">→</div><div><small>Configured</small><strong>${cost} AP</strong><span>${[...talents].join(", ") || "No talents"}</span></div>`;
    root.append(preview);

    const uniqueSection = el("section", "editor-section"); uniqueSection.append(el("h3", "", "Unique / card-specific"));
    const uniqueGrid = el("div", "choice-grid");
    const none = button("No unique epiphany", () => mutateBuild((target) => { const item = target.cards.find((x) => x.instanceId === instanceId); item.uniqueId = ""; item.variantCardId = ""; }) && render(), entry.uniqueId ? "choice" : "choice selected");
    uniqueGrid.append(none);
    for (const row of maps.uniqueByCard.get(entry.baseCardId) || []) {
      const variant = maps.cards.get(row.change_link_card_id);
      const node = button("", () => mutateBuild((target) => { const item = target.cards.find((x) => x.instanceId === instanceId); item.uniqueId = row.id; item.variantCardId = row.change_link_card_id; }) && render(), `choice ${entry.uniqueId === row.id ? "selected" : ""}`);
      node.innerHTML = `<strong>${cardName(variant)}</strong><span>${cardDescription(variant)}</span>`;
      uniqueGrid.append(node);
    }
    uniqueSection.append(uniqueGrid); root.append(uniqueSection);

    const commonSection = el("section", "editor-section");
    const commonSearch = document.createElement("input"); commonSearch.type = "search"; commonSearch.placeholder = "Search common epiphanies…";
    commonSection.append(el("h3", "", "Common / public"), commonSearch);
    const commonGrid = el("div", "effect-choice-list"); commonSection.append(commonGrid); root.append(commonSection);
    const renderCommon = () => {
      const query = commonSearch.value.toLowerCase(); commonGrid.replaceChildren();
      const rows = data.randomEpiphanies.filter((row) => row.rarity === "R_SPARK_RARITY_COMMON" && (!query || `${row.id} ${epiphanyDescription(row)}`.toLowerCase().includes(query))).slice(0, 120);
      for (const row of rows) {
        const compatibility = epiphanyCompatibility(row, card, activeCombatant());
        const selected = entry.commonIds.includes(row.id);
        const node = button("", () => {
          if (!compatibility.ok && !state.sandbox) return;
          mutateBuild((target) => { const item = target.cards.find((x) => x.instanceId === instanceId); item.commonIds = selected ? item.commonIds.filter((id) => id !== row.id) : [...item.commonIds, row.id]; });
          render();
        }, `effect-choice ${selected ? "selected" : ""} ${compatibility.ok ? "" : "incompatible"}`);
        node.disabled = !compatibility.ok && !state.sandbox;
        node.innerHTML = `<strong>${epiphanyDescription(row)}</strong><small>${row.id}${compatibility.ok ? "" : ` · ${compatibility.reasons.join(" ")}`}</small>`;
        commonGrid.append(node);
      }
    };
    commonSearch.addEventListener("input", renderCommon); renderCommon();

    const divineSection = el("section", "editor-section"); divineSection.append(el("h3", "", "Divine / god"));
    const godFilter = select([{ value: "", label: "All gods" }, ...["VITOR", "CIRCEN", "DIALLOS", "NIHILUM", "SECRED", "CALIGO"].map((value) => ({ value, label: value }))], maps.randomEpiphanies.get(entry.divineId)?.god_type || "", renderDivine);
    const divineGrid = el("div", "effect-choice-list"); divineSection.append(godFilter, divineGrid); root.append(divineSection);
    function renderDivine() {
      divineGrid.replaceChildren();
      divineGrid.append(button("No divine epiphany", () => mutateBuild((target) => { target.cards.find((x) => x.instanceId === instanceId).divineId = ""; }) && render(), entry.divineId ? "effect-choice" : "effect-choice selected"));
      for (const row of data.randomEpiphanies.filter((item) => item.rarity === "R_SPARK_RARITY_UNIQUE" && (!godFilter.value || item.god_type === godFilter.value))) {
        const compatibility = epiphanyCompatibility(row, card, activeCombatant());
        const node = button("", () => { mutateBuild((target) => { target.cards.find((x) => x.instanceId === instanceId).divineId = row.id; }); render(); }, `effect-choice ${entry.divineId === row.id ? "selected" : ""} ${compatibility.ok ? "" : "incompatible"}`);
        node.disabled = !compatibility.ok && !state.sandbox;
        const godIcon = assetPath(`currency_${String(row.god_type).toLowerCase()}_spark_change`);
        node.innerHTML = `${godIcon ? `<img class="god-icon" src="${godIcon}" alt="">` : ""}<strong>${row.god_type} · ${epiphanyDescription(row)}</strong><small>${row.id}${compatibility.ok ? "" : ` · ${compatibility.reasons.join(" ")}`}</small>`;
        divineGrid.append(node);
      }
    }
    renderDivine();
    root.append(el("p", "dialog-note", "Common, card-specific, and divine layers are stored independently and materialized together when combat begins."));
  };
  render(); dialog.showModal();
}

const RELIC_SLOTS = [["weapon", "EQUIP_WEAPON", "Weapon"], ["armor", "EQUIP_ARMOR", "Armor"], ["accessory", "EQUIP_ACC", "Accessory"]];
function renderEquipmentView(root) {
  const build = activeBuild();
  const partner = maps.partners.get(build.partnerId);
  const partnerBox = el("section", "editor-section"); partnerBox.append(el("h3", "", "Partner"));
  partnerBox.append(searchPicker({ items: data.partners, value: build.partnerId, empty: true, name: (row) => `${label(row.name, row.id)} · ${row.id}`, onChange: (id) => mutateBuild((target) => { target.partnerId = id; target.partnerLevel = id ? maps.partners.get(id)?.maxLevel || 1 : 1; }) }));
  if (partner) partnerBox.append(field("Partner level", numberInput(build.partnerLevel, 1, partner.maxLevel, (value) => mutateBuild((target) => { target.partnerLevel = value; }))));
  root.append(partnerBox);
  const grid = el("div", "relic-grid");
  for (const [slot, type, caption] of RELIC_SLOTS) {
    const box = el("section", "relic-slot"); box.append(el("p", "kicker", caption));
    const items = data.equipment.filter((row) => row.type === type);
    const current = build.equipment[slot]?.relicId || "";
    box.append(searchPicker({ items, value: current, empty: true, name: (row) => `${label(row.name, row.id)} · ${row.rarity?.replace("RARITY_", "")} · ${row.id}`, onChange: (id) => mutateBuild((target) => { target.equipment[slot] = id ? { relicId: id, starLevel: 5, reinforceIds: [], hammerRelicId: "" } : null; }) }));
    const item = maps.equipment.get(current);
    if (item) {
      const starLevel = build.equipment[slot]?.starLevel || 5;
      box.append(field("Star level", numberInput(starLevel, 1, 5, (value) => mutateBuild((target) => { target.equipment[slot].starLevel = value; }))));
      const iconPath = assetPath(String(item.icon).split("/").at(-1));
      if (iconPath) { const icon = el("img", "relic-icon"); icon.src = iconPath; icon.alt = ""; icon.loading = "lazy"; box.prepend(icon); }
      const effects = el("div", "effect-summary");
      for (const tier of item.slots.filter((row) => row.description && row.description !== "none")) effects.append(el("p", tier.slot <= starLevel ? "active" : "", `${tier.slot}★ · ${label(tier.description, tier.description)}`));
      box.append(effects);
    }
    grid.append(box);
  }
  root.append(grid);
}

function optionsForGroup(group) {
  return data.pieceOptions.filter((row) => row.group === group);
}

function statOptionEditor(optionState, options, onChange, excluded = []) {
  const row = el("div", "stat-option-row");
  const available = options.filter((option) => !excluded.includes(option.link_stat_list_id) || option.id === optionState?.optionId);
  row.append(select([{ value: "", label: "— Select stat —" }, ...available.map((option) => ({ value: option.id, label: statLabel(option.link_stat_list_id) }))], optionState?.optionId || "", (id) => onChange(id ? { optionId: id, quality: optionState?.quality || "max", reinforce: optionState?.reinforce || 0 } : null)));
  if (optionState?.optionId) {
    row.append(select([{ value: "min", label: "Min roll" }, { value: "max", label: "Max roll" }], optionState.quality || "max", (quality) => onChange({ ...optionState, quality })));
    row.append(numberInput(optionState.reinforce || 0, 0, 15, (reinforce) => onChange({ ...optionState, reinforce })));
    const option = maps.pieceOptions.get(optionState.optionId);
    row.append(el("output", "", String(gearRollValue(option, optionState.quality, optionState.reinforce))));
  }
  return row;
}

function renderGearView(root) {
  const build = activeBuild();
  const setCounts = new Map();
  for (const gear of build.gear) { const piece = maps.pieces.get(gear.pieceId); if (piece) setCounts.set(piece.setId, (setCounts.get(piece.setId) || 0) + 1); }
  const summary = el("div", "set-summary");
  if (!setCounts.size) summary.append(el("p", "empty-message", "No gear sets equipped."));
  for (const [setId, count] of setCounts) {
    const set = maps.pieceSets.get(setId);
    const box = el("article", "set-card"); box.append(el("strong", "", `${label(set?.name, setId)} · ${count} pieces`));
    for (const threshold of [2, 4, 6]) {
      const type = set?.[`set${threshold}_type`];
      if (type && type !== "none" && type !== "SET_TYPE_NONE") box.append(el("p", count >= threshold ? "active" : "", `${threshold}-piece: ${label(set[`set${threshold}_description`], "Effect")}`));
    }
    summary.append(box);
  }
  root.append(summary);
  const gearGrid = el("div", "gear-grid");
  build.gear.forEach((gear, index) => {
    const slot = index + 1;
    const box = el("section", "gear-slot"); box.append(el("p", "kicker", `Gear slot ${slot}`));
    const pieces = data.pieces.filter((piece) => piece.type === `ITEM_PIECE_${slot}`);
    box.append(searchPicker({ items: pieces, value: gear.pieceId, empty: true, name: (piece) => `${label(maps.pieceSets.get(piece.setId)?.name, piece.setId)} · ${piece.rarity?.replace("RARITY_", "")} · ${piece.id}`, onChange: (id) => mutateBuild((target) => { target.gear[index] = { slot, pieceId: id, main: null, substats: [], reinforce: 0 }; }) }));
    const piece = maps.pieces.get(gear.pieceId);
    if (piece) {
      const iconPath = assetPath(String(piece.icon).split("/").at(-1));
      if (iconPath) { const icon = el("img", "gear-icon"); icon.src = iconPath; icon.alt = ""; icon.loading = "lazy"; box.prepend(icon); }
      box.append(el("h4", "", "Main stat"));
      box.append(statOptionEditor(gear.main, optionsForGroup(piece.mainOptionGroup), (value) => mutateBuild((target) => { target.gear[index].main = value; })));
      box.append(el("h4", "", "Substats (four distinct valid stats)"));
      for (let subIndex = 0; subIndex < 4; subIndex += 1) {
        const current = gear.substats[subIndex] || null;
        const excluded = gear.substats.filter((_, i) => i !== subIndex).map((item) => maps.pieceOptions.get(item?.optionId)?.link_stat_list_id).filter(Boolean);
        box.append(statOptionEditor(current, optionsForGroup(piece.subOptionGroup), (value) => mutateBuild((target) => {
          const next = [...target.gear[index].substats];
          if (value) next[subIndex] = value; else next.splice(subIndex, 1);
          target.gear[index].substats = next.filter(Boolean).slice(0, 4);
        }), excluded));
      }
    }
    gearGrid.append(box);
  });
  root.append(gearGrid);
}

function renderStatsView(root) {
  const build = activeBuild();
  const unit = computeUnitPreview(data, {
    combatantId: build.combatantId, level: build.level, partnerId: build.partnerId, partnerLevel: build.partnerLevel,
    relics: Object.fromEntries(Object.entries(build.equipment).map(([slot, item]) => [slot, item?.relicId || ""])), gear: build.gear,
  });
  const stats = [["HP", unit.maxHp], ["ATK", unit.atk], ["DEF", unit.def], ["Crit rate", `${unit.crit}%`], ["Crit damage", `${unit.critDamage}%`], ["Additional damage", `${unit.additionalDamage || 0}%`], ["DoT damage", `${unit.dotDamage || 0}%`]];
  const grid = el("div", "stats-grid");
  for (const [name, value] of stats) { const box = el("article"); box.append(el("span", "", name), el("strong", "", Number.isFinite(value) ? Math.round(value).toLocaleString() : value)); grid.append(box); }
  root.append(grid);
  const notes = el("section", "editor-section"); notes.append(el("h3", "", "Applied model notes"));
  for (const note of unit.approximations || []) notes.append(el("p", "", note));
  root.append(notes);
}

function renderBuildContent() {
  const root = $("#build-content"); root.replaceChildren();
  if (!activeBuild()) return;
  if (state.activeTab === "deck") renderDeckView(root);
  else if (state.activeTab === "equipment") renderEquipmentView(root);
  else if (state.activeTab === "gear") renderGearView(root);
  else renderStatsView(root);
}

function renderValidation() {
  const root = $("#validation-panel"); root.replaceChildren();
  root.append(el("p", "kicker", state.sandbox ? "Sandbox validation" : "Game legality"), el("h2", "", "Build report"));
  const occupied = state.slots.filter(Boolean);
  if (!occupied.length) { root.append(el("p", "empty-message", "Add at least one combatant.")); return; }
  occupied.forEach((build) => {
    const report = validateCharacterBuild(build, data, state.sandbox);
    const combatant = maps.combatants.get(build.combatantId);
    const box = el("article", `validation-card ${report.errors.length ? "invalid" : "valid"}`);
    box.append(el("strong", "", label(combatant?.name, build.combatantId)), el("span", "", report.errors.length ? `${report.errors.length} violation(s)` : "Game-legal"));
    const memory = report.memory;
    box.append(el("small", "", `Faint Memory ${memory.total}/${memory.cap} · additions ${memory.additions} · removals ${memory.removals} · duplicates ${memory.duplicates} · divine ${memory.divine}`));
    for (const error of report.errors.slice(0, 8)) box.append(el("p", "error-text", error));
    if (state.sandbox && report.errors.length) box.append(el("p", "warning-text", "Allowed by Sandbox; game-code export is disabled."));
    root.append(box);
  });
}

function renderEnemyPanel() {
  const root = $("#enemy-panel"); root.replaceChildren();
  root.append(el("p", "kicker", "Encounter"), el("h2", "", "Enemy model"));
  root.append(searchPicker({ items: data.enemies, value: state.enemy.id, name: (row) => `${label(row.name, row.id)} · ${row.grade || row.rank} · ${row.id}`, onChange: (id) => { state.enemy.id = id; renderSetup(); }, placeholder: "Search enemies…" }));
  const grid = el("div", "field-grid");
  grid.append(
    field("HP", numberInput(state.enemy.hp, 1, 99999999, (value) => { state.enemy.hp = value; })),
    field("ATK", numberInput(state.enemy.atk, 1, 999999, (value) => { state.enemy.atk = value; })),
    field("DEF", numberInput(state.enemy.def, 0, 999999, (value) => { state.enemy.def = value; })),
    field("Weakness", numberInput(state.enemy.weakness, 0, 10, (value) => { state.enemy.weakness = value; }, 0.05)),
    field("AP / turn", numberInput(state.battle.ap, 1, 12, (value) => { state.battle.ap = value; })),
    field("Turn draw", numberInput(state.battle.drawCount ?? 5, 0, 20, (value) => { state.battle.drawCount = value; })),
    field("Hand maximum", numberInput(state.battle.handMax ?? 10, 1, 20, (value) => { state.battle.handMax = value; })),
    field("RNG seed", numberInput(state.battle.seed, 0, 999999999, (value) => { state.battle.seed = value; })),
  );
  root.append(grid);
  root.append(el("p", "panel-note", "Recovered opening path: an explicit pre-placed hand is installed first, then turn 1 draws five cards from the seeded deck order (up to the 10-card hand cap). Opening talents are a separate auto-use queue. The external game coordinator that chooses pre-placed cards is still unresolved, so this app defaults that subset to empty."));
  const enemy = maps.enemies.get(state.enemy.id);
  if (enemy) root.append(el("p", "panel-note", `${enemy.actions?.length || 0} extracted weighted actions · opening ${enemy.startCard || "none"}`));
}

function renderSetup() {
  renderSlotTabs(); renderSlotHeader(); renderBuildTabs(); renderBuildContent(); renderValidation(); renderEnemyPanel();
  $("#sandbox-toggle").checked = state.sandbox;
}

function openImport() {
  const dialog = $("#import-dialog"); const root = $("#import-content"); root.replaceChildren();
  let preview = null;
  const header = el("div", "dialog-header"); header.append(el("div", "", ""), button("×", () => dialog.close(), "icon-button"));
  header.firstChild.append(el("p", "kicker", "Offline import"), el("h2", "", "Import a game code or simulator save"));
  const textarea = document.createElement("textarea"); textarea.rows = 7; textarea.placeholder = "Paste a CZN game preset code or CZNS1 simulator code…";
  const previewBox = el("div", "import-preview empty-message", "Nothing decoded yet.");
  const apply = button("Apply import", () => {
    if (!preview) return;
    if (preview.kind === "simulator") state = preview.state;
    else {
      const imported = normalizeImportedBuild(data, preview.decoded);
      const current = activeBuild();
      if (current?.combatantId === imported.combatantId) current.cards = imported.cards;
      else state.slots[state.activeSlot] = imported;
    }
    dialog.close(); renderSetup(); toast("Import applied.", "success");
  }, "primary-button"); apply.disabled = true;
  const decode = button("Preview", async () => {
    try {
      if (textarea.value.trim().startsWith("CZNS1.") || textarea.value.trim().startsWith("{")) {
        const importedState = await deserializeSimulatorSave(textarea.value);
        preview = { kind: "simulator", state: importedState };
        previewBox.innerHTML = `<strong>Complete simulator save</strong><p>${importedState.slots.filter(Boolean).length} combatants · enemy ${importedState.enemy.id} · all equipment, gear, and battle settings included.</p>`;
      } else {
        const decoded = decodeGamePreset(textarea.value);
        preview = { kind: "game", decoded };
        const combatant = maps.combatants.get(String(decoded.charId));
        previewBox.innerHTML = `<strong>${label(combatant?.name, decoded.charId)} · game preset v${decoded.version}</strong><p>${decoded.cards.filter((card) => !card.removed).length} cards · ${decoded.cards.filter((card) => card.removed).length} removals · ${decoded.cards.filter((card) => card.duplicate).length} duplicates · ${decoded.cards.filter((card) => card.divineId).length} divine effects</p><ul>${decoded.cards.map((card) => `<li>${card.removed ? "Removed " : ""}${cardName(maps.cards.get(card.cardId))}${card.epiphanyId ? ` · ${card.epiphanyId}` : ""}${card.divineId ? ` · ${card.divineId}` : ""}</li>`).join("")}</ul>`;
      }
      previewBox.classList.remove("empty-message"); apply.disabled = false;
    } catch (error) { preview = null; apply.disabled = true; previewBox.textContent = error.message; previewBox.className = "import-preview error-text"; }
  });
  const actions = el("div", "dialog-actions"); actions.append(decode, apply);
  root.append(header, textarea, previewBox, actions); dialog.showModal();
}

function copyButton(value) {
  return button("Copy", async () => { await navigator.clipboard.writeText(value); toast("Copied to clipboard.", "success"); }, "small-button");
}

function openExport() {
  const dialog = $("#export-dialog"); const root = $("#export-content"); root.replaceChildren();
  const header = el("div", "dialog-header"); header.append(el("div", "", ""), button("×", () => dialog.close(), "icon-button"));
  header.firstChild.append(el("p", "kicker", "Portable builds"), el("h2", "", "Export"), el("p", "", "Game codes contain one character's cards. The simulator code preserves the complete encounter.")); root.append(header);
  state.slots.forEach((build, index) => {
    if (!build) return;
    const report = validateCharacterBuild(build, data, false);
    const section = el("section", "export-row"); section.append(el("h3", "", `Slot ${index + 1} · ${label(maps.combatants.get(build.combatantId)?.name, build.combatantId)}`));
    if (state.sandbox || !report.valid) section.append(el("p", "warning-text", "Game export unavailable while Sandbox is active or this build is illegal."));
    else {
      const code = encodeGamePreset(build); const text = el("textarea"); text.readOnly = true; text.value = code; text.rows = 3; section.append(text, copyButton(code));
    }
    root.append(section);
  });
  const simulator = serializeSimulatorSave(state); const section = el("section", "export-row"); section.append(el("h3", "", "Complete simulator save"));
  const text = el("textarea"); text.readOnly = true; text.value = simulator; text.rows = 5; section.append(text, copyButton(simulator)); root.append(section);
  dialog.showModal();
}

function saveToFile() {
  const code = serializeSimulatorSave(state);
  localStorage.setItem("czn-simulator-save", code);
  const url = URL.createObjectURL(new Blob([code], { type: "text/plain" }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = "czn-simulator.cznsave"; anchor.click(); URL.revokeObjectURL(url);
  toast("Saved locally and downloaded a simulator file.", "success");
}

function startBattle() {
  const builds = state.slots.filter(Boolean);
  if (!builds.length) return toast("Add at least one combatant.", "error");
  if (!state.sandbox) {
    const invalid = builds.map((build) => validateCharacterBuild(build, data, false)).find((report) => !report.valid);
    if (invalid) return toast(invalid.errors[0], "error");
  }
  lastBattleConfig = toBattleConfig(state, data);
  engine = new BattleEngine(data, clone(lastBattleConfig)); resultShown = false;
  $("#setup-screen").hidden = true; $("#battle-screen").hidden = false; renderBattle();
}

function healthBoard(entity, enemy = false) {
  const article = el("article", enemy ? "health-card enemy-health" : "health-card");
  const percentage = Math.max(0, Math.min(100, entity.hp / entity.maxHp * 100));
  article.innerHTML = `<div><strong>${label(entity.name, entity.id)}</strong><span>${Math.ceil(entity.hp).toLocaleString()} / ${Math.ceil(entity.maxHp).toLocaleString()} HP</span></div><div class="health-track"><i style="width:${percentage}%"></i></div><p>ATK ${Math.round(entity.atk)} · DEF ${Math.round(entity.def)} · Shield ${Math.round(entity.shield || 0)}</p>`;
  return article;
}

function combatantBoard(unit) {
  const article = el("article", `health-card ${unit.linkCrash ? "enemy-health" : ""}`);
  const percentage = Math.max(0, Math.min(100, unit.stress / unit.maxStress * 100));
  article.innerHTML = `<div><strong>${label(unit.name, unit.id)}</strong><span>${unit.stress.toFixed(1)} / ${unit.maxStress} Stress</span></div><div class="health-track"><i style="width:${percentage}%"></i></div><p>ATK ${Math.round(unit.atk)} · DEF ${Math.round(unit.def)}${unit.collapsed ? " · Collapsed" : ""}${unit.linkCrash ? " · Link Crash" : ""}</p>`;
  return article;
}

function renderBattle() {
  const battle = engine.state;
  $("#turn-label").textContent = `Turn ${battle.turn} · ${battle.phase}`; $("#ap-label").textContent = `${battle.ap} AP`;
  const enemy = $("#enemy-board"); enemy.replaceChildren(healthBoard(battle.enemy, true), healthBoard(battle.player));
  const party = $("#party-board"); party.replaceChildren(...battle.team.map((unit) => combatantBoard(unit)));
  const piles = $("#pile-counts"); piles.textContent = `Draw ${battle.drawPile.length} · Discard ${battle.discardPile.length} · Exhaust ${battle.exhaustPile.length}`;
  const hand = $("#hand"); hand.replaceChildren();
  for (const instance of battle.hand) {
    const card = engine.getCard(instance); const owner = battle.team[instance.ownerIndex];
    const node = button("", () => {
      const result = engine.playerCard(instance.uid);
      $("#battle-hint").textContent = result.ok ? `${cardName(card)} resolved. Review the trace below.` : result.error;
      renderBattle();
    }, `hand-card ${instance.shard || ""}`);
    const unplayable = asList(card?.talent).includes("TALENT_UNPLAYABLE");
    node.disabled = battle.phase !== "main_phase" || asNumber(card?.cost) > battle.ap || unplayable;
    const art = assetPath(cardResource(card));
    node.innerHTML = `${art ? `<img class="hand-art" src="${art}" alt="">` : ""}<span class="hand-cost">${asNumber(card?.cost) < 0 ? "X" : Math.max(0, asNumber(card?.cost))}</span><small>${label(owner?.name, owner?.id)}</small><h3>${cardName(card)}</h3>${instance.bindStacks > 1 ? `<strong>Bind ×${instance.bindStacks}</strong>` : ""}<p>${cardDescription(card)}</p>`;
    hand.append(node);
  }
  renderBattleEffects(); renderBattleLog();
  if (battle.over && !resultShown) { resultShown = true; $("#result-content").innerHTML = `<h2>${battle.result === "victory" ? "Victory" : "Defeat"}</h2><p>The battle ended on turn ${battle.turn}.</p>`; $("#result-dialog").showModal(); }
}

function renderBattleEffects() {
  const root = $("#active-effects"); root.replaceChildren();
  const rows = [...engine.state.team, engine.state.player, engine.state.enemy].flatMap((target) => (target.statuses || []).map((status) => `${label(target.name, target.id)} · ${label(status.name, status.csId)} ×${status.stacks}`));
  for (const approximation of engine.approximations) rows.push(`Approximation · ${approximation}`);
  if (!rows.length) rows.push("No statuses or approximations are active.");
  rows.forEach((row) => root.append(el("p", "", row)));
}

function renderBattleLog() {
  const root = $("#battle-log"); root.replaceChildren();
  for (const event of [...engine.events].reverse().slice(0, 100)) { const row = el("p", `log-${event.type}`); row.append(el("span", "", `T${event.turn}`), document.createTextNode(event.message)); root.append(row); }
}

function bindStatic() {
  $("#sandbox-toggle").addEventListener("change", (event) => { state.sandbox = event.target.checked; renderSetup(); });
  $("#import-button").addEventListener("click", openImport);
  $("#export-button").addEventListener("click", openExport);
  $("#save-button").addEventListener("click", saveToFile);
  $("#load-button").addEventListener("click", () => $("#load-file").click());
  $("#load-file").addEventListener("change", async (event) => {
    try { state = await deserializeSimulatorSave(event.target.files[0]); renderSetup(); toast("Simulator save loaded.", "success"); }
    catch (error) { toast(error.message, "error"); }
    event.target.value = "";
  });
  $("#reset-button").addEventListener("click", () => { if (confirm("Reset the complete simulator setup?")) { state = createSimulatorState(data); renderSetup(); } });
  $("#start-battle").addEventListener("click", startBattle);
  $("#leave-battle").addEventListener("click", () => { $("#battle-screen").hidden = true; $("#setup-screen").hidden = false; });
  $("#restart-battle").addEventListener("click", () => { engine = new BattleEngine(data, clone(lastBattleConfig)); resultShown = false; renderBattle(); });
  $("#end-turn").addEventListener("click", () => { engine.endTurn(); renderBattle(); });
}

async function start() {
  try {
    const [response, assetResponse] = await Promise.all([fetch("data/snapshot.json"), fetch("data/asset-manifest.json")]);
    if (!response.ok) throw new Error(`Snapshot request failed (${response.status}).`);
    data = await response.json(); maps = buildDataMaps(data);
    const manifest = assetResponse.ok ? await assetResponse.json() : { entries: [] };
    maps.assets = new Map(manifest.entries.map((entry) => [entry.resourceId, entry]));
    const saved = localStorage.getItem("czn-simulator-save");
    if (saved) { try { state = await deserializeSimulatorSave(saved); } catch { state = createSimulatorState(data); } }
    else state = createSimulatorState(data);
    bindStatic(); renderSetup();
  } catch (error) {
    document.body.innerHTML = `<main class="fatal"><h1>Combat Lab could not start</h1><p>${clean(error.message)}</p><p>Serve the project directory itself, for example: <code>python -m http.server 8765 --directory D:\\Projektdateien\\Code\\czn-sim</code></p></main>`;
  }
}

start();
