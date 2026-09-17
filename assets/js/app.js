// BlockNet v4 — recriação limpa. THREE r128 global, worker de chunks, IndexedDB.
(function(){
"use strict";
window.__blocknet_booted = true;

var CS = 16, SEA = 9;
var SEED = (Math.random()*9999)|0, WORLD_ID = null;
var scene, camera, renderer, world = new Map();
var chunkMeshes = {};
var realR = 2;
var keys = {}, sel = 0, third = false, yaw = 0, pitch = -0.4;
var px = 8.5, py = 20, pz = 8.5, vy = 0;
var edits = new Map(), lastBType = {};
var chunkQueue = [], knownChunks = new Set(), lastCC = "";

var pendingChunks = {}, inflight = 0, needsBake = false, chunkWorker = null;

function K(x,y,z){ return x+","+y+","+z; }
function get(x,y,z){ return world.get(K(x,y,z)) || null; }
function isSolid(b){ return !!b && b !== "water"; }
function getS(x,y,z){ var b = get(x,y,z); return isSolid(b) ? b : null; }
function rnd(x,y,z,s){
  var h = (x*374761393 + y*668265263 + z*2147483647 + (s||SEED)*1442695041)|0;
  h = (h^(h>>13))|0; h = (h*1274126177)|0; h = (h^(h>>16))>>>0;
  return h/4294967295;
}

// ---------- materiais ----------
var TRANSP = {water:1, glass:1}; // resto é opaco
function isOpaque(b){ return !!b && !TRANSP[b]; }
var texCache = {};
function tex(n, opt){
  var ck = n + JSON.stringify(opt||{});
  if(texCache[ck]) return texCache[ck];
  var t = new THREE.TextureLoader().load("./assets/textures/"+n+".png");
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
  var m = new THREE.MeshLambertMaterial(Object.assign({map:t}, opt||{}));
  texCache[ck] = m; return m;
}
// slot: side/top/bot (bloco de 1 textura usa o mesmo nos 3)
function slotMats(b){
  if(b==="grass") return {side:tex("grass_dirt"), top:tex("grass"), bot:tex("dirt")};
  if(b==="wood") return {side:tex("tree_side"), top:tex("tree_top"), bot:tex("tree_top")};
  if(b==="leaves") return {side:tex("leaves_opaque"), top:tex("leaves_opaque"), bot:tex("leaves_opaque")};
  if(b==="glass") return {side:tex("glass",{transparent:true,opacity:0.55}), top:tex("glass",{transparent:true,opacity:0.55}), bot:tex("glass",{transparent:true,opacity:0.55})};
  if(b==="water") return {side:tex("water",{transparent:true,opacity:0.75}), top:tex("water",{transparent:true,opacity:0.75}), bot:tex("water",{transparent:true,opacity:0.75})};
  var m = tex(b); return {side:m, top:m, bot:m};
}
function slotFor(dir){ return dir==='+y' ? 'top' : (dir==='-y' ? 'bot' : 'side'); }
// ---------- terreno (fallback sync; worker tem cópia) ----------
function gh(x,z){
  var seedF = SEED*0.001;
  var wx = LevelNoise.simplex(x*0.02+seedF+9.1, z*0.02-seedF+3.7);
  var wz = LevelNoise.simplex(x*0.02-seedF-2.3, z*0.02+seedF+7.9);
  var qx = x+wx*48, qz = z+wz*48;
  var cont = LevelNoise.simplexFbm(qx*0.012+seedF, qz*0.012-seedF, 3);
  var base = LevelNoise.perlin(qx*0.055, qz*0.055);
  var det = LevelNoise.perlin(qx*0.17+300, qz*0.17-150);
  var r = LevelNoise.ridged(qx*0.02+500, qz*0.02-300, 4);
  var mask = Math.max(0, cont-0.38)*3.2; if(mask>1) mask=1; mask=mask*mask;
  var plain = Math.max(0, 0.30-Math.abs(cont-0.05))*8;
  var h = 11 + cont*7 + base*4.5 + det*2 - plain + r*mask*24;
  return Math.max(3, Math.floor(h));
}
function fillChunk(cx,cz){
  for(var x=0;x<CS;x++) for(var z=0;z<CS;z++){
    var wx=cx*CS+x, wz=cz*CS+z, h=gh(wx,wz);
    for(var y=0;y<=h;y++){
      var b = y===0 ? "rock" : (y===h ? (h<=SEA+1?"sand":"grass") : (y>h-3?"dirt":(rnd(wx,y,wz)<0.08?"rock":"stone")));
      world.set(K(wx,y,wz), b);
    }
    if(h>SEA+1 && ((wx*31+wz*17+SEED)&31)<2){
      var th = 3+((rnd(wx,h,wz,SEED+7)*2)|0);
      for(var i=1;i<=th;i++) world.set(K(wx,h+i,wz),"wood");
      for(var dx=-2;dx<=2;dx++) for(var dz=-2;dz<=2;dz++) for(var dy=0;dy<2;dy++){
        if(Math.abs(dx)===2 && Math.abs(dz)===2) continue;
        var k = K(wx+dx,h+th-1+dy,wz+dz);
        if(!world.has(k)) world.set(k,"leaves");
      }
      world.set(K(wx,h+th+1,wz),"leaves");
    }
    if(h<SEA) for(var w=h+1;w<=SEA;w++) world.set(K(wx,w,wz),"water");
  }
}
function fillChunkWithEdits(cx,cz){ fillChunk(cx,cz); if(WORLD_ID) applyEditsChunk(cx,cz); }

// ---------- worker ----------
function bootWorker(){
  try { chunkWorker = new Worker('./assets/js/RandomLevelWorker.js'); }
  catch(e){ chunkWorker = null; return; }
  chunkWorker.onmessage = function(e){
    var m = e.data; if(!m || m.type !== 'chunk') return;
    var id = m.cx+','+m.cz;
    if(pendingChunks[id]){ delete pendingChunks[id]; inflight = Math.max(0, inflight-1); }
    if(!knownChunks.has(id)){
      for(var i=0;i<m.blocks.length;i++){
        var r = m.blocks[i], k = K(r[0],r[1],r[2]);
        if(r[3]==='leaves' && world.has(k)) continue;
        world.set(k, r[3]);
      }
      if(WORLD_ID) applyEditsChunk(m.cx, m.cz);
      knownChunks.add(id);
      bakeChunk(m.cx, m.cz);
    }
    updateChunkStatus();
  };
  chunkWorker.onerror = function(){ chunkWorker = null; };
}
function genSync(cx,cz){ fillChunkWithEdits(cx,cz); knownChunks.add(cx+','+cz); }
var _lastStTxt = '';
function updateChunkStatus(){
  var st = document.getElementById('stChunk'); if(!st) return;
  var left = chunkQueue.length + inflight;
  var txt = left>0 ? ('gerando chunks... ('+left+' na fila)')
    : ('chunks '+knownChunks.size+' prontos ('+realR+'R)');
  if(txt !== _lastStTxt){ _lastStTxt = txt; st.textContent = txt; }
}

// ---------- bake POR CHUNK: só faces visíveis, 1 mesh/chunk, culling real ----------
// tabelas verificadas: (B-A)x(C-A) == normal
var FACES = [
  {d:'+x', n:[1,0,0],  o:[1,0,0],  v:[[1,0,1],[1,0,0],[1,1,0],[1,1,1]]},
  {d:'-x', n:[-1,0,0], o:[-1,0,0], v:[[0,0,0],[0,0,1],[0,1,1],[0,1,0]]},
  {d:'+y', n:[0,1,0],  o:[0,1,0],  v:[[0,1,0],[0,1,1],[1,1,1],[1,1,0]]},
  {d:'-y', n:[0,-1,0], o:[0,-1,0], v:[[0,0,0],[1,0,0],[1,0,1],[0,0,1]]},
  {d:'+z', n:[0,0,1],  o:[0,0,1],  v:[[0,0,1],[1,0,1],[1,1,1],[0,1,1]]},
  {d:'-z', n:[0,0,-1], o:[0,0,-1], v:[[1,0,0],[0,0,0],[0,1,0],[1,1,0]]}
];
var FACE_UV = [0,0, 1,0, 1,1, 0,1];
function chunkId(cx,cz){ return cx+","+cz; }
function disposeChunkMeshes(id){
  var m = chunkMeshes[id]; if(!m) return;
  scene.remove(m); if(m.geometry) m.geometry.dispose();
  delete chunkMeshes[id];
}
function bakeChunk(cx,cz){
  var id = chunkId(cx,cz);
  disposeChunkMeshes(id);
  var groups = {}; // "tipo:slot" -> {mat, pos, nor, uv, idx}
  var x, y, z, f, nb, key, g;
  for(x=cx*CS;x<cx*CS+CS;x++) for(z=cz*CS;z<cz*CS+CS;z++) for(y=0;y<72;y++){
    var b = world.get(K(x,y,z)); if(!b) continue;
    var mats = slotMats(b);
    for(f=0;f<6;f++){
      var F = FACES[f];
      nb = world.get(K(x+F.o[0], y+F.o[1], z+F.o[2]));
      if(isOpaque(nb)) continue;              // vizinho opaco esconde
      if(nb === b) continue;                  // mesmo tipo (água/água, vidro/vidro) esconde
      if(!TRANSP[b] && nb && TRANSP[nb]){ /* sólido ao lado de água: desenha */ }
      key = b + ':' + slotFor(F.d);
      g = groups[key];
      if(!g){ g = groups[key] = {mat:mats[slotFor(F.d)], pos:[], nor:[], uv:[], idx:[]}; }
      var base = g.pos.length/3, v;
      for(v=0;v<4;v++){
        g.pos.push(x+F.v[v][0], y+F.v[v][1], z+F.v[v][2]);
        g.nor.push(F.n[0], F.n[1], F.n[2]);
        g.uv.push(FACE_UV[v*2], FACE_UV[v*2+1]);
      }
      g.idx.push(base, base+1, base+2, base, base+2, base+3);
    }
  }
  var keys = Object.keys(groups);
  if(!keys.length) return;
  var geo = new THREE.BufferGeometry(), matsArr = [], start = 0, k;
  var P = [], N = [], U = [], I = [];
  for(k=0;k<keys.length;k++){
    g = groups[keys[k]];
    var vc = g.pos.length/3;
    for(var i=0;i<g.pos.length;i++) P.push(g.pos[i]);
    for(var j=0;j<g.nor.length;j++) N.push(g.nor[j]);
    for(var u=0;u<g.uv.length;u++) U.push(g.uv[u]);
    for(var w=0;w<g.idx.length;w++) I.push(g.idx[w]+start);
    geo.addGroup(start === 0 ? 0 : I.length - g.idx.length, g.idx.length, k);
    matsArr.push(g.mat);
    start += vc;
  }
  geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  geo.setIndex(I);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx*CS+8, 24, cz*CS+8), 46);
  var mesh = new THREE.Mesh(geo, matsArr.length === 1 ? matsArr[0] : matsArr);
  scene.add(mesh);
  chunkMeshes[id] = mesh;
}
function rebakeAround(x,z){
  var cx = Math.floor(x/CS), cz = Math.floor(z/CS);
  bakeChunk(cx,cz);
  var lx = x-cx*CS, lz = z-cz*CS;
  if(lx===0) bakeChunk(cx-1,cz);
  if(lx===CS-1) bakeChunk(cx+1,cz);
  if(lz===0) bakeChunk(cx,cz-1);
  if(lz===CS-1) bakeChunk(cx,cz+1);
}
// ---------- stream ----------
function chunksAround(r){
  var ccx = Math.floor(px/CS), ccz = Math.floor(pz/CS), out = [];
  for(var dx=-r;dx<=r;dx++) for(var dz=-r;dz<=r;dz++) out.push([ccx+dx, ccz+dz]);
  return out;
}
function clearFar(chunks){
  var keep = {};
  chunks.forEach(function(c){ keep[c[0]+","+c[1]] = 1; });
  Array.from(world.keys()).forEach(function(k){
    var p = k.split(",");
    var cx = Math.floor((+p[0])/CS), cz = Math.floor((+p[2])/CS);
    if(!keep[cx+","+cz]) world.delete(k);
  });
}
function ensureGround(){
  var fx = Math.floor(px), fz = Math.floor(pz), guard = 0;
  while((getS(fx,Math.floor(py),fz)||getS(fx,Math.floor(py+1.6),fz)) && guard++<60) py += 1;
  guard = 0;
  while(!getS(fx,Math.floor(py)-1,fz) && guard++<60 && py>2) py -= 1;
  if(!getS(fx,Math.floor(py)-1,fz)) py += 3;
}
function stream(){
  var ccx = Math.floor(px/CS), ccz = Math.floor(pz/CS), id = ccx+","+ccz;
  if(id === lastCC && chunkQueue.length === 0) return; lastCC = id;
  var cs = chunksAround(realR), want = {};
  cs.forEach(function(c){ want[c[0]+","+c[1]] = 1; });
  cs.forEach(function(c){
    var cid = c[0]+","+c[1];
    if(!knownChunks.has(cid) && !pendingChunks[cid] && chunkQueue.indexOf(cid)<0) chunkQueue.push(cid);
  });
  if(chunkWorker){
    var guard = 0;
    while(chunkQueue.length && inflight < 4 && guard++ < 40){
      var qid = chunkQueue.shift(), parts = qid.split(",");
      var qx = +parts[0], qz = +parts[1];
      if(knownChunks.has(qid) || pendingChunks[qid]) continue;
      pendingChunks[qid] = 1; inflight++;
      chunkWorker.postMessage({type:'gen', cx:qx, cz:qz, seed:SEED});
    }
  } else {
    var did = 0;
    while(chunkQueue.length && did < 6){
      var q2 = chunkQueue.shift(), p2 = q2.split(",");
      if(knownChunks.has(q2)) continue;
      genSync(+p2[0], +p2[1]); bakeChunk(+p2[0], +p2[1]); did++;
    }
  }
  if(id !== stream._lucc || realR !== stream._lR){ // centro OU raio mudou
    stream._lucc = id; stream._lR = realR;
    Object.keys(pendingChunks).forEach(function(pid){
      if(!want[pid]){ delete pendingChunks[pid]; inflight = Math.max(0, inflight-1); }
    });
    Array.from(knownChunks).forEach(function(kid){ if(!want[kid]){ knownChunks.delete(kid); disposeChunkMeshes(kid); } });
    clearFar(cs);
  }
  ensureGround();
  updateChunkStatus();
}

