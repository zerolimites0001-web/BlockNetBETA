// RandomLevelWorker — gera colunas de chunk fora da thread principal.
// Recebe {type:'gen', cx, cz, seed} → responde {type:'chunk', cx, cz, blocks:[[x,y,z,b],...]}
importScripts('LevelNoise.js');
var CS = 16, SEA = 9;
function rnd(x, y, z, s) {
  var h = (x * 374761393 + y * 668265263 + z * 2147483647 + s * 1442695041) | 0;
  h = (h ^ (h >> 13)) | 0; h = (h * 1274126177) | 0; h = (h ^ (h >> 16)) >>> 0;
  return h / 4294967295;
}
function biomeAt(X, Z, SD){
  var seed = (SD === undefined) ? SEED : SD, seedF = seed*0.001;
  var wx = LevelNoise.simplex(X*0.02+seedF+9.1, Z*0.02-seedF+3.7);
  var wz = LevelNoise.simplex(X*0.02-seedF-2.3, Z*0.02+seedF+7.9);
  var qx = X+wx*48, qz = Z+wz*48;
  var cont = LevelNoise.simplexFbm(qx*0.008+seedF, qz*0.008-seedF, 3);
  var temp = LevelNoise.perlin(qx*0.01+seed*0.002+100, qz*0.01-seed*0.002-100);
  var moist = LevelNoise.perlin(qx*0.015-seed*0.003+400, qz*0.015+seed*0.003-200);
  var base = LevelNoise.perlin(qx*0.055, qz*0.055);
  var det = LevelNoise.perlin(qx*0.17+300, qz*0.17-150);
  var r = LevelNoise.ridged(qx*0.02+500, qz*0.02-300, 4);
  var mMask = Math.max(0, cont-0.30)*2.6; if(mMask>1)mMask=1; mMask=mMask*mMask;
  var h, type;
  if(cont < -0.18){
    h = SEA-3 + Math.floor((cont+0.18)*14 + det*1.5);
    if(h > SEA-1) h = SEA-1;
    if(h < 2) h = 2;
    type = 'ocean';
  } else if(cont < -0.08){
    h = SEA + (det > 0 ? 1 : 0);
    type = 'beach';
  } else {
    var plain = Math.max(0, 0.30-Math.abs(cont-0.05))*8;
    h = Math.floor(11 + cont*9 + base*4 + det*2 - plain + r*mMask*26);
    if(h <= SEA+1){ h = SEA+1; type = 'beach'; }
    else if(mMask > 0.45 && h > SEA+8){ type = 'mountain'; }
    else if(temp > 0.22 && moist < 0.10){ type = 'desert'; }
    else if(moist > 0.12){ type = 'forest'; }
    else { type = 'plains'; }
    if(h < 3) h = 3;
  }
  return {h:h, type:type};
}
onmessage = function (e) {
  var m = e.data;
  if (m.type !== 'gen') return;
  var cx = m.cx, cz = m.cz, seed = m.seed, out = [];
  for (var x = 0; x < CS; x++) for (var z = 0; z < CS; z++) {
    var wx = cx * CS + x, wz = cz * CS + z;
    var bi = biomeAt(wx, wz, seed), h = bi.h, t = bi.type;
    for (var y = 0; y <= h; y++) {
      var b;
      if (y === 0) b = 'rock';
      else if (t === 'ocean') b = y === h ? 'sand' : (y > h - 2 ? 'dirt' : 'stone');
      else if (t === 'beach' || t === 'desert') b = y === h ? 'sand' : (y > h - 3 ? 'sand' : 'stone');
      else if (t === 'mountain') b = y === h ? (h > SEA + 10 ? 'rock' : 'grass') : (y > h - 3 ? (h > SEA + 10 ? 'stone' : 'dirt') : 'stone');
      else b = y === h ? 'grass' : (y > h - 3 ? 'dirt' : (rnd(wx, y, wz, seed) < 0.08 ? 'rock' : 'stone'));
      out.push([wx, y, wz, b]);
    }
    var tree = t === 'forest' ? (((wx * 7 + wz * 13 + seed) & 7) < 2) : (t === 'plains' ? (((wx * 31 + wz * 17 + seed) & 31) < 2) : false);
    if (tree && h > SEA + 1) {
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
