# BlockNetBETA

Minecraft-like web game com shaders e mods. Roda no browser, sem build.

## Rodar

```bash
cd BlockNetBETA
python3 -m http.server 8080
# abre http://localhost:8080
```

Ou qualquer servidor estatico. 100% offline (three + jszip em `assets/js/vendor/`).

## Estrutura

```
index.html
assets/js/app.js            # engine (voxel, chunks via worker, save IndexedDB)
assets/js/LevelNoiseV2.js   # geracao de terreno (worker)
assets/js/RandomLevelWorker.js  # gerador antigo (desativado)
assets/js/shaders.js        # ShaderSys — packs .glslv/.glslf via snippet injection
assets/js/mods.js           # ModSys — mods .zip (js/css/html) com IndexedDB
assets/js/vendor/three.min.js
```

## Shaders

Packs zip com `pack.json` listando caminhos livres:

```json
{ "name": "MeuPack", "shaders": ["shaders/vento.glslv", "shaders/tonemap.glslf"] }
```

- `.glslv` = vertex (aplica so nas folhas), injetado apos `begin_vertex`
- `.glslf` = fragment (aplica em tudo), injetado apos `map_fragment`
- Importa pelo botao SHADERS no jogo. OFF desativa.

## Mods

Zips com `pack.json`:

```json
{ "name": "MeuMod", "js": ["main.js"], "css": ["style.css"] }
```

API no jogo: `__BN` (get/set/player/biome/scene/camera/renderer/THREE),
`__BlockAPI.registerBlock`, `Mod.el/asset/worker`. Mods persistem em IndexedDB.

## Licenca

MIT