// ---------- pick (DDA) ----------
function eye(){ return new THREE.Vector3(px, py+1.6, pz); }
function dirV(){ return new THREE.Vector3(-Math.sin(yaw)*Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw)*Math.cos(pitch)); }
function pick(){
  var o = eye(), d = dirV(), maxD = 7;
  var x = Math.floor(o.x), y = Math.floor(o.y), z = Math.floor(o.z);
  var stx = d.x>0?1:-1, sty = d.y>0?1:-1, stz = d.z>0?1:-1;
  var tdx = Math.abs(1/(d.x||1e-9)), tdy = Math.abs(1/(d.y||1e-9)), tdz = Math.abs(1/(d.z||1e-9));
  var tmx = (stx>0?(x+1-o.x):(o.x-x))*tdx;
  var tmy = (sty>0?(y+1-o.y):(o.y-y))*tdy;
  var tmz = (stz>0?(z+1-o.z):(o.z-z))*tdz;
  var nx = 0, ny = 0, nz = 0, t = 0;
  for(var i=0;i<64;i++){
    if(tmx<tmy && tmx<tmz){ x+=stx; t=tmx; tmx+=tdx; nx=-stx; ny=0; nz=0; }
    else if(tmy<tmz){ y+=sty; t=tmy; tmy+=tdy; nx=0; ny=-sty; nz=0; }
    else { z+=stz; t=tmz; tmz+=tdz; nx=0; ny=0; nz=-stz; }
    if(t > maxD) return null;
    if(getS(x,y,z)) return {bx:x, by:y, bz:z, n:{x:nx, y:ny, z:nz}};
  }
  return null;
}

