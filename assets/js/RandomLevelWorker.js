// RandomLevelWorker — gera colunas de chunk fora da thread principal.
// Recebe {type:'gen', cx, cz, seed} → responde {type:'chunk', cx, cz, blocks:[[x,y,z,b],...]}
importScripts('LevelNoise.js');
var CS = 16, SEA = 9;
function rnd(x, y, z, s) {
  var h = (x * 374761393 + y * 668265263 + z * 2147483647 + s * 1442695041) | 0;
  h = (h ^ (h >> 13)) | 0; h = (h * 1274126177) | 0; h = (h ^ (h >> 16)) >>> 0;
  return h / 4294967295;
}
function gh(x, z, seed) {
  var seedF = seed * 0.001;
  var wx = LevelNoise.simplex(x * 0.02 + seedF + 9.1, z * 0.02 - seedF + 3.7);
  var wz = LevelNoise.simplex(x * 0.02 - seedF - 2.3, z * 0.02 + seedF + 7.9);
  var qx = x + wx * 48, qz = z + wz * 48;
  var cont = LevelNoise.simplexFbm(qx * 0.012 + seedF, qz * 0.012 - seedF, 3);
  var base = LevelNoise.perlin(qx * 0.055, qz * 0.055);
  var det = LevelNoise.perlin(qx * 0.17 + 300, qz * 0.17 - 150);
  var r = LevelNoise.ridged(qx * 0.02 + 500, qz * 0.02 - 300, 4);
  var mask = Math.max(0, cont - 0.38) * 3.2; if (mask > 1) mask = 1; mask = mask * mask;
  var plain = Math.max(0, 0.30 - Math.abs(cont - 0.05)) * 8;
  var h = 11 + cont * 7 + base * 4.5 + det * 2 - plain + r * mask * 24;
  return Math.max(3, Math.floor(h));
}
onmessage = function (e) {
  var m = e.data;
  if (m.type !== 'gen') return;
  var cx = m.cx, cz = m.cz, seed = m.seed, out = [];
  for (var x = 0; x < CS; x++) for (var z = 0; z < CS; z++) {
    var wx = cx * CS + x, wz = cz * CS + z, h = gh(wx, wz, seed);
    for (var y = 0; y <= h; y++) {
      var b = y === 0 ? 'rock' : (y === h ? (h <= SEA + 1 ? 'sand' : 'grass') : (y > h - 3 ? 'dirt' : (rnd(wx, y, wz, seed) < 0.08 ? 'rock' : 'stone')));
      out.push([wx, y, wz, b]);
    }
    if (h > SEA + 1 && ((wx * 31 + wz * 17 + seed) & 31) < 2) {
      var th = 3 + ((rnd(wx, h, wz, seed + 7) * 2) | 0);
      for (var i = 1; i <= th; i++) out.push([wx, h + i, wz, 'wood']);
      for (var dx = -2; dx <= 2; dx++) for (var dz = -2; dz <= 2; dz++) for (var dy = 0; dy < 2; dy++) {
        if (Math.abs(dx) === 2 && Math.abs(dz) === 2) continue;
        out.push([wx + dx, h + th - 1 + dy, wz + dz, 'leaves']);
      }
      out.push([wx, h + th + 1, wz, 'leaves']);
    }
    if (h < SEA) for (var w = h + 1; w <= SEA; w++) out.push([wx, w, wz, 'water']);
  }
  postMessage({ type: 'chunk', cx: cx, cz: cz, blocks: out });
};
