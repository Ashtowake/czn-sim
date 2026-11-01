const output = document.querySelector("#result");
const assert = (condition, message) => { if (!condition) throw new Error(message); };

try {
  const manifest = await fetch("../data/asset-manifest.json").then((response) => response.json());
  assert(manifest.format === "AssetManifest", "Manifest type is missing");
  assert(manifest.entries.length >= 800, `Only ${manifest.entries.length} assets were mapped`);
  assert(manifest.entries.some((entry) => entry.resourceId === "unique_30134_01" && entry.category === "card"), "Rossweisse Flicker Blade art is missing");
  assert(manifest.entries.some((entry) => entry.resourceId === "portrait_character_30134"), "Rossweisse portrait is missing");
  assert(manifest.entries.some((entry) => entry.category === "equipment"), "Equipment icons are missing");
  assert(manifest.entries.some((entry) => entry.category === "gear"), "Gear icons are missing");
  assert(manifest.entries.some((entry) => entry.category === "god"), "God imagery is missing");
  for (let offset = 0; offset < manifest.entries.length; offset += 80) {
    const batch = manifest.entries.slice(offset, offset + 80);
    const responses = await Promise.all(batch.map((entry) => fetch(`../${entry.path}`, { method: "HEAD" })));
    const failed = responses.findIndex((response) => !response.ok);
    if (failed >= 0) throw new Error(`Missing manifest asset ${batch[failed].path}`);
  }
  assert(manifest.entries.every((entry) => entry.width > 0 && entry.height > 0), "An asset has invalid dimensions");
  output.textContent = `PASS entries=${manifest.entries.length} all-local=true`;
} catch (error) {
  output.textContent = `FAIL ${error.stack || error.message}`;
}