// ---------- UI ----------
var INV = ["grass","dirt","stone","wood","leaves","sand","glass","gold","rock"];
function buildBar(){
  var hb = document.getElementById("hotbar"); hb.innerHTML = "";
  INV.forEach(function(b,i){
    var d = document.createElement("div");
    d.className = "slot"+(i===sel?" sel":"");
    d.style.backgroundImage = "url(./assets/textures/"+b+".png)";
    d.onclick = function(){ sel = i; buildBar(); };
    hb.appendChild(d);
  });
}
function buildMenu(){
  var g = document.getElementById("grid"); g.innerHTML = "";
  INV.concat(["water"]).forEach(function(b){
    var im = document.createElement("img");
    im.src = "./assets/textures/"+b+".png";
    im.onclick = function(){ var ix = INV.indexOf(b); sel = ix<0?0:ix; buildBar(); toggleMenu(false); };
    g.appendChild(im);
  });
}
function toggleMenu(f){
  var m = document.getElementById("menu");
  var s = (typeof f === "boolean") ? f : m.classList.contains("hidden");
  m.classList.toggle("hidden", !s);
}

// ---------- save (IndexedDB) ----------
var idb = null, saveT = null;
function db(){
  if(idb) return Promise.resolve(idb);
  return new Promise(function(res, rej){
    var r = indexedDB.open("blocknet", 1);
    r.onupgradeneeded = function(){
      var d = r.result;
      if(!d.objectStoreNames.contains("worlds")) d.createObjectStore("worlds", {keyPath:"id", autoIncrement:true});
      if(!d.objectStoreNames.contains("edits")){ var s = d.createObjectStore("edits", {keyPath:"k"}); s.createIndex("wid","wid"); }
    };
    r.onsuccess = function(){ idb = r.result; res(idb); };
    r.onerror = function(){ rej(r.error); };
  });
}
function dbAddWorld(w){ return db().then(function(d){ return new Promise(function(res,rej){ var q = d.transaction("worlds","readwrite").objectStore("worlds").add(w); q.onsuccess = function(){res(q.result);}; q.onerror = function(){rej(q.error);}; }); }); }
function dbGetWorlds(){ return db().then(function(d){ return new Promise(function(res,rej){ var q = d.transaction("worlds").objectStore("worlds").getAll(); q.onsuccess = function(){res(q.result||[]);}; q.onerror = function(){rej(q.error);}; }); }); }
function dbPutWorld(w){ return db().then(function(d){ try{ d.transaction("worlds","readwrite").objectStore("worlds").put(w); }catch(e){} }); }
function dbDelWorld(id){
  return db().then(function(d){
    var t = d.transaction(["worlds","edits"],"readwrite");
    t.objectStore("worlds").delete(id);
    var q = t.objectStore("edits").index("wid").openCursor(IDBKeyRange.only(id));
    q.onsuccess = function(){ var c = q.result; if(c){ c.delete(); c.continue(); } };
  });
}
function dbLoadEdits(wid){
  return db().then(function(d){ return new Promise(function(res){
    try{
      var q = d.transaction("edits").objectStore("edits").index("wid").getAll(wid);
      q.onsuccess = function(){ res(q.result||[]); }; q.onerror = function(){ res([]); };
    }catch(e){ res([]); }
  }); });
}
function dbPutEdit(wid,k,b){ return db().then(function(d){ try{ d.transaction("edits","readwrite").objectStore("edits").put({k:wid+":"+k, wid:wid, xyz:k, b:b}); }catch(e){} }); }
function applyEditsChunk(cx,cz){
  edits.forEach(function(b,xyz){
    var p = xyz.split(",").map(Number);
    if(Math.floor(p[0]/CS)===cx && Math.floor(p[2]/CS)===cz){
      if(b) world.set(K(p[0],p[1],p[2]), b); else world.delete(K(p[0],p[1],p[2]));
    }
  });
}
function saveMeta(){
  if(!WORLD_ID) return;
  clearTimeout(saveT);
  saveT = setTimeout(function(){
    dbGetWorlds().then(function(ws){
      var w = null;
      ws.forEach(function(x){ if(x.id===WORLD_ID) w = x; });
      if(!w) return;
      w.px = px; w.py = py; w.pz = pz; w.yaw = yaw; w.sel = sel; w.ts = Date.now();
      dbPutWorld(w);
    });
  }, 800);
}
function setB(x,y,z,b){
  if(x == null) return;
  if(b){
    var pfx = Math.floor(px), pfy0 = Math.floor(py), pfy1 = Math.floor(py+1.6), pfz = Math.floor(pz);
    if(x===pfx && (y===pfy0||y===pfy1) && z===pfz) return;
  }
  var kk = K(x,y,z), prev = world.get(kk);
  if(b) world.set(kk, b); else world.delete(kk);
  if(WORLD_ID){ edits.set(kk, b||null); dbPutEdit(WORLD_ID, kk, b||null); saveMeta(); }
  if(!b) lastBType[kk] = prev;
  rebakeAround(x, z);
}

