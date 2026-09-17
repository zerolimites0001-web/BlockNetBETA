# BlockNet

Recriação web de Minecraft Classic jogável no navegador — criativo single-player com mundos por seed, terreno procedural, chunks com colisão, hotbar/inventário e controles mobile além de teclado e mouse.

Código, texturas, sons (nenhum — sem áudio) e UI 100% originais deste projeto. Nenhum asset da Mojang/Microsoft. Fonte: Press Start 2P (OFL, ver `assets/fonts/OFL.txt`).

## Como rodar

```bash
cd Projects/BlockNet
python3 serve.py 8080
# http://127.0.0.1:8080/
```

Crie um mundo pelo nome e aperte **PLAY**.

## Controles

- **Desktop:** WASD/mouse, clique quebra/coloca, B abre blocos, F5 câmera, F3 debug
- **Mobile:** D-pad, JMP/BRK/PLC/INV/CAM/SET, arrastar na tela pra olhar

## Mundos

Cada mundo = seed + alterações, persistidos em **IndexedDB**.

## Técnica

- Three.js **r128** (UMD clássico, vendorizado — sem CDN, sem módulos, sem importmap)
- Terreno em **Web Worker** (`RandomLevelWorker.js`, até 4 chunks em voo, fallback síncrono)
- Render por `InstancedMesh` (1 draw call por tipo de bloco) + anel distante barato opcional
- Texturas pixel-art 16x16 geradas proceduralmente
