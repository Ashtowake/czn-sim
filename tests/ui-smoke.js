const output = document.querySelector("#result");
const frame = document.querySelector("#app");
const waitFor = async (predicate, message) => {
  for (let attempt = 0; attempt < 160; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(message);
};

try {
  await new Promise((resolve) => frame.addEventListener("load", resolve, { once: true }));
  const doc = frame.contentDocument;
  await waitFor(() => doc.querySelectorAll(".slot-tab").length === 3, "Three persistent character slots did not render");
  await waitFor(() => doc.querySelectorAll(".deck-card").length === 8, "Rossweisse's starting and initial unique cards did not render");
  if (doc.querySelectorAll(".slot-tab")[1].textContent.includes("Rossweisse")) throw new Error("Deck state leaked into the empty second slot");
  doc.querySelectorAll(".slot-tab")[1].click();
  await waitFor(() => doc.querySelector("#slot-header .empty-slot"), "The empty second slot did not open");
  const emptyCombatantSearch = doc.querySelector("#slot-header .search-picker input");
  emptyCombatantSearch.value = "1003";
  emptyCombatantSearch.dispatchEvent(new Event("input", { bubbles: true }));
  await waitFor(() => doc.querySelector("#slot-header .search-option"), "Combatant search did not return a result");
  doc.querySelector("#slot-header .search-option").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  await waitFor(() => !doc.querySelector("#slot-header .empty-slot"), "Selecting a combatant did not populate the slot");
  if (!doc.querySelector("#slot-header .slot-identity .search-picker")) throw new Error("Populated slots have no combatant change control");
  const occupiedCombatantSearch = doc.querySelector("#slot-header .slot-identity .search-picker input");
  occupiedCombatantSearch.value = "1004";
  occupiedCombatantSearch.dispatchEvent(new Event("input", { bubbles: true }));
  await waitFor(() => doc.querySelector("#slot-header .slot-identity .search-option"), "Changing a populated slot returned no combatants");
  doc.querySelector("#slot-header .slot-identity .search-option").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  await waitFor(() => doc.querySelector("#slot-header .slot-identity")?.textContent.includes("1004"), "Changing a populated slot did not replace its combatant");
  [...doc.querySelectorAll("#slot-header button")].find((button) => button.textContent === "Clear slot").click();
  await waitFor(() => doc.querySelector("#slot-header .empty-slot"), "The test combatant could not be cleared");
  doc.querySelectorAll(".slot-tab")[0].click();
  await waitFor(() => doc.querySelectorAll(".deck-card").length === 8, "Returning to Rossweisse did not restore her deck view");
  if (!doc.querySelector("#validation-panel").textContent.includes("Faint")) throw new Error("Faint Memory breakdown is absent");
  if (!doc.querySelector(".deck-toolbar input[type=search]")) throw new Error("Searchable card library is absent");
  doc.querySelector(".deck-card .card-actions button").click();
  await waitFor(() => doc.querySelector("#card-editor").open, "Layered epiphany editor did not open");
  if (!doc.querySelector("#card-editor").textContent.includes("Common / public") || !doc.querySelector("#card-editor").textContent.includes("Divine / god")) throw new Error("Epiphany layers are incomplete");
  doc.querySelector("#card-editor .icon-button").click();
  [...doc.querySelectorAll("#build-tabs button")].find((button) => button.textContent === "Gear").click();
  await waitFor(() => doc.querySelectorAll(".gear-slot").length === 6, "All six gear slots did not render");
  [...doc.querySelectorAll("#build-tabs button")].find((button) => button.textContent === "Deck").click();
  doc.querySelector("#import-button").click();
  const sample = "v6l8cOjiNvfFzwd5bz8N5Gb2ZkVEaMFcD5GzNsHxt0GoRYG4L-qZQpfQ548wnl7K93xs-a7r1k1PWwKzFdL7HNlH9h89ICMdPPr4ZYZ0IUOaqK0WmQJlq4rtioGOP47821CGGJefDHNsnA";
  doc.querySelector("#import-dialog textarea").value = sample;
  doc.querySelector("#import-dialog .dialog-actions button").click();
  await waitFor(() => doc.querySelector(".import-preview").textContent.includes("Rossweisse"), "Game import preview did not decode the supplied code");
  doc.querySelector("#import-dialog .icon-button").click();
  doc.querySelector("#export-button").click();
  await waitFor(() => doc.querySelectorAll("#export-dialog textarea").length === 2, "Per-character and simulator exports were not both created");
  doc.querySelector("#export-dialog .icon-button").click();
  const enemyNumbers = doc.querySelectorAll("#enemy-panel input[type=number]");
  enemyNumbers[5].value = "20";
  enemyNumbers[5].dispatchEvent(new Event("change", { bubbles: true }));
  doc.querySelector("#start-battle").click();
  await waitFor(() => !doc.querySelector("#battle-screen").hidden, "Battle screen did not open");
  await waitFor(() => doc.querySelectorAll(".hand-card").length > 0, "No playable hand was rendered");
  if (doc.querySelectorAll("#party-board .health-card").length !== 1) throw new Error("One-character battle did not preserve the empty slots");
  const handText = doc.querySelector("#hand").textContent;
  if (!handText.includes("Shard:Light") || !handText.includes("Shard:Dark")) throw new Error("Flicker Blade did not polarize in the real battle UI");
  const playable = [...doc.querySelectorAll(".hand-card")].find((card) => !card.disabled && !card.classList.contains("light") && !card.classList.contains("dark"));
  if (!playable) throw new Error("The opening hand has no playable non-shard card");
  const playedName = playable.querySelector("h3").textContent;
  playable.click();
  await waitFor(() => doc.querySelector("#battle-hint").textContent.includes("resolved"), "Clicking a card did not resolve it");
  await waitFor(() => doc.querySelector("#battle-log").textContent.includes("played"), "Played card is absent from the battle log");
  output.textContent = `PASS slots=3 deck=8 party=1 hand=${doc.querySelectorAll(".hand-card").length} played=${playedName}`;
} catch (error) {
  output.textContent = `FAIL ${error.stack || error.message}`;
}