// ---------- boot ----------
function preloadShort(done){
  var need = ["grass","grass_dirt","dirt","stone","tree_side","tree_top","leaves_opaque","sand","rock","water","glass","gold"];
  var el = document.querySelector("#load p"), fill = document.querySelector("#load .fill"), sm = document.querySelector("#load small");
  var ok = 0, t0 = performance.now();
  need.forEach(function(n){
    var img = new Image();
    img.onload = img.onerror = function(){
      ok++;
      var el2 = (performance.now()-t0)/1000, pc = Math.round(ok/need.length*100);
      el.textContent = "Recebendo assets... "+pc+"% ("+ok+"/"+need.length+")";
      fill.style.width = pc+"%";
      sm.textContent = "texturas originais BlockNet • "+pc+"%";
      if(ok >= need.length) done();
    };
    img.src = "./assets/textures/"+n+".png";
  });
}
function wireSettings(){
  var r = document.getElementById("rgReal");
  function sync(){
    realR = Math.min(16, Math.max(1, +r.value));
    document.getElementById("vReal").textContent = realR;
    chunkQueue.length = 0; // descarta fila do raio antigo
    lastCC = "";
  }
  r.oninput = sync; sync();
}
function waitChunks(list, onProg){
  list.forEach(function(c){
    var id = c[0]+','+c[1];
    if(!knownChunks.has(id) && !pendingChunks[id] && chunkQueue.indexOf(id)<0) chunkQueue.push(id);
  });
  var total = list.length;
  return new Promise(function(res){
    var finished = false;
    function tick(){
      if(finished) return;
      var have = 0, i;
      for(i=0;i<list.length;i++){ if(knownChunks.has(list[i][0]+','+list[i][1])) have++; }
      try{ onProg(have, total); }catch(e){}
      if(have >= total){ finished = true; res(); return; }
      if(chunkWorker){
        var g = 0;
        while(chunkQueue.length && inflight < 4 && g++ < 60){
          var qid = chunkQueue.shift(), pp = qid.split(',');
          if(knownChunks.has(qid) || pendingChunks[qid]) continue;
          pendingChunks[qid] = 1; inflight++;
          chunkWorker.postMessage({type:'gen', cx:+pp[0], cz:+pp[1], seed:SEED});
        }
      } else {
        var did = 0;
        while(chunkQueue.length && did < 8){
          var q2 = chunkQueue.shift(), p2 = q2.split(',');
          if(knownChunks.has(q2)) continue;
          genSync(+p2[0], +p2[1]); did++;
        }
        if(did) needsBake = true;
      }
      setTimeout(tick, 60);
    }
    setTimeout(function(){
      if(finished) return;
      list.forEach(function(c){
        var id = c[0]+','+c[1];
        if(!knownChunks.has(id)){
          if(pendingChunks[id]){ delete pendingChunks[id]; inflight = Math.max(0, inflight-1); }
          genSync(c[0], c[1]);
        }
      });
      needsBake = true;
    }, 25000);
    tick();
  });
}

