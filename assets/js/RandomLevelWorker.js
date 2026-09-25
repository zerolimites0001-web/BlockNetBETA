// RandomLevelWorker — gera colunas de chunk fora da thread principal.
// Recebe {type:'gen', cx, cz, seed} → responde {type:'chunk', cx, cz, blocks:[[x,y,z,b],...]}
importScripts('noisejs.js');
var CS = 16, SEA = 12;
var _NZ = null, _NZSeed = null;
function NZ(seed){
  if(!_NZ || _NZSeed !== seed){ _NZ = new Noise(seed); _NZSeed = seed; }
  return _NZ;
}
function rnd(x, y, z, s) {
  var h = (x * 374761393 + y * 668265263 + z * 2147483647 + s * 1442695041) | 0;
  h = (h ^ (h >> 13)) | 0; h = (h * 1274126177) | 0; h = (h ^ (h >> 16)) >>> 0;
  return h / 4294967295;
}
// simplex fbm / perlin fbm / perlin ridged (via noisejs)
function sFbm(nz,x,y,oct){ var a=0.5,f=1,s=0,n=0; for(var i=0;i<oct;i++){ s+=a*nz.simplex2(x*f,y*f); n+=a; a*=0.5; f*=2.02; } return s/n; }
function pFbm(nz,x,y,oct){ var a=0.5,f=1,s=0,n=0; for(var i=0;i<oct;i++){ s+=a*nz.perlin2(x*f,y*f); n+=a; a*=0.5; f*=2.02; } return s/n; }
function ridge(nz,x,y,oct){ var a=0.5,f=1,s=0,n=0; for(var i=0;i<oct;i++){ var v=1-Math.abs(nz.perlin2(x*f,y*f)); s+=a*v*v; n+=a; a*=0.5; f*=2.1; } return s/n; }
function biomeAt(X, Z, SD){
  var seed = (SD === undefined) ? 1337 : SD, nz = NZ(seed), seedF = seed*0.001;
  var plains = sFbm(nz, X*0.004+seedF, Z*0.004-seedF, 3)*2.0;
  var mask = pFbm(nz, X*0.00045+777+seedF, Z*0.00045-777-seedF, 2);
  var m = Math.max(0,(mask+0.08)/0.30); m = Math.min(1,m); m = m*m*(3-2*m);
  var r = ridge(nz, X*0.0016+200+seedF, Z*0.0016-200-seedF, 4);
  var det = nz.simplex2(X*0.02-500-seedF, Z*0.02+500+seedF);
  var mountH = r*85 + det*2.0;
  var h = Math.floor(14 + plains*(1-m) + (plains+mountH)*m);
  if(h < 4) h = 4;
  var moist = pFbm(nz, X*0.008-seed*0.001+400, Z*0.008+seed*0.001-200, 2);
  var type;
  if(h <= SEA-2){ h = SEA-2; type = 'ocean'; }
  else if(h <= SEA){ type = 'beach'; }
  else if(m > 0.45){ type = 'mountain'; }
  else if(moist > 0.12){ type = 'forest'; }
  else { type = 'plains'; }
  return {h:h, type:type, m:m};
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
      if (y === 0) b = 'bedrock';
      else if (y === 1 && rnd(wx,y,wz,seed+5)<0.5) b = 'bedrock';
      else if (t === 'ocean') b = y === h ? 'sand' : (y > h - 2 ? 'dirt' : 'stone');
      else if (t === 'beach') b = y === h ? 'sand' : (y > h - 3 ? 'sand' : 'stone');
      else if (t === 'mountain') b = y === h ? (h > SEA+45 ? 'snow' : (h > SEA+30 ? 'rock' : (h > SEA+12 ? 'stone' : 'grass'))) : (y > h - 3 ? (h > SEA+30 ? 'stone' : 'dirt') : 'stone');
      else b = y === h ? 'grass' : (y > h - 2 ? 'dirt' : 'stone');
      if (b === 'stone'){
        var or = rnd(wx,y,wz,seed+99);
        if(y<=4 && or<0.02) b='diamond_ore';
        else if(y<=6 && or<0.045) b='gold_ore';
        else if(y<=14 && or<0.09) b='iron_ore';
        else if(or<0.12) b='coal_ore';
        else if(or>0.985) b='gravel';
      }
      if (b === 'dirt' && rnd(wx,y,wz,seed+31)<0.06) b = 'clay';
      if (b === 'sand' && t !== 'ocean' && t !== 'beach' && rnd(wx,y,wz,seed+32)<0.15) b = 'gravel';
      if(y>2 && y<h-2){
        var nz = NZ(seed);
        // espaguete 3D real: tunel onde |s1| e |s2| sao pequenos ao mesmo tempo
        var s1 = nz.simplex2(wx*0.045+wz*0.013+seed*0.01, y*0.06-wz*0.02);
        var s2 = nz.simplex2(wx*0.02-wz*0.05-seed*0.01, y*0.055+wx*0.017);
        if(Math.abs(s1) < 0.09 && Math.abs(s2) < 0.09) continue;
      }
      out.push([wx, y, wz, b]);
    }
    var td = t === 'forest' ? 0.022 : (t === 'plains' ? 0.006 : 0.0);
    var tree = td > 0 && rnd(wx, wz, 7, seed) < td;
    if (tree) {
      var blocked = false;
      for (var ox = -1; ox <= 1 && !blocked; ox++) for (var oz = -1; oz <= 1 && !blocked; oz++) {
        if (!ox && !oz) continue;
        if (rnd(wx + ox, wz + oz, 7, seed) < td*2) blocked = true;
      }
      if (blocked) tree = false;
    }
    if (tree && h > SEA && h < SEA+14 && bi.m < 0.3) {
      var th = 4 + ((rnd(wx, h, wz, seed + 7) * 2) | 0);
      var top = h + th;
      for (var i = 1; i <= th; i++) out.push([wx, h + i, wz, 'wood']);
      var leafSet = {};
      function addLeaf(x,y,z){ var k=x+','+y+','+z; if(leafSet[k]) return; leafSet[k]=1; out.push([x,y,z,'leaves']); }
      for (var dx = -2; dx <= 2; dx++) for (var dz = -2; dz <= 2; dz++) {
        if (Math.abs(dx)===2 && Math.abs(dz)===2) continue;
        if (dx===0 && dz===0) continue;
        addLeaf(wx+dx, top-1, wz+dz);
        addLeaf(wx+dx, top, wz+dz);
      }
      for (var dx2 = -1; dx2 <= 1; dx2++) for (var dz2 = -1; dz2 <= 1; dz2++) {
        if (dx2===0 && dz2===0) continue;
        addLeaf(wx+dx2, top+1, wz+dz2);
      }
      addLeaf(wx, top+1, wz);
      addLeaf(wx, top+2, wz);
    }
    if (h < SEA) for (var w = h + 1; w <= SEA; w++) out.push([wx, w, wz, 'water']);
  }
  postMessage({ type: 'chunk', cx: cx, cz: cz, blocks: out });
};
