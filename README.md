# CZN Combat Lab

An offline, buildless Chaos Zero Nightmare build editor and interactive combat simulator generated from the local build 133 client tables.

The app has three independent, nullable combatant slots. Each slot stores progression, partner, relics, six gear pieces with explicit rolls, and its own card instances. Cards support removals, configured duplicates, card-specific variants, multiple compatible common epiphanies, and a divine epiphany. Game legality and Faint Memory are enforced unless Sandbox override is enabled.

Game preset strings can be decoded and encoded entirely in the browser. Complete `CZNS1` simulator saves preserve all three builds, gear, enemy, and battle settings. Import always shows a preview; importing the same character replaces only cards, while a different character replaces the slot.

Combat is manual: cards resolve only when clicked. The player team has the game's shared HP/shield entity; combatants retain their individual stats, stress, collapse, and Link Crash state. Turn Begin, Draw Before, Draw, Draw After, Main Phase, Turnover, Monster Sequence, and Player Sequence Start follow the recovered client order. The engine retains card ownership through draw, discard, generation, and effect resolution. Rossweisse's Flicker Blade division, table-driven event thresholds and per-turn allowances, Sword Tassel Bind stacks, `cs_30134_18`, and combination rules are covered by a browser test.

## Run

From this repository root:

```powershell
.\.venv\Scripts\python.exe -m http.server 8765 --directory D:\Projektdateien\Code\czn-sim
```

Open `http://localhost:8765/`.

## Regenerate data

```powershell
.\.venv\Scripts\python.exe scripts\export_snapshot.py
.\.venv\Scripts\python.exe scripts\build_asset_manifest.py
```

`CZN_DB_ROOT` and `CZN_TEXT_ROOT` can override the extracted database and English text locations. The PNG files under `assets/` are unmodified extractions; image conversion and responsive variants are intentionally deferred.

## Browser smoke tests

With the local server running:

- `/tests/codec-smoke.html` verifies the supplied game code, semantic game-code round trips, corrupt input, and complete simulator saves.
- `/tests/model-smoke.html` verifies Faint Memory caps, removal/duplicate limits, Sandbox behavior, compatibility rejection, and gear-stat legality.
- `/tests/battle-smoke.html` verifies stats, gear, card damage, shared team HP, enemy turns, runtime mutations, and Rossweisse's division/condition-stack/combination loop.
- `/tests/ui-smoke.html` verifies per-character slots, deck isolation, Faint Memory, one-character combat, manual card play, and real battle UI rendering.
- `/tests/asset-smoke.html` verifies every asset-manifest entry resolves to a local PNG and has dimensions.

## Accuracy boundary

The static card, equipment, level, epiphany, condition-stack, stress, and monster-pattern graphs come from the installed game client. Relative damage uses one transparent approximation consistently across teams; it is intended for build comparison, not exact in-game damage replication. The external coordinator that partitions a prepared deck into deck and pre-placed hand is still unresolved, so the simulator exposes that subset explicitly and defaults it to empty. Unsupported runtime branches are reported instead of silently being treated as correct.