function init(){
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb);
  scene.fog = new THREE.Fog(0x87ceeb, 40, 140);
  camera = new THREE.PerspectiveCamera(75, innerWidth/innerHeight, 0.1, 600);
  renderer = new THREE.WebGLRenderer({antialias:false, powerPreference:"low-power"});
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio||1, 1));
  document.getElementById("game").appendChild(renderer.domElement);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x557755, 1.0));
  var sun = new THREE.DirectionalLight(0xffffff, 0.6);
  sun.position.set(30, 50, 20); scene.add(sun);
  buildBar(); buildMenu(); wireSettings(); bootWorker();
  addEventListener("resize", function(){
    camera.aspect = innerWidth/innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
  var km = {KeyW:"f",ArrowUp:"f",KeyS:"b",ArrowDown:"b",KeyA:"l",ArrowLeft:"l",KeyD:"r",ArrowRight:"r",Space:"jump"};
  addEventListener("keydown", function(e){
    if(e.code==="KeyB"||e.code==="KeyE"){ toggleMenu(); return; }
    if(e.code==="F3"){ e.preventDefault(); document.getElementById("dbg").classList.toggle("hidden"); return; }
    if(e.code==="F5"){ e.preventDefault(); third = !third; return; }
    if(/^Digit[1-9]$/.test(e.code)){ sel = +e.code.slice(5)-1; buildBar(); }
    if(km[e.code]) keys[km[e.code]] = true;
    if(e.code==="Space") e.preventDefault();
  });
  addEventListener("keyup", function(e){ if(km[e.code]) keys[km[e.code]] = false; });
  var cv = renderer.domElement;
  cv.addEventListener("click", function(){ if(!("ontouchstart" in window) && cv.requestPointerLock) cv.requestPointerLock(); });
  addEventListener("mousemove", function(e){
    if(document.pointerLockElement === cv){
      yaw -= e.movementX*0.0025; pitch -= e.movementY*0.0025;
      pitch = Math.max(-1.5, Math.min(1.5, pitch));
    }
  });
  function hit(brk){
    var h = pick(); if(!h) return;
    if(brk){ if(get(h.bx,h.by,h.bz) !== "rock") setB(h.bx,h.by,h.bz,null); }
    else{
      var nx = h.bx+Math.round(h.n.x), ny = h.by+Math.round(h.n.y), nz = h.bz+Math.round(h.n.z);
      if(!get(nx,ny,nz)) setB(nx,ny,nz,INV[sel]);
    }
  }
  cv.addEventListener("mousedown", function(e){ hit(e.button===0); });
  cv.addEventListener("contextmenu", function(e){ e.preventDefault(); });
  // multitouch por identificador
  var moveIds = {};
  Array.prototype.forEach.call(document.querySelectorAll("#hud [data-m]"), function(btn){
    var k = btn.getAttribute("data-m");
    btn.addEventListener("touchstart", function(e){
      e.preventDefault();
      for(var i=0;i<e.changedTouches.length;i++){ moveIds[e.changedTouches[i].identifier] = k; keys[k] = true; }
    }, {passive:false});
    function off(e){
      e.preventDefault();
      for(var i=0;i<e.changedTouches.length;i++){ delete moveIds[e.changedTouches[i].identifier]; }
      keys[k] = Object.keys(moveIds).some(function(id){ return moveIds[id] === k; });
    }
    btn.addEventListener("touchend", off, {passive:false});
    btn.addEventListener("touchcancel", off, {passive:false});
  });
  function tb(id, fn){ document.getElementById(id).addEventListener("touchstart", function(e){ e.preventDefault(); fn(); }, {passive:false}); }
  tb("bJump", function(){ keys.jump = true; setTimeout(function(){ keys.jump = false; }, 160); });
  tb("bInv", function(){ toggleMenu(); });
  tb("bCam", function(){ third = !third; });
  tb("bBrk", function(){ hit(true); });
  tb("bPlc", function(){ hit(false); });
  tb("bSet", function(){ document.getElementById("set").classList.toggle("hidden"); });
  var lookId = null, lx = 0, ly = 0;
  addEventListener("touchstart", function(e){
    for(var i=0;i<e.changedTouches.length;i++){
      var t = e.changedTouches[i];
      if(t.target.tagName === "CANVAS" && lookId === null){ lookId = t.identifier; lx = t.clientX; ly = t.clientY; }
    }
  }, {passive:true});
  addEventListener("touchmove", function(e){
    for(var i=0;i<e.changedTouches.length;i++){
      var t = e.changedTouches[i];
      if(t.identifier === lookId){
        yaw -= (t.clientX-lx)*0.005; pitch -= (t.clientY-ly)*0.005;
        pitch = Math.max(-1.5, Math.min(1.5, pitch));
        lx = t.clientX; ly = t.clientY;
      }
    }
  }, {passive:true});
  function endT(e){ for(var i=0;i<e.changedTouches.length;i++){ if(e.changedTouches[i].identifier === lookId) lookId = null; } }
  addEventListener("touchend", endT); addEventListener("touchcancel", endT);

  preloadShort(function(){ showTitle(); });

  function enterWorld(w){
    WORLD_ID = w.id; SEED = w.seed; px = w.px; pz = w.pz; py = w.py; yaw = w.yaw||0; sel = w.sel||0;
    buildBar();
    world.clear(); edits.clear(); knownChunks.clear();
    chunkQueue = []; pendingChunks = {}; inflight = 0; needsBake = false; lastCC = "";
    Object.keys(chunkMeshes).forEach(disposeChunkMeshes);
    document.getElementById("title").classList.add("hidden");
    var ld = document.getElementById("load"); ld.style.display = "flex";
    dbLoadEdits(w.id).then(function(rows){
      rows.forEach(function(r){ edits.set(r.xyz, r.b); });
      var waitR = realR;
      var ccx0 = Math.floor(px/CS), ccz0 = Math.floor(pz/CS), cl = [];
      for(var ix=-waitR;ix<=waitR;ix++) for(var iz=-waitR;iz<=waitR;iz++) cl.push([ccx0+ix, ccz0+iz]);
      var lp = document.querySelector("#load p"), lf = document.querySelector("#load .fill");
      waitChunks(cl, function(have,total){
        var pc = Math.round(have/total*100);
        lp.textContent = "Gerando mundo... "+pc+"% ("+have+"/"+total+" chunks)";
        lf.style.width = pc+"%";
      }).then(function(){
        knownChunks.forEach(function(kid){ var pp = kid.split(','); bakeChunk(+pp[0], +pp[1]); });
        stream();
        if(w.fresh){
          (function findLand(){
            for(var r=0;r<64;r+=4) for(var a=0;a<8;a++){
              var sx2 = Math.round(8+Math.cos(a/8*6.283)*r), sz2 = Math.round(8+Math.sin(a/8*6.283)*r);
              if(gh(sx2,sz2) > SEA){ px = sx2+0.5; pz = sz2+0.5; return; }
            }
          })();
          for(var y=60;y>0;y--){ if(getS(Math.floor(px),y,Math.floor(pz))){ py = y+1.01; break; } }
          w.fresh = false; w.px = px; w.py = py; w.pz = pz; dbPutWorld(w);
        }
        ensureGround();
        ld.style.display = "none";
      });
    });
  }
  function showTitle(){
    var list = document.getElementById("wlist"), selId = null;
    function refresh(){
      dbGetWorlds().then(function(ws){
        ws.sort(function(a,b){ return (b.ts||0)-(a.ts||0); });
        list.innerHTML = ws.length ? "" : "<small>nenhum mundo — cria um aí</small>";
        ws.forEach(function(w){
          var d = document.createElement("div");
          d.className = "w"+(w.id===selId?" sel":"");
          d.textContent = w.name+" • "+new Date(w.ts||Date.now()).toLocaleDateString();
          d.onclick = function(){ selId = w.id; refresh(); };
          d.ondblclick = function(){ enterWorld(w); };
          list.appendChild(d);
        });
        list._ws = ws; list._sel = selId;
      });
    }
    refresh();
    document.getElementById("wnew").onclick = function(){
      var nm = (document.getElementById("wname").value||"Mundo").slice(0,20);
      dbAddWorld({name:nm, seed:(Math.random()*99999)|0, px:8.5, py:30, pz:8.5, yaw:0, sel:0, ts:Date.now(), fresh:true})
        .then(function(id){ selId = id; refresh(); document.getElementById("wname").value = ""; });
    };
    document.getElementById("wplay").onclick = function(){
      var ws = list._ws||[], w = null;
      ws.forEach(function(x){ if(x.id===list._sel) w = x; });
      if(w || ws[0]) enterWorld(w || ws[0]);
    };
    document.getElementById("wdel").onclick = function(){
      if(list._sel) dbDelWorld(list._sel).then(function(){ list._sel = null; refresh(); });
    };
  }

  // loop principal
  (function boot(){
    var last = performance.now(), acc = 0;
    setInterval(function(){ saveMeta(); }, 5000);
    addEventListener("pagehide", function(){
      if(!WORLD_ID) return;
      dbGetWorlds().then(function(ws){
        ws.forEach(function(x){
          if(x.id===WORLD_ID){ x.px=px; x.py=py; x.pz=pz; x.yaw=yaw; x.sel=sel; x.ts=Date.now(); dbPutWorld(x); }
        });
      });
    });
    var fpsEl = document.getElementById("fps"), fpsFrames = 0, fpsT = performance.now();
    (function loop(t){
      requestAnimationFrame(loop);
      var dt = Math.min(0.05, (t-last)/1000); last = t;
      fpsFrames++;
      var fnow = performance.now();
      if(fnow - fpsT >= 500){
        fpsEl.textContent = Math.round(fpsFrames*1000/(fnow-fpsT)) + " FPS";
        fpsFrames = 0; fpsT = fnow;
      }
      if(!WORLD_ID){ renderer.render(scene, camera); return; }
      var sp = 6*dt, f = (keys.f?1:0)-(keys.b?1:0), s = (keys.r?1:0)-(keys.l?1:0);
      var sin = Math.sin(yaw), cos = Math.cos(yaw);
      var dx = (-sin*f+cos*s)*sp, dz = (-cos*f-sin*s)*sp;
      var E = 0.3;
      function solidB(x,y,z){ return !!getS(Math.floor(x), Math.floor(y), Math.floor(z)); }
      function feetOk(x,z){
        return !solidB(x+E,py,z)&&!solidB(x-E,py,z)&&!solidB(x,py,z+E)&&!solidB(x,py,z-E)&&!solidB(x,py+1.6,z);
      }
      var steps = Math.max(1, Math.ceil(Math.abs(dx)/0.3)), si, tx;
      for(si=0;si<steps;si++){ tx = px+dx/steps; if(feetOk(tx,pz)) px = tx; else break; }
      steps = Math.max(1, Math.ceil(Math.abs(dz)/0.3));
      for(var sj=0;sj<steps;sj++){ var tz = pz+dz/steps; if(feetOk(px,tz)) pz = tz; else break; }
      vy = Math.max(-18, vy-26*dt);
      var dy = vy*dt, sub = Math.max(1, Math.ceil(Math.abs(dy)/0.3)), landed = false, sk, ty;
      for(sk=0;sk<sub;sk++){
        ty = py+dy/sub;
        var hitF = solidB(px+E,ty,pz)||solidB(px-E,ty,pz)||solidB(px,ty,pz+E)||solidB(px,ty,pz-E);
        var hitH = solidB(px,ty+1.7,pz);
        if(vy<=0 && hitF){ py = Math.floor(ty)+1.01; vy = 0; landed = true; break; }
        else if(vy>0 && hitH){ vy = 0; py = ty; break; }
        else py = ty;
      }
      py = Math.max(1, py);
      if(keys.jump && landed){ vy = 8.5; landed = false; }
      acc += dt; if(acc > 0.25){ acc = 0; stream(); }
      var e2 = eye(), d2 = dirV();
      if(third) camera.position.set(e2.x-d2.x*5, e2.y-d2.y*5+1, e2.z-d2.z*5);
      else camera.position.copy(e2);
      camera.rotation.order = "YXZ"; camera.rotation.y = yaw; camera.rotation.x = pitch;
      renderer.render(scene, camera);
      var d = document.getElementById("dbg");
      if(!d.classList.contains("hidden"))
        d.textContent = "XYZ "+px.toFixed(1)+" "+py.toFixed(1)+" "+pz.toFixed(1)+"\nchunks "+chunksAround(realR).length+"R"+realR+"\nF5 cam F3 debug B blocos";
    })(last);
  })();
}

if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
})();
