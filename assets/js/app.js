// BlockNet v4 — recriação limpa. THREE r128 global, worker de chunks, IndexedDB.
(function(){
"use strict";
window.__blocknet_booted = true;

var CS = 16, SEA = 12;
// ---- V2 noise (igual LevelNoiseV2.js: biomeAt do app TEM que bater com o worker) ----
var _v2nz=null,_v2seed=null;
function v2make(seed){
  var p=new Uint8Array(512),perm=new Uint8Array(256),i;
  for(i=0;i<256;i++)perm[i]=i;
  var s=seed>>>0||1;
  function rnd2(){s^=s<<13;s>>>=0;s^=s>>>17;s^=s<<5;s>>>=0;return s/4294967296;}
  for(i=255;i>0;i--){var j=(rnd2()*(i+1))|0,t=perm[i];perm[i]=perm[j];perm[j]=t;}
  for(i=0;i<512;i++)p[i]=perm[i&255];
  var G=[[1,1],[-1,1],[1,-1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]];
  var F2=0.5*(Math.sqrt(3)-1),G2=(3-Math.sqrt(3))/6;
  function dot(g,x,y){return g[0]*x+g[1]*y;}
  return function(xin,yin){
    var n0,n1,n2,s_=(xin+yin)*F2,i=Math.floor(xin+s_),j=Math.floor(yin+s_);
    var t=(i+j)*G2,X0=i-t,Y0=j-t,x0=xin-X0,y0=yin-Y0,i1,j1;
    if(x0>y0){i1=1;j1=0;}else{i1=0;j1=1;}
    var x1=x0-i1+G2,y1=y0-j1+G2,x2=x0-1+2*G2,y2=y0-1+2*G2;
    var ii=i&255,jj=j&255,t0=0.5-x0*x0-y0*y0,t1=0.5-x1*x1-y1*y1,t2=0.5-x2*x2-y2*y2;
    if(t0<0)n0=0;else{t0*=t0;n0=t0*t0*dot(G[p[ii+p[jj]]&7],x0,y0);}
    if(t1<0)n1=0;else{t1*=t1;n1=t1*t1*dot(G[p[ii+i1+p[jj+j1]]&7],x1,y1);}
    if(t2<0)n2=0;else{t2*=t2;n2=t2*t2*dot(G[p[ii+1+p[jj+1]]&7],x2,y2);}
    return 70*(n0+n1+n2);
  };
}
function v2NZ(seed){ if(!_v2nz||_v2seed!==seed){_v2nz=v2make(seed*1013904223+7);_v2seed=seed;} return _v2nz; }
function v2fbm(nz,x,y,oct,lac,gain){var a=0.5,f=1,sum=0,norm=0;for(var i=0;i<oct;i++){sum+=a*nz(x*f,y*f);norm+=a;a*=gain;f*=lac;}return sum/norm;}
var SEED = (Math.random()*9999)|0, WORLD_ID = null;
var scene, camera, renderer;
var chunks = {}; // id "cx,cz" -> Map(chaveNumérica -> bloco). Zero string por bloco.
function ck(x,z){ return Math.floor(x/CS)+","+Math.floor(z/CS); }
function lk(x,y,z){ return (x&15)|((z&15)<<4)|(y<<9); }
function cmap(x,z,create){
  var id = ck(x,z), m = chunks[id];
  if(!m && create){ m = chunks[id] = new Map(); }
  return m || null;
}
var chunkMeshes = {};
var realR = 2;
var keys = {}, sel = 0, third = false, yaw = 0, pitch = -0.4;
var px = 8.5, py = 20, pz = 8.5, vy = 0;
// modmenu bridge (injetor lê/escreve sem editar lógica do jogo)
try{ Object.defineProperty(window,'__px',{get:()=>px,set:v=>px=v}); Object.defineProperty(window,'__py',{get:()=>py,set:v=>py=v}); Object.defineProperty(window,'__pz',{get:()=>pz,set:v=>pz=v}); Object.defineProperty(window,'__vy',{get:()=>vy,set:v=>vy=v}); window.__getBlock=get; window.__sceneRef=()=>scene; window.__rendererRef=()=>renderer; window.__allMats=()=>MATLIST.slice(); window.__repatchAllMats=function(){ for(var k in texCache){ try{ var mm=texCache[k]; if(window.ShaderSys) window.ShaderSys.patchMaterial(mm); }catch(e){} } }; }catch(e){}
var edits = new Map(), editsByChunk = {}, lastBType = {};
function ckOf(x,z){ return Math.floor(x/CS)+','+Math.floor(z/CS); }
function idxEdit(xyz,b){ var p=xyz.split(',').map(Number); var id=ckOf(p[0],p[2]); var s=editsByChunk[id]; if(b){ if(!s){s=editsByChunk[id]=new Map();} s.set(xyz,b); } else if(s){ s.delete(xyz); } }
var chunkQueue = [], knownChunks = new Set(), lastCC = "";
var unloadQueue = []; // ids aguardando unload (8/frame, sem GC spike)

var pendingChunks = {}, inflight = 0, needsBake = false, chunkWorker = null;

function K(x,y,z){ return x+","+y+","+z; }
function get(x,y,z){ var m = cmap(x,z,false); return m ? (m.get(lk(x,y,z)) || null) : null; }
function has(x,y,z){ var m = cmap(x,z,false); return m ? m.has(lk(x,y,z)) : false; }
function setB_(x,y,z,b){ cmap(x,z,true).set(lk(x,y,z), b); }
function delB(x,y,z){ var m = cmap(x,z,false); if(m) m.delete(lk(x,y,z)); }
function isSolid(b){ return !!b && b !== "water"; }
function getS(x,y,z){ var b = get(x,y,z); return isSolid(b) ? b : null; }
function rnd(x,y,z,s){
  var h = (x*374761393 + y*668265263 + z*2147483647 + (s||SEED)*1442695041)|0;
  h = (h^(h>>13))|0; h = (h*1274126177)|0; h = (h^(h>>16))>>>0;
  return h/4294967295;
}

// ---------- materiais ----------
var TRANSP = {water:1, glass:1}; // agua/vidro nao ocluem
function isOpaque(b){ return !!b && !TRANSP[b] && b !== 'leaves_noclude'; }
var texCache = {};
var MATLIST = []; // todos os materiais p/ trocar lights on/off sem recriar nada
function tex(n, opt){
  var ck = n + JSON.stringify(opt||{});
  if(texCache[ck]) return texCache[ck];
  var t = new THREE.TextureLoader().load("./assets/textures/"+n+".png");
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestMipmapLinearFilter; t.generateMipmaps = true;
  var m = new THREE.MeshLambertMaterial(Object.assign({map:t}, opt||{}));
  m.userData.texName = n;
  texCache[ck] = m; MATLIST.push(m);
  return m;
}
var LITE_ON = true; // distant chunks: luz desligada = 1 draw em vez de N por luz
function applyLite(){
  for(var i=0;i<MATLIST.length;i++) MATLIST[i].lights = LITE_ON;
  for(var k in texCache) texCache[k].needsUpdate = true;
}
window.__CustomBlocks = window.__CustomBlocks || {};
function modTex(id, url, opt){
  var ck = 'mod:'+id+JSON.stringify(opt||{});
  if(texCache[ck]) return texCache[ck];
  if(!url){ return tex('stone', opt); }
  var img = new Image();
  try{ img.src = url; }catch(e){ return tex('stone', opt); }
  var t = new THREE.Texture(img);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestMipmapLinearFilter; t.generateMipmaps = true;
  img.onload = function(){ t.needsUpdate = true; };
  var m = new THREE.MeshLambertMaterial(Object.assign({map:t}, opt||{}));
  m.userData.texName = id; texCache[ck] = m; MATLIST.push(m);
  return m;
}
// slot: side/top/bot (bloco de 1 textura usa o mesmo nos 3)
function slotMats(b){
  var cb = window.__CustomBlocks[b];
  if(cb && cb.textures){
    var T = cb.textures, o = cb.transparent ? {transparent:true, opacity:(cb.opacity||0.8)} : {};
    if(cb.cutout) o = {transparent:true, alphaTest:0.5};
    var side = T.side||T.all, top = T.top||T.all, bot = T.bottom||T.bot||T.all;
    if(!side && !top && !bot){ return null; }
    try{
    return {side:modTex(b+':s',side||top||bot,o), top:modTex(b+':t',top||side||bot,o), bot:modTex(b+':b',bot||side||top,o)};
    }catch(e){ return null; }
  }
  if(b==="grass") return {side:tex("grass_dirt"), top:tex("grass"), bot:tex("dirt")};
  if(b==="wood") return {side:tex("tree_side"), top:tex("tree_top"), bot:tex("tree_top")};
  if(b==="leaves") return {side:tex("leaves",{transparent:true,alphaTest:0.5}), top:tex("leaves",{transparent:true,alphaTest:0.5}), bot:tex("leaves",{transparent:true,alphaTest:0.5})};
  if(b==="glass") return {side:tex("glass",{transparent:true,opacity:0.55}), top:tex("glass",{transparent:true,opacity:0.55}), bot:tex("glass",{transparent:true,opacity:0.55})};
  if(b==="water") return {side:tex("water",{transparent:true,opacity:0.75}), top:tex("water",{transparent:true,opacity:0.75}), bot:tex("water",{transparent:true,opacity:0.75})};
  if(b==="oak_log") return {side:tex("oak_log"), top:tex("oak_log_top"), bot:tex("oak_log_top")};
  if(b==="tnt") return {side:tex("tnt_side"), top:tex("tnt_top"), bot:tex("tnt_top")};
  if(b==="ice") return {side:tex("ice",{transparent:true,opacity:0.85}), top:tex("ice",{transparent:true,opacity:0.85}), bot:tex("ice",{transparent:true,opacity:0.85})};
  var m = tex(b); return {side:m, top:m, bot:m};
}
function slotFor(dir){ return dir==='+y' ? 'top' : (dir==='-y' ? 'bot' : 'side'); }
// ---------- terreno (fallback sync; IGUAL LevelNoiseV2.js: worker gera, app preve) ----------
function biomeAt(X, Z, SD){
  var seed = (SD === undefined) ? SEED : SD, nz = v2NZ(seed), sf = seed*0.001;
  var wx=v2fbm(nz,X*0.0011+sf,Z*0.0011-sf,3,2.03,0.5)*28;
  var wz=v2fbm(nz,X*0.0011-sf+300,Z*0.0011+sf+300,3,2.03,0.5)*28;
  var px=X+wx, pz=Z+wz;
  var cont=v2fbm(nz,px*0.00055+777+sf,pz*0.00055-777-sf,4,2.05,0.5);
  var hills=v2fbm(nz,px*0.004+sf,pz*0.004-sf,4,2.1,0.5);
  var detail=nz(px*0.02-500-sf,pz*0.02+500+sf)*1.5;
  var r1=1-Math.abs(v2fbm(nz,px*0.0016+200+sf,pz*0.0016-200-sf,4,2.1,0.5));
  var mount=r1*r1*88;
  var mask=cont*0.5+0.5, m=mask*mask*(3-2*mask);
  var h=Math.floor(13+hills*7*(1-m)+(hills*6+mount)*m+detail);
  if(h<3)h=3;
  var r2=Math.abs(v2fbm(nz,px*0.0012-900+sf,pz*0.0012+400-sf,3,2.0,0.5));
  var river=r2<0.035&&h>SEA-1;
  var moist=v2fbm(nz,px*0.006-400+sf*2,pz*0.006+200-sf,3,2.0,0.5);
  var type;
  if(river){ type='river'; }
  else if(h<=SEA-2){h=SEA-2;type='ocean';}
  else if(h<=SEA){type='beach';}
  else if(m>0.5&&h>SEA+14){type='mountain';}
  else if(moist>0.1){type='forest';}
  else if(moist<-0.25){type='desert';}
  else{type='plains';}
  return {h:h, type:type, m:m, river:river};
}
function gh(x,z){ return biomeAt(x, z, SEED).h; }
function fillChunk(cx,cz){
  for(var x=0;x<CS;x++) for(var z=0;z<CS;z++){
    var wx=cx*CS+x, wz=cz*CS+z;
    var bi=biomeAt(wx,wz,SEED), h=bi.h, t=bi.type;
    for(var y=0;y<=h;y++){
      var b;
      if(y===0) b="bedrock";
      else if(y===1 && rnd(wx,y,wz,SEED+5)<0.5) b="bedrock";
      else if(t==="ocean") b = y===h?"sand":(y>h-2?"dirt":"stone");
      else if(t==="beach"||t==="desert") b = y===h?"sand":(y>h-3?"sand":"stone");
      else if(t==="mountain") b = y===h?(h>SEA+45?"snow":(h>SEA+30?"rock":(h>SEA+12?"stone":"grass"))):(y>h-3?(h>SEA+30?"stone":"dirt"):"stone");
      else b = y===h?"grass":(y>h-2?"dirt":"stone");
      if(b==="stone"){ // minerios no stone (raridade por altura)
        var or=rnd(wx,y,wz,SEED+99);
        if(y<=4 && or<0.02) b="diamond_ore";
        else if(y<=6 && or<0.045) b="gold_ore";
        else if(y<=14 && or<0.09) b="iron_ore";
        else if(or<0.12) b="coal_ore";
        else if(or>0.985) b="gravel";
      }
      if(b==="dirt" && rnd(wx,y,wz,SEED+31)<0.06) b="clay"; // manchas de argila na terra
      if(b==="sand" && t!=="ocean" && t!=="beach" && rnd(wx,y,wz,SEED+32)<0.15) b="gravel";
      if(y>2 && y<h-2){
        var nzc = v2NZ(SEED);
        var s1 = nzc(wx*0.045+wz*0.013+SEED*0.01, y*0.06-wz*0.02);
        var s2 = nzc(wx*0.02-wz*0.05-SEED*0.01, y*0.055+wx*0.017);
        if(Math.abs(s1) < 0.09 && Math.abs(s2) < 0.09) continue;
      }
      setB_(wx,y,wz,b);
    }
    // arvore estilo carvalho MC: hash por coluna (sem fila) + distancia minima 2bl (sem copa grudada)
    var td = t==="forest" ? 0.022 : (t==="plains" ? 0.006 : 0.0);
    var tree = rnd(wx,wz,7,SEED)<td;
    if(tree){
      var blocked=false;
      for(var ox=-1;ox<=1 && !blocked;ox++) for(var oz=-1;oz<=1 && !blocked;oz++){
        if(!ox && !oz) continue;
        if(rnd(wx+ox,wz+oz,7,SEED)<td*2) blocked=true;
      }
      if(blocked) tree=false;
    }
    if(tree && h>SEA && h<SEA+14 && bi.m < 0.3){
      var th = 4+((rnd(wx,h,wz,SEED+7)*2)|0);
      var top = h+th;
      for(var i=1;i<=th;i++) setB_(wx,h+i,wz,"wood");
      for(var dx=-2;dx<=2;dx++) for(var dz=-2;dz<=2;dz++){
        if(Math.abs(dx)===2 && Math.abs(dz)===2) continue;
        if(dx===0 && dz===0) continue;
        if(!has(wx+dx,top-1,wz+dz)) setB_(wx+dx,top-1,wz+dz,"leaves");
        if(!has(wx+dx,top,wz+dz)) setB_(wx+dx,top,wz+dz,"leaves");
      }
      for(var dx2=-1;dx2<=1;dx2++) for(var dz2=-1;dz2<=1;dz2++){
        if(dx2===0 && dz2===0) continue;
        if(!has(wx+dx2,top+1,wz+dz2)) setB_(wx+dx2,top+1,wz+dz2,"leaves");
      }
      if(!has(wx,top+1,wz)) setB_(wx,top+1,wz,"leaves");
      if(!has(wx,top+2,wz)) setB_(wx,top+2,wz,"leaves");
    }
    if(h<SEA) for(var w=h+1;w<=SEA;w++) setB_(wx,w,wz,"water");
  }
}
function fillChunkWithEdits(cx,cz){ fillChunk(cx,cz); if(WORLD_ID) applyEditsChunk(cx,cz); }

// ---------- worker ----------
var USE_V2 = true; // LevelNoiseV2 ativo, original desativado (arquivo continua la)
function bootWorker(){
  try { chunkWorker = new Worker(USE_V2 ? './assets/js/LevelNoiseV2.js' : './assets/js/RandomLevelWorker.js'); }
  catch(e){ chunkWorker = null; return; }
  chunkWorker.onmessage = function(e){
    var m = e.data; if(!m || m.type !== 'chunk') return;
    var id = m.cx+','+m.cz;
    if(pendingChunks[id]){ delete pendingChunks[id]; inflight = Math.max(0, inflight-1); }
    if(!knownChunks.has(id)){
      var cm = cmap(m.cx*CS, m.cz*CS, true);
      for(var i=0;i<m.blocks.length;i++){
        var r = m.blocks[i], li = lk(r[0],r[1],r[2]);
        if(cm.has(li)) continue; // primeiro a chegar vence: tronco antes da copa = sem folha flutuante
        cm.set(li, r[3]);
      }
      if(WORLD_ID) applyEditsChunk(m.cx, m.cz);
      knownChunks.add(id);
      if(!bakedSet[id]) bakeQueue.push(id); // dedup: nunca bakeja 2x o mesmo chunk
      // vizinho ja bakeado ganha face nova na borda (sem isso fica buraco no mapa)
      var nbs = [[m.cx+1,m.cz],[m.cx-1,m.cz],[m.cx,m.cz+1],[m.cx,m.cz-1]];
      for(var ni=0;ni<4;ni++){
        var nid = nbs[ni][0]+','+nbs[ni][1];
        if(bakedSet[nid]){ delete bakedSet[nid]; bakeQueue.push(nid); }
      }
    }
    pumpWorker();
    updateChunkStatus();
  };
  function pumpWorker(){ // mantem o worker sempre alimentado (lote por raio)
    if(!chunkWorker) return;
    var cap = 4, guard = 0; // 4 em voo: worker acompanha sem encher a fila de bake
    while(chunkQueue.length && inflight < cap && guard++ < 200){
      var qid = chunkQueue.shift(); delete queueSet[qid];
      var parts = qid.split(",");
      var qx = +parts[0], qz = +parts[1];
      if(knownChunks.has(qid) || pendingChunks[qid]) continue;
      pendingChunks[qid] = 1; inflight++;
      chunkWorker.postMessage({type:'gen', cx:qx, cz:qz, seed:SEED});
    }
  }
  window.__pumpWorker = pumpWorker;
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
  delete bakedSet[id]; // mesh sumiu: precisa rebakear se voltar
  var m = chunkMeshes[id]; if(!m) return;
  scene.remove(m); if(m.geometry) m.geometry.dispose();
  delete chunkMeshes[id]; // materiais/texturas sao cache compartilhado: NAO dispor
}
function quadG(groups, key, mat, q){ // q: [4 verts], n, uv opcional
  var g = groups[key];
  if(!g){ g = groups[key] = {mat:mat, pos:[], nor:[], uv:[], idx:[]}; }
  var base = g.pos.length/3;
  for(var v=0;v<4;v++){ g.pos.push(q[v][0],q[v][1],q[v][2]); g.nor.push(q[4][0],q[4][1],q[4][2]); }
  var uv = q[5]||[0,0,1,0,1,1,0,1];
  for(var u=0;u<4;u++) g.uv.push(uv[u*2],uv[u*2+1]);
  g.idx.push(base,base+1,base+2,base,base+2,base+3);
}
function emitGeo(groups, b, cb, mats, x, y, z){
  var shape = cb.shape;
  if(shape==='cross'){ // flor/planta: 2 planos cruzados, igual MC original
    var m = mats.side;
    quadG(groups, b+':side', m, [[x+0.15,y,z+0.15],[x+0.85,y,z+0.85],[x+0.85,y+1,z+0.85],[x+0.15,y+1,z+0.15],[0,0,1]]);
    quadG(groups, b+':side', m, [[x+0.85,y,z+0.15],[x+0.15,y,z+0.85],[x+0.15,y+1,z+0.85],[x+0.85,y+1,z+0.15],[0,0,1]]);
  } else if(shape==='slab'){ // meio bloco embaixo
    var mt = mats.top, ms = mats.side, mb = mats.bot, h = 0.5;
    quadG(groups, b+':top', mt, [[x,y+h,z],[x,y+h,z+1],[x+1,y+h,z+1],[x+1,y+h,z],[0,1,0]]);
    quadG(groups, b+':bot', mb, [[x,y,z],[x+1,y,z],[x+1,y,z+1],[x,y,z+1],[0,-1,0]]);
    quadG(groups, b+':side', ms, [[x,y,z+1],[x+1,y,z+1],[x+1,y+h,z+1],[x,y+h,z+1],[0,0,1]]);
    quadG(groups, b+':side', ms, [[x+1,y,z],[x,y,z],[x,y+h,z],[x+1,y+h,z],[0,0,-1]]);
    quadG(groups, b+':side', ms, [[x+1,y,z+1],[x+1,y,z],[x+1,y+h,z],[x+1,y+h,z+1],[1,0,0]]);
    quadG(groups, b+':side', ms, [[x,y,z],[x,y,z+1],[x,y+h,z+1],[x,y+h,z],[-1,0,0]]);
  }
}
function emitBoxes(groups, b, cb, mats, x, y, z){
  // boxes: [[x0,y0,z0,x1,y1,z1, slot?], ...] coords 0..1 (padrao MC json)
  for(var i=0;i<cb.boxes.length;i++){
    var B = cb.boxes[i], x0=x+B[0], y0=y+B[1], z0=z+B[2], x1=x+B[3], y1=y+B[4], z1=z+B[5];
    var sl = B[6]||'side', m = sl==='top'?mats.top:(sl==='bot'?mats.bot:mats.side);
    quadG(groups, b+':'+sl, m, [[x0,y1,z0],[x0,y1,z1],[x1,y1,z1],[x1,y1,z0],[0,1,0]]);
    quadG(groups, b+':'+sl, m, [[x0,y0,z0],[x1,y0,z0],[x1,y0,z1],[x0,y0,z1],[0,-1,0]]);
    quadG(groups, b+':'+sl, m, [[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1],[0,0,1]]);
    quadG(groups, b+':'+sl, m, [[x1,y0,z0],[x0,y0,z0],[x0,y1,z0],[x1,y1,z0],[0,0,-1]]);
    quadG(groups, b+':'+sl, m, [[x1,y0,z1],[x1,y0,z0],[x1,y1,z0],[x1,y1,z1],[1,0,0]]);
    quadG(groups, b+':'+sl, m, [[x0,y0,z0],[x0,y0,z1],[x0,y1,z1],[x0,y1,z0],[-1,0,0]]);
  }
}
function bakeChunk(cx,cz){
  var id = chunkId(cx,cz);
  disposeChunkMeshes(id);
  var groups = {}; // "tipo:slot" -> {mat, pos, nor, uv, idx}
  var x, y, z, f, nb, key, g, nx2, ny2, nz2;
  var cm0 = cmap(cx*CS, cz*CS, false);
  if(!cm0){ try{window.__log('bake '+id+' SKIP sem dados');}catch(e){} return; }
  cm0.forEach(function(b, li){
    var x = cx*CS+(li&15), z = cz*CS+((li>>4)&15), y = li>>9;
    var mats = null;
    try{ mats = slotMats(b); }catch(e){ mats = null; }
    if(!mats) return;
    var cb = window.__CustomBlocks[b];
    if(cb && cb.shape && cb.shape!=='cube'){
      emitGeo(groups, b, cb, mats, x, y, z);
      return;
    }
    if(cb && cb.boxes){
      emitBoxes(groups, b, cb, mats, x, y, z);
      return;
    }
    for(f=0;f<6;f++){
      var F = FACES[f];
      nx2 = x+F.o[0]; ny2 = y+F.o[1]; nz2 = z+F.o[2];
      if(Math.floor(nx2/CS)===cx && Math.floor(nz2/CS)===cz){ nb = cm0.get(lk(nx2,ny2,nz2)) || null; }
      else { nb = get(nx2,ny2,nz2); }
      // vizinho esconde a face, EXCETO: folha nunca esconde (tem furinho, precisa da face atras)
      if(nb === 'leaves'){ /* desenha sempre: chao sob folha, lateral atras da copa */ }
      else if(isOpaque(nb)) continue;         // vizinho opaco esconde
      else if(nb === b) continue;             // mesmo tipo esconde (agua/vidro/folha-folha: sem buraco lateral)
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
  });
  var keys = Object.keys(groups);
  if(!keys.length) return;
  var geo = new THREE.BufferGeometry(), matsArr = [], start = 0, k;
  // tamanho exato: 1 alocacao por atributo (sem push/concat que da GC spike)
  var nP = 0, nI = 0;
  for(k=0;k<keys.length;k++){ g = groups[keys[k]]; nP += g.pos.length; nI += g.idx.length; }
  var P = new Float32Array(nP), N = new Float32Array(nP), U = new Float32Array(nP/3*2);
  var I = (nP/3 > 65535) ? new Uint32Array(nI) : new Uint16Array(nI);
  var oP = 0, oU = 0, oI = 0;
  for(k=0;k<keys.length;k++){
    g = groups[keys[k]];
    var vc = g.pos.length/3;
    P.set(g.pos, oP); N.set(g.nor, oP); U.set(g.uv, oU);
    for(var w=0;w<g.idx.length;w++) I[oI+w] = g.idx[w]+start;
    geo.addGroup(oI, g.idx.length, k);
    matsArr.push(g.mat);
    start += vc; oP += g.pos.length; oU += g.uv.length; oI += g.idx.length;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(U, 2));
  geo.setIndex(new THREE.BufferAttribute(I, 1));
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  // esfera manual: centro do chunk + raio que cobre altura maxima (V2 alto)
  try{
    var bb = geo.boundingBox;
    var cxw = cx*CS+8, czw = cz*CS+8;
    var topY = bb.max.y, botY = Math.min(0, bb.min.y);
    var cy = (topY+botY)/2;
    var r = Math.sqrt(8*8+8*8+((topY-botY)/2)*((topY-botY)/2))+4;
    geo.boundingSphere.center.set(cxw, cy, czw);
    geo.boundingSphere.radius = r;
  }catch(e){}
  var mesh = new THREE.Mesh(geo, matsArr.length === 1 ? matsArr[0] : matsArr);
  mesh.frustumCulled = true; // culling de volta com esfera correta
  scene.add(mesh);
  chunkMeshes[id] = mesh;
  try{ window.__log('bake '+id+' faces='+I.length/3+' mats='+matsArr.length); }catch(e){}
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
function clearFar(){
  // restos caem no unload do stream (delete chunks[id]); aqui só garantia
}
var lastLandT = 0; // ultima vez que o loop confirmou pe no chao
function ensureGround(){
  if(vy !== 0 && vy !== undefined) { /* caindo/pulando: so corrige se ENTERRADO */
    var _fx = Math.floor(px), _fz = Math.floor(pz);
    var _buried = false;
    try{ _buried = !!getS(_fx, Math.floor(py-0.05), _fz); }catch(e){}
    if(!_buried) return; // caindo no ar: NAO encosta (era o teleporte na queda)
    // enterrado mesmo caindo: sobe ate sair (anti-fall-through)
    var _g = 0; while(_buried && _g++<60){ py += 0.2; try{ _buried = !!getS(_fx, Math.floor(py-0.05), _fz); }catch(e){ break; } }
    py = Math.floor(py-0.05)+1.01; vy = 0;
    return;
  }
  var m = null;
  try{ m = cmap(Math.floor(px), Math.floor(pz), false); }catch(e){}
  if(!m) return; // chunk sem dados: NAO mexe no py (era esse o nascer embaixo do chao)
  var m = null;
  try{ m = cmap(Math.floor(px), Math.floor(pz), false); }catch(e){}
  if(!m) return; // chunk sem dados: NAO mexe no py (era esse o nascer embaixo do chao)
  var fx = Math.floor(px), fz = Math.floor(pz), guard = 0;
  while(getS(fx,Math.floor(py-0.05),fz) && guard++<60) py += 0.2; // pe enterrado sobe
  guard = 0; var found = !!getS(fx,Math.floor(py-0.05)-1,fz);
  while(!found && guard++<80 && py>2){ py -= 1; if(getS(fx,Math.floor(py-0.05)-1,fz)){ found = true; break; } }
  if(!found){ // nada embaixo: procura solido p/ CIMA (spawn em caverna/ar), nunca p/ baixo
    for(var y=Math.floor(py); y<140; y++){ if(getS(fx,y,fz)){ py = y+1.01; break; } }
    return;
  }
  py = Math.floor(py-0.05)+1.01; // snap exato no chao (igual fisica)
}
var bakeQueue = []; // ids "cx,cz" aguardando bake (escalonado no loop)
var queueSet = {}; // dedup O(1) da chunkQueue (indexOf era O(n))
function sortQueue(ccx,ccz){ // perto primeiro: centro aparece rapido
  chunkQueue.sort(function(a,b){
    var pa = a.split(","), pb = b.split(",");
    var da = Math.max(Math.abs(+pa[0]-ccx), Math.abs(+pa[1]-ccz));
    var db = Math.max(Math.abs(+pb[0]-ccx), Math.abs(+pb[1]-ccz));
    return da-db;
  });
}
var __bakeBudget = 10; // ms por frame: chunk aparece rapido
var __lastFps = 60;
var __frameN = 0;
function pumpBakes(n){ // 1 bake/frame SEMPRE (sem shift em lote, sem budget estourado): nunca trava GPU
  if(!bakeQueue.length) return 0;
  var id = bakeQueue.shift();
  if(!knownChunks.has(id)) return 0;
  var pp = id.split(",");
  try{ bakeChunk(+pp[0], +pp[1]); }catch(e){}
  bakedSet[id] = 1;
  return 1;
}
var bakedSet = {}; // ids ja com mesh (load conta isso, nao so recebido)
function stream(force){
  var ccx = Math.floor(px/CS), ccz = Math.floor(pz/CS), id = ccx+","+ccz;
  if(!force && id === lastCC && chunkQueue.length === 0) return; lastCC = id;
  var cs = chunksAround(realR), want = {};
  cs.forEach(function(c){ want[c[0]+","+c[1]] = 1; });
  var added = false;
  cs.forEach(function(c){
    var cid = c[0]+","+c[1];
    if(!knownChunks.has(cid) && !pendingChunks[cid] && !queueSet[cid]){ chunkQueue.push(cid); queueSet[cid] = 1; added = true; }
  });
  if(added) sortQueue(ccx,ccz);
  if(chunkWorker){
    if(window.__pumpWorker) window.__pumpWorker();
  } else {
    var did = 0;
    while(chunkQueue.length && did < 2){
      var q2 = chunkQueue.shift(); delete queueSet[q2];
      var p2 = q2.split(",");
      if(knownChunks.has(q2)) continue;
      genSync(+p2[0], +p2[1]); bakeQueue.push(q2); did++;
    }
  }
  if(force || id !== stream._lucc || realR !== stream._lR){ // centro OU raio mudou
    stream._lucc = id; stream._lR = realR;
    Object.keys(pendingChunks).forEach(function(pid){
      if(!want[pid]){ delete pendingChunks[pid]; inflight = Math.max(0, inflight-1); }
    });
    // unload em lotes: no max 8 chunks/frame (evita GC spike no raio 16)
    var unl = [];
    Array.from(knownChunks).forEach(function(kid){ if(!want[kid]) unl.push(kid); });
    unloadQueue = unl;
    // limpa fila de bakes fora do raio
    bakeQueue = bakeQueue.filter(function(bid){ return !!want[bid]; });
    clearFar(cs);
  }
  ensureGround();
  updateChunkStatus();
}

// ---------- pick (DDA) ----------
function eye(){ return new THREE.Vector3(px, py+1.8, pz); }
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
var BLOCKS = [
 {id:"grass",n:"Grama",c:"nat"},{id:"dirt",n:"Terra",c:"nat"},{id:"stone",n:"Pedra",c:"nat"},
 {id:"sand",n:"Areia",c:"nat"},{id:"wood",n:"Madeira",c:"nat"},{id:"leaves",n:"Folhas",c:"nat"},
 {id:"glass",n:"Vidro",c:"build"},{id:"gold",n:"Ouro",c:"build"},{id:"rock",n:"Rocha",c:"build"},
 {id:"coal_ore",n:"Carvao",c:"ore"},{id:"iron_ore",n:"Ferro",c:"ore"},{id:"gold_ore",n:"Ouro bruto",c:"ore"},
 {id:"diamond_ore",n:"Diamante",c:"ore"},
 {id:"water",n:"Agua",c:"nat"},{id:"ice",n:"Gelo",c:"nat"},{id:"snow",n:"Neve",c:"nat"},
 {id:"clay",n:"Argila",c:"nat"},{id:"gravel",n:"Cascalho",c:"nat"},
 {id:"oak_log",n:"Tronco carvalho",c:"build"},{id:"oak_planks",n:"Tabua",c:"build"},
 {id:"bricks",n:"Tijolos",c:"build"},{id:"cobblestone",n:"Pedregulho",c:"build"},
 {id:"obsidian",n:"Obsidiana",c:"build"},{id:"bedrock",n:"Bedrock",c:"build"},{id:"tnt",n:"TNT",c:"build"}
];
var TABS = [["all","Tudo"],["nat","Natureza"],["build","Construcao"],["ore","Minerios"]];
var HOTBAR = ["grass","dirt","stone","wood","leaves","sand","glass","gold","rock"];
var pendBlock = null, mTab = "all", mQuery = "";
function texURL(b){ return "url(./assets/textures/"+b+".png)"; }
function palFiltered(){
  return BLOCKS.filter(function(b){
    if(mTab !== "all" && b.c !== mTab) return false;
    if(mQuery && b.n.toLowerCase().indexOf(mQuery)<0 && b.id.indexOf(mQuery)<0) return false;
    return true;
  });
}
function buildBar(){
  var hb = document.getElementById("hotbar"); hb.innerHTML = "";
  HOTBAR.forEach(function(b,i){
    var d = document.createElement("div");
    d.className = "slot"+(i===sel?" sel":"");
    d.style.backgroundImage = texURL(b);
    d.onclick = function(){ sel = i; buildBar(); saveMeta(); };
    hb.appendChild(d);
  });
}
function buildMenu(){
  var tabs = document.getElementById("mTabs"); tabs.innerHTML = "";
  TABS.forEach(function(t){
    var b = document.createElement("button");
    b.textContent = t[1]; b.className = t[0]===mTab?"on":"";
    b.onclick = function(){ mTab = t[0]; buildMenu(); };
    tabs.appendChild(b);
  });
  var hbRow = document.getElementById("mHot"); hbRow.innerHTML = "";
  HOTBAR.forEach(function(b,i){
    var d = document.createElement("div");
    d.className = "mslot"+(i===sel?" sel":"");
    d.style.backgroundImage = texURL(b);
    (function(idx){
      function slotIt(e){ if(e){ e.preventDefault(); e.stopPropagation(); }
        if(pendBlock){ HOTBAR[idx] = pendBlock; pendBlock = null; }
        sel = idx; buildBar(); buildMenu(); saveMeta();
      }
      d.onclick = slotIt;
      d.ontouchstart = slotIt;
    })(i);
    hbRow.appendChild(d);
  });
  var pal = document.getElementById("mPal"); pal.innerHTML = "";
  palFiltered().forEach(function(b){
    var im = document.createElement("img");
    im.src = "./assets/textures/"+b.id+".png"; im.title = b.n;
    if(b.id === pendBlock) im.className = "pend";
    var bid = b.id;
    function pickIt(e){ if(e) e.stopPropagation(); pendBlock = (pendBlock === bid ? null : bid); buildMenu(); }
    im.onclick = pickIt;
    im.ontouchstart = function(e){ e.preventDefault(); e.stopPropagation(); pickIt(); };
    pal.appendChild(im);
  });
  if(!pal.children.length){ pal.innerHTML = "<small>nada achado</small>"; }
  document.getElementById("mHint").textContent = pendBlock
    ? ("toque num slot p/ por "+pendBlock) : "toque no bloco, depois no slot p/ trocar";
}
function toggleMenu(f){
  var m = document.getElementById("menu");
  var s = (typeof f === "boolean") ? f : m.classList.contains("hidden");
  m.classList.toggle("hidden", !s);
  if(s){
    var sh = document.getElementById("sheet");
    sh.classList.remove("swipe"); sh.style.transform = "";
    var sq = document.getElementById("mSearch"); if(sq){ sq.value = ""; mQuery = ""; }
    buildMenu();
  }
}
function saveNow(){
  if(!WORLD_ID) return;
  dbGetWorlds().then(function(ws){
    ws.forEach(function(x){
      if(x.id===WORLD_ID){ x.px=px; x.py=py; x.pz=pz; x.yaw=yaw; x.sel=sel; x.hotbar=HOTBAR.slice(); x.ts=Date.now(); dbPutWorld(x); }
    });
  });
}
function exitWorld(){
  saveNow();
  WORLD_ID = null;
  Object.keys(chunkMeshes).forEach(disposeChunkMeshes);
  chunks = {}; knownChunks.clear(); bakedSet = {};
  chunkQueue = []; queueSet = {}; bakeQueue = []; unloadQueue = []; pendingChunks = {}; inflight = 0;
  document.getElementById("pause").classList.add("hidden");
  document.getElementById("title").classList.remove("hidden");
}
function wirePause(){
  document.getElementById("bPause").addEventListener("click", function(){
    if(!WORLD_ID) return;
    document.getElementById("pause").classList.remove("hidden");
  });
  document.getElementById("pBack").onclick = function(){ document.getElementById("pause").classList.add("hidden"); };
  document.getElementById("pSave").onclick = function(){ saveNow(); document.getElementById("pSave").textContent = "Salvo!"; setTimeout(function(){ document.getElementById("pSave").textContent = "Salvar mundo"; }, 1500); };
  document.getElementById("pExit").onclick = function(){ exitWorld(); };
  document.getElementById("bPause").addEventListener("touchstart", function(e){ e.preventDefault(); if(WORLD_ID) document.getElementById("pause").classList.remove("hidden"); }, {passive:false});
}
function wireSheet(){
  var m = document.getElementById("menu"), sh = document.getElementById("sheet");
  document.getElementById("mClose").onclick = function(){ toggleMenu(false); };
  document.getElementById("mSearch").addEventListener("input", function(e){
    mQuery = e.target.value.toLowerCase().trim(); buildMenu();
  });
  m.addEventListener("click", function(e){ if(e.target === m) toggleMenu(false); });
  // PC: B/E e 1-9 funcionam com inventario aberto
  document.addEventListener("keydown", function(e){
    if(document.getElementById("menu").classList.contains("hidden")) return;
    if(e.code === "Escape" || e.code === "KeyB" || e.code === "KeyE"){ toggleMenu(false); return; }
    var mt = e.code.match(/^Digit([1-9])$/);
    if(mt){ sel = +mt[1]-1; buildBar(); buildMenu(); }
  });
  // deslize: arrasta alca ou fundo p/ baixo fecha
  var y0 = null;
  sh.addEventListener("touchstart", function(e){ y0 = e.touches[0].clientY; sh.classList.add("swipe"); }, {passive:true});
  sh.addEventListener("touchmove", function(e){
    if(y0 === null) return;
    var dy = e.touches[0].clientY - y0;
    if(dy > 0) sh.style.transform = "translateY("+dy+"px)";
  }, {passive:true});
  sh.addEventListener("touchend", function(e){
    if(y0 === null) return;
    var dy = (e.changedTouches[0].clientY - y0);
    sh.classList.remove("swipe");
    if(dy > 90) toggleMenu(false); else sh.style.transform = "";
    y0 = null;
  });
}

// ---------- HUD config v2 por-botao (salva em settings.html) ----------
function applyHudCfg(){
  var o = null;
  try{ o = JSON.parse(localStorage.getItem("blocknet_hud")||"null"); }catch(e){ o = null; }
  if(!o || !o.btns || o.v !== 2) return; // sem config nova: HUD padrao do CSS
  var hud = document.getElementById("hud"); if(!hud) return;
  hud.style.display = "block"; hud.style.padding = "0";
  var W = innerWidth, H = innerHeight;
  function place(sel, c){
    var n = hud.querySelector('[data-m="'+sel+'"]') || document.getElementById(sel);
    if(!n) return;
    n.style.position = "fixed"; n.style.zIndex = "40";
    n.style.left = (c.x/100*W - c.s/2) + "px"; n.style.top = (c.y/100*H - c.s/2) + "px";
    n.style.width = c.s + "px"; n.style.height = c.s + "px"; n.style.opacity = c.op;
    n.style.margin = "0";
  }
  var k;
  var dm = {f:1,b:1,l:1,r:1};
  for(k in o.btns){ if(dm[k]) place(k, o.btns[k]); }
  for(k in o.btns){ if(!dm[k] && k !== "hotbar") place(k, o.btns[k]); }
  if(o.btns.hotbar){ var hb = document.getElementById("hotbar"), hc = o.btns.hotbar;
    if(hb){ hb.style.position = "fixed"; hb.style.zIndex = "25";
      hb.style.left = (hc.x/100*W) + "%"; hb.style.transform = "translateX(-50%)";
      hb.style.top = (hc.y/100*H - 22) + "px"; hb.style.bottom = "auto";
      hb.style.opacity = hc.op;
      var sc = Math.max(0.5, Math.min(1.6, hc.s/280));
      hb.style.zoom = sc; } }
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
  var s = editsByChunk[cx+','+cz];
  if(!s) return;
  s.forEach(function(b,xyz){
    var p = xyz.split(',').map(Number);
    if(b) setB_(p[0],p[1],p[2], b); else delB(p[0],p[1],p[2]);
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
      w.px = px; w.py = py; w.pz = pz; w.yaw = yaw; w.sel = sel; w.hotbar = HOTBAR.slice(); w.ts = Date.now();
      dbPutWorld(w);
    });
  }, 800);
}
window.__setBlock=function(x,y,z,b){ return setB(x,y,z,b); };
window.__BN = {
  THREE: function(){ return THREE; },
  scene: function(){ return scene; }, camera: function(){ return camera; }, renderer: function(){ return renderer; },
  get: function(x,y,z){ return get(x,y,z); }, set: function(x,y,z,b){ return setB(x,y,z,b); },
  blast: function(x,y,z,r){ // explosao ASSINCRONA fatiada: apaga aos poucos, rebake na fila (zero freeze, zero chao preto)
    x|=0; y|=0; z|=0; r=r||2;
    var cells = [];
    for(var dx=-r;dx<=r;dx++) for(var dy=-r;dy<=r;dy++) for(var dz=-r;dz<=r;dz++){
      if(dx*dx+dy*dy+dz*dz > r*r+1) continue;
      cells.push([x+dx, y+dy, z+dz]);
    }
    var dirty = {}, i = 0;
    function slice(){
      var n = 0;
      while(i < cells.length && n < 8){ // 8 blocos/frame: nem sente
        var c = cells[i++]; n++;
        try{
          var prev = get(c[0],c[1],c[2]);
          if(prev && prev!=="air" && prev!=="bedrock"){
            var kk = K(c[0],c[1],c[2]);
            delB(c[0],c[1],c[2]);
            lastBType[kk] = prev;
            if(WORLD_ID){ edits.set(kk, null); idxEdit(kk, null); }
            var cid = ckOf(c[0],c[2]); dirty[cid] = 1;
          }
        }catch(e){}
      }
      if(i < cells.length){ setTimeout(slice, 16); return; }
      // terminou: 1 escrita no banco (transacao unica) + rebake via FILA (1/frame, sem freeze)
      try{
        if(WORLD_ID){
          db().then(function(d){
            try{
              var t = d.transaction("edits","readwrite").objectStore("edits");
              cells.forEach(function(c){
                var k2 = K(c[0],c[1],c[2]);
                if(edits.get(k2)===null) t.put({k:WORLD_ID+":"+k2, wid:WORLD_ID, xyz:k2, b:null});
              });
            }catch(e){}
          });
          saveMeta();
        }
      }catch(e){}
      Object.keys(dirty).forEach(function(cid){
        try{ delete bakedSet[cid]; if(bakeQueue.indexOf(cid)<0) bakeQueue.push(cid); }catch(e){}
      });
    }
    slice();
  },
  rebake: function(x,z){ return rebakeAround(x,z); },
  bakeChunk: function(cx,cz){ return bakeChunk(cx,cz); },
  FACES: FACES, chunks: chunks, chunkMeshes: chunkMeshes,
  biome: function(x,z){ try{ return biomeAt(x,z,SEED); }catch(e){ return null; } },
  setRender: function(r){ try{ realR = Math.max(1, Math.min(16, r|0)); var rg = document.getElementById('rgReal'); if(rg) rg.value = realR; var v = document.getElementById('vReal'); if(v) v.textContent = realR; lastCC=''; stream(true); }catch(e){} },
  player: { get x(){return px;}, set x(v){px=v;}, get y(){return py;}, set y(v){py=v;}, get z(){return pz;}, set z(v){pz=v;} },
  on: function(ev, fn){ document.addEventListener('bn:'+ev, fn); },
  emit: function(ev, d){ document.dispatchEvent(new CustomEvent('bn:'+ev, {detail:d})); },
  // entidades 3D externas (GLB/GLTF/OBJ/FBX): rastreadas p/ remocao e save
  _ents: {},
  spawnModel: function(url, opt){
    // opt: {x,y,z, scale, ry, name} — detecta tipo pela extensao
    opt = opt||{};
    var self = this;
    var ext = String(url).split('.').pop().split('?')[0].toLowerCase();
    function put(obj){
      obj.position.set(opt.x!==undefined?opt.x:px+2, opt.y!==undefined?opt.y:py+1, opt.z!==undefined?opt.z:pz);
      var s = opt.scale||1; obj.scale.set(s,s,s);
      if(opt.ry) obj.rotation.y = opt.ry;
      obj.frustumCulled = false;
      scene.add(obj);
      var id = 'ent_'+Date.now().toString(36)+((Math.random()*999)|0);
      self._ents[id] = { obj: obj, url: url, clips: opt._clips||[], opt: {x:obj.position.x, y:obj.position.y, z:obj.position.z, scale:s, ry:opt.ry||0} };
      return id;
    }
    return new Promise(function(res, rej){
      try{
        if(ext==='obj'){
          new THREE.OBJLoader().load(url, function(o){ res(put(o)); }, undefined, function(e){ rej(e); });
        } else if(ext==='fbx'){
          new THREE.FBXLoader().load(url, function(o){ res(put(o)); }, undefined, function(e){ rej(e); });
        } else { // glb/gltf — guarda clips p/ animacao
          new THREE.GLTFLoader().load(url, function(g){
            opt._clips = g.animations||[];
            res(put(g.scene||g.scenes[0]));
          }, undefined, function(e){ rej(e); });
        }
      }catch(e){ rej(e); }
    });
  },
  removeModel: function(id){ try{ var e = this._ents[id]; if(e){ scene.remove(e.obj); delete this._ents[id]; return true; } }catch(_){} return false; },
  listModels: function(){ var o = {}; for(var k in this._ents) o[k] = this._ents[k].opt; return o; },
  // camera cinematica p/ mods: setCine(pos, look) assume, clearCine() devolve
  _cine: null,
  setCine: function(x,y,z, lx,ly,lz){ this._cine = {pos:[x,y,z], look:[lx,ly,lz]}; },
  clearCine: function(){ this._cine = null; },
  shake: function(amp, dur){ // tremor de tela p/ mods (amp em blocos, dur em ms)
    this._shake = {amp:amp||0.4, dur:dur||800, until:performance.now()+(dur||800)};
    if(this._cine) this._cine.shake = this._shake;
  },
  getView: function(){ return {yaw:yaw, pitch:pitch, third:third, x:px, y:py, z:pz}; },
  setView: function(y,p){ if(y!==undefined) yaw=y; if(p!==undefined) pitch=Math.max(-1.5,Math.min(1.5,p)); }
};
window.__BlockAPI={
  get:function(x,y,z){ return get(x,y,z); },
  set:function(x,y,z,b){ return setB(x,y,z,b); },
  registerBlock:function(def){
    // def MC-like: {id, name, tab, textures:{all|side,top,bottom}, shape:'cube| cross|slab', boxes:[...],
    //   transparent:true, cutout:true, solid:false, item:{type:'2d|3d', texture:url} }
    if(!def || !def.id) return false;
    for(var i=0;i<BLOCKS.length;i++) if(BLOCKS[i].id===def.id) return true;
    BLOCKS.push({id:def.id, n:def.name||def.id, c:def.tab||'nat'});
    var T = def.textures||{};
    if(def.texture && !T.all) T.all = def.texture;
    window.__CustomBlocks[def.id] = { textures:T, shape:(def.shape||'cube'), boxes:def.boxes||null,
      transparent:!!def.transparent, cutout:!!def.cutout, opacity:(def.opacity||0.8), item:def.item||null };
    if(def.transparent || (def.solid===false)) TRANSP[def.id] = 1;
    if(def.item && def.item.texture){ try{ var im = new Image(); im.src = def.item.texture; }catch(e){} }
    try{ if(!document.getElementById('menu').classList.contains('hidden')) buildMenu(); }catch(e){}
    return true;
  },
  blocks:function(){ return BLOCKS; },
  hotbar:function(){ return HOTBAR; }
};
function setB(x,y,z,b){
  if(x == null) return;
  if(b){
    var pfx = Math.floor(px), pfy0 = Math.floor(py), pfy1 = Math.floor(py+1.6), pfz = Math.floor(pz);
    if(x===pfx && (y===pfy0||y===pfy1) && z===pfz) return;
  }
  var kk = K(x,y,z), prev = get(x,y,z);
  if(b) setB_(x,y,z, b); else delB(x,y,z);
  if(WORLD_ID){ edits.set(kk, b||null); idxEdit(kk, b||null); dbPutEdit(WORLD_ID, kk, b||null); saveMeta(); }
  if(!b) lastBType[kk] = prev;
  rebakeAround(x, z);
}

// ---------- boot ----------
function preloadShort(done){
  var need = ["grass","grass_dirt","dirt","stone","tree_side","tree_top","leaves_opaque","sand","rock","water","glass","gold","bedrock","bricks","clay","cobblestone","diamond_ore","gravel","ice","oak_log","oak_log_top","oak_planks","obsidian","snow","tnt_side","tnt_top"];
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
    chunkQueue.length = 0; queueSet = {}; bakeQueue = []; unloadQueue = []; // descarta fila do raio antigo
    lastCC = ""; stream._lucc = null;
    stream(true);
  }
  r.oninput = sync; sync();
}
function waitChunks(list, onProg){
  // load inicial: so o NUCLEO (raio 2) trava a entrada; resto chega em background
  var core = list.filter(function(c){ return Math.max(Math.abs(c[0]-list.cx0), Math.abs(c[1]-list.cz0)) <= 2; });
  if(!core.length) core = list;
  core.forEach(function(c){
    var id = c[0]+','+c[1];
    if(!knownChunks.has(id) && !pendingChunks[id] && !queueSet[id]){ chunkQueue.push(id); queueSet[id] = 1; }
  });
  sortQueue(list.cx0, list.cz0);
  var total = core.length;
  var lastHave = -1, stuckN = 0;
  return new Promise(function(res){
    var finished = false;
    function tick(){
      if(finished) return;
      pumpBakes(1); // bakeja antes de contar: barra so anda com mesh pronta
      var have = 0, i;
      for(i=0;i<core.length;i++){ if(bakedSet[core[i][0]+','+core[i][1]]) have++; }
      // watchgod: se a contagem nao anda por 3s, o worker travou -> gera o resto no sync e sai
      if(have === lastHave){ stuckN++; } else { stuckN = 0; lastHave = have; }
      if(stuckN > 100){
        for(var fi=0;fi<core.length;fi++){
          var fid = core[fi][0]+','+core[fi][1];
          if(!bakedSet[fid]){
            if(pendingChunks[fid]){ delete pendingChunks[fid]; inflight = Math.max(0, inflight-1); }
            if(!knownChunks.has(fid)) genSync(core[fi][0], core[fi][1]);
            if(!bakedSet[fid]){ bakeChunk(core[fi][0], core[fi][1]); bakedSet[fid] = 1; }
          }
        }
        try{ onProg(total, total); }catch(e){}
        finished = true; res(); return;
      }
      try{ onProg(have, total); }catch(e){}
      if(have >= total){ finished = true; res(); return; }
      if(chunkWorker){
        if(window.__pumpWorker) window.__pumpWorker();
      } else {
        var did = 0;
        while(chunkQueue.length && did < 2){
          var q2 = chunkQueue.shift(); delete queueSet[q2];
          var p2 = q2.split(',');
          if(knownChunks.has(q2)) continue;
          genSync(+p2[0], +p2[1]); bakeQueue.push(q2); did++;
        }
      }
      setTimeout(tick, 30);
    }
    setTimeout(function(){
      if(finished) return;
      core.forEach(function(c){
        var id = c[0]+','+c[1];
        if(!bakedSet[id]){
          if(pendingChunks[id]){ delete pendingChunks[id]; inflight = Math.max(0, inflight-1); }
          if(!knownChunks.has(id)) genSync(c[0], c[1]);
          if(!bakedSet[id]){ var pp2 = id.split(','); bakeChunk(+pp2[0], +pp2[1]); bakedSet[id] = 1; }
        }
      });
      finished = true; res(); // forca saida mesmo se algo falhou
    }, 25000);
    tick();
  });
}

function init(){
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb);
  scene.fog = new THREE.Fog(0x87ceeb, 60, 500);
  camera = new THREE.PerspectiveCamera(75, innerWidth/innerHeight, 0.1, 1500);
  renderer = new THREE.WebGLRenderer({antialias:false, powerPreference:"low-power"});
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio||1, 1));
  document.getElementById("game").appendChild(renderer.domElement);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x557755, 1.0));
  var sun = new THREE.DirectionalLight(0xffffff, 0.6);
  sun.position.set(30, 50, 20); scene.add(sun);
  buildBar(); buildMenu(); wirePause(); wireSheet(); wireSettings(); bootWorker(); applyHudCfg();
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
    if(brk){ if(get(h.bx,h.by,h.bz) !== "bedrock") setB(h.bx,h.by,h.bz,null); }
    else{
      var nx = h.bx+Math.round(h.n.x), ny = h.by+Math.round(h.n.y), nz = h.bz+Math.round(h.n.z);
      if(!get(nx,ny,nz)) setB(nx,ny,nz,HOTBAR[sel]);
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
  function tb(id, fn){
    var n = document.getElementById(id);
    var lastT = 0;
    n.addEventListener("touchstart", function(e){ e.preventDefault(); var now = Date.now(); if(now-lastT < 350) return; lastT = now; fn(); }, {passive:false});
    n.addEventListener("click", function(e){ if("ontouchstart" in window) return; fn(); });
  }
  tb("bJump", function(){ keys.jump = true; setTimeout(function(){ keys.jump = false; }, 160); });
  (function(){
    var sn = document.getElementById("bSneak");
    sn.addEventListener("touchstart", function(e){ e.preventDefault(); keys.sneak = true; }, {passive:false});
    function snOff(e){ e.preventDefault(); keys.sneak = false; }
    sn.addEventListener("touchend", snOff, {passive:false});
    sn.addEventListener("touchcancel", snOff, {passive:false});
  })();
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
    WORLD_ID = w.id; SEED = w.seed; px = w.px; pz = w.pz; py = w.py; yaw = w.yaw||0; sel = w.sel||0; if(w.hotbar && w.hotbar.length===9) HOTBAR = w.hotbar.slice();
    buildBar();
    chunks = {}; edits.clear(); editsByChunk = {}; knownChunks.clear(); bakedSet = {};
    chunkQueue = []; pendingChunks = {}; inflight = 0; needsBake = false; lastCC = "";
    Object.keys(chunkMeshes).forEach(disposeChunkMeshes);
    document.getElementById("title").classList.add("hidden");
    var ld = document.getElementById("load"); ld.style.display = "flex";
    dbLoadEdits(w.id).then(function(rows){
      rows.forEach(function(r){ edits.set(r.xyz, r.b); idxEdit(r.xyz, r.b); });
      var waitR = realR;
      var ccx0 = Math.floor(px/CS), ccz0 = Math.floor(pz/CS), cl = [];
      cl.cx0 = ccx0; cl.cz0 = ccz0; // centro p/ waitChunks ordenar + filtrar nucleo
      for(var ix=-waitR;ix<=waitR;ix++) for(var iz=-waitR;iz<=waitR;iz++) cl.push([ccx0+ix, ccz0+iz]);
      var lp = document.querySelector("#load p"), lf = document.querySelector("#load .fill");
      waitChunks(cl, function(have,total){
        var pc = Math.round(have/total*100);
        lp.textContent = "Gerando mundo... "+pc+"% ("+have+"/"+total+" chunks)";
        lf.style.width = pc+"%";
      }).then(function(){
        pumpBakes(1); // nucleo em frames (sem travar)
        stream(true); // enfileira o resto do raio em background
        if(w.fresh){
          (function findLand(){
            var fx=8, fz=8, ok=false;
            for(var r=0;r<64;r+=4) for(var a=0;a<8;a++){
              var sx2 = Math.round(8+Math.cos(a/8*6.283)*r), sz2 = Math.round(8+Math.sin(a/8*6.283)*r);
              var bi = biomeAt(sx2,sz2,SEED);
              if(bi.h > SEA && (bi.type==='plains'||bi.type==='forest')){ px = sx2+0.5; pz = sz2+0.5; return; }
              if(!ok && bi.h > SEA){ fx = sx2; fz = sz2; ok = true; }
            }
            if(ok){ px = fx+0.5; pz = fz+0.5; }
          })();
          vy = 0; // garante: ensureGround nao recusa por vy sujo
          // escaneia DIRETO nos dados (biomeAt e o solido real), nao no getS que pode estar vazio
          var bi0 = biomeAt(Math.floor(px), Math.floor(pz), SEED);
          var groundH = Math.floor(bi0.h);
          // confirma com getS; se chunk ainda sem dados, usa biome como verdade
          var yy, solidY = -1;
          for(yy=140; yy>0; yy--){ var _b = getS(Math.floor(px),yy,Math.floor(pz)); if(_b){ solidY = yy; break; } }
          if(solidY >= 0) groundH = solidY;
          py = groundH+1.01;
          w.fresh = false; w.px = px; w.py = py; w.pz = pz; dbPutWorld(w);
        }
        ensureGround();
        ld.style.display = "none";
      });
    });
  }
  function wireMods(){
  var b = document.getElementById("wmods"); if(!b || b._wired) return; b._wired = true;
  var panel = document.getElementById("modpanel"), list = document.getElementById("modlist");
  function esc(s){ return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;"); }
  function render(){
    var MS = window.ModSys;
    list.innerHTML = MS.packs.length ? "" : "<small style='opacity:.6'>nenhum mod — importa um .zip<br><br>zip: /Pasta/pack.json + .js/.css/.html + assets/ como quiser</small>";
    MS.packs.forEach(function(p){
      var on = !!MS.activeIds[p.id];
      var d = document.createElement("div");
      d.style.cssText = "border:2px solid #444;padding:8px;margin-bottom:8px;background:#222";
      d.innerHTML = "<b>"+esc(p.name)+"</b>"+(on?" <span style='color:#5dff5d'>[ON]</span>":"")+"<br><small style='opacity:.7'>"+esc(p.description||"")+"</small><br><small style='opacity:.5'>"+esc(p.fileName||"")+"</small><br><br>";
      var row = document.createElement("div"); row.style.cssText = "display:flex;gap:6px";
      var bT = document.createElement("button"); bT.className = "mcbtn"; bT.style.flex = "1";
      bT.textContent = on ? "OFF" : "ON";
      bT.onclick = function(){ MS.toggle(p.id, !on); render(); };
      var bD = document.createElement("button"); bD.className = "mcbtn"; bD.style.flex = "1"; bD.textContent = "APAGAR";
      bD.onclick = function(){ if(confirm("apagar "+p.name+"?")){ MS.remove(p.id); render(); } };
      row.appendChild(bT); row.appendChild(bD); d.appendChild(row);
      list.appendChild(d);
    });
  }
  window.__refreshModPanel = render;
  function open(){ panel.classList.remove("hidden"); panel.style.display = "flex"; render(); }
  function close(){ panel.classList.add("hidden"); panel.style.display = "none"; }
  b.onclick = function(e){ if(e&&e.stopPropagation)e.stopPropagation(); open(); };
  document.getElementById("modclose").onclick = close;
  panel.onclick = function(e){ if(e.target===panel) close(); };
  document.getElementById("modimport").onclick = function(){ document.getElementById("modImp").click(); };
  document.getElementById("modImp").addEventListener("change", function(e){
    var f = e.target.files[0]; if(!f) return;
    window.ModSys.importZip(f).then(function(){ render(); }, function(err){ alert("erro no zip: "+err); });
    e.target.value = "";
  });
  }
  function wireLog(){
  var b = document.getElementById('wLog'); if(!b || b._wired) return; b._wired = true;
  var panel = document.getElementById('logpanel'), body = document.getElementById('logBody');
  function dump(){
    var L = window.__LOGBUF||[];
    body.textContent = L.join('\n') || '(sem logs)';
  }
  b.onclick = function(e){ if(e&&e.stopPropagation)e.stopPropagation(); panel.classList.remove('hidden'); panel.style.display='flex'; dump(); };
  document.getElementById('logClose').onclick = function(){ panel.classList.add('hidden'); panel.style.display='none'; };
  document.getElementById('logCopy').onclick = function(){
    var t = body.textContent;
    try{
      if(navigator.clipboard) navigator.clipboard.writeText(t).then(function(){ document.getElementById('logCopy').textContent='OK'; setTimeout(function(){document.getElementById('logCopy').textContent='COPIAR';},1200); });
      else { var ta=document.createElement('textarea'); ta.value=t; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
    }catch(e){}
  };
  }
  function wireDestroy(){
  var b = document.getElementById("wDestroy"); if(!b || b._wired) return; b._wired = true;
  function go(){
    if(!confirm("apagar TUDO? mundos + shaders + mods + hud")) return;
    try{ localStorage.clear(); }catch(e){}
    try{ sessionStorage.clear(); }catch(e){}
    try{
      document.cookie.split(";").forEach(function(c){
        var n = c.split("=")[0].trim();
        if(n) document.cookie = n+"=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/";
      });
    }catch(e){}
    try{ if(window.ModSys) window.ModSys.packs.slice().forEach(function(p){ try{ window.ModSys.remove(p.id); }catch(e){} }); }catch(e){}
    try{ if(window.ShaderSys){ window.ShaderSys.packs = []; window.ShaderSys.activeId = null; } }catch(e){}
    var pending = 2;
    function done(){ if(--pending<=0) location.reload(); }
    try{ var d1 = indexedDB.deleteDatabase("blocknet"); d1.onsuccess = d1.onerror = d1.onblocked = done; }
    catch(e){ done(); }
    try{ var d2 = indexedDB.deleteDatabase("blocknet_ext"); d2.onsuccess = d2.onerror = d2.onblocked = done; }
    catch(e){ done(); }
    setTimeout(function(){ location.reload(); }, 2000);
  }
  b.onclick = go;
  }
  function wireShaders(){
  var b = document.getElementById("wshad"); if(!b || b._wired) return; b._wired = true;
  var panel = document.getElementById("shpanel"), list = document.getElementById("shlist");
  function esc(s){ return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;"); }
  function render(){
    var SS = window.ShaderSys;
    list.innerHTML = SS.packs.length ? "" : "<small style='opacity:.6'>nenhum pack — importa um .zip</small>";
    SS.packs.forEach(function(p){
      var on = (p.id===SS.activeId);
      var d = document.createElement("div");
      d.style.cssText = "border:2px solid #444;padding:8px;margin-bottom:8px;background:#222";
      d.innerHTML = "<b>"+esc(p.name)+"</b>"+(on?" <span style='color:#5dff5d'>[ON]</span>":"")+"<br><small style='opacity:.7'>"+esc(p.description||"")+"</small><br><br>";
      var row = document.createElement("div"); row.style.cssText = "display:flex;gap:6px";
      var bT = document.createElement("button"); bT.className = "mcbtn"; bT.style.flex = "1";
      bT.textContent = on ? "OFF" : "ON";
      bT.onclick = function(){ SS.toggle(p.id, !on); render(); };
      var bD = document.createElement("button"); bD.className = "mcbtn"; bD.style.flex = "1"; bD.textContent = "APAGAR";
      bD.onclick = function(){ if(confirm("apagar "+p.name+"?")){ SS.remove(p.id); render(); } };
      row.appendChild(bT); row.appendChild(bD); d.appendChild(row);
      list.appendChild(d);
    });
  }
  function open(){ panel.classList.remove("hidden"); panel.style.display = "flex"; render(); }
  function close(){ panel.classList.add("hidden"); panel.style.display = "none"; }
  b.onclick = function(e){ if(e&&e.stopPropagation)e.stopPropagation(); open(); };
  document.getElementById("shclose").onclick = close;
  panel.onclick = function(e){ if(e.target===panel) close(); };
  document.getElementById("shimport").onclick = function(){ document.getElementById("zipImp").click(); };
  document.getElementById("zipImp").addEventListener("change", function(e){
    var f = e.target.files[0]; if(!f) return;
    window.ShaderSys.importZip(f).then(function(){ render(); }, function(err){ alert("erro no zip: "+err); });
    e.target.value = "";
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
    function bindOnce(id, fn){
      var n = document.getElementById(id);
      n.onclick = function(e){ if(e && e.stopPropagation) e.stopPropagation(); fn(n); };
      n.ontouchstart = function(e){ if(e && e.preventDefault) e.preventDefault(); fn(n); };
    }
    bindOnce("wnew", function(btn){
      if(btn.disabled) return; btn.disabled = true;
      var nm = (document.getElementById("wname").value||"Mundo").slice(0,20);
      function done(id){ selId = id; refresh(); document.getElementById("wname").value = ""; btn.disabled = false; }
      function fail(e){ btn.disabled = false; try{ alert("erro ao criar mundo: "+(e && (e.message||e.name) || e)); }catch(_){} }
      try{
        dbAddWorld({name:nm, seed:(Math.random()*99999)|0, px:8.5, py:30, pz:8.5, yaw:0, sel:0, ts:Date.now(), fresh:true}).then(done, fail);
      }catch(e){ fail(e); }
      setTimeout(function(){ btn.disabled = false; }, 4000); // fusivel: nunca trava desabilitado
    });
    document.getElementById("wplay").onclick = function(){
      var ws = list._ws||[], w = null;
      ws.forEach(function(x){ if(x.id===list._sel) w = x; });
      if(w || ws[0]) enterWorld(w || ws[0]);
    };
    document.getElementById("wdel").onclick = function(){
      if(list._sel) dbDelWorld(list._sel).then(function(){ list._sel = null; refresh(); });
    };
    wireShaders(); wireMods(); wireDestroy(); wireLog();
  }

  // loop principal
  (function boot(){
    var last = performance.now(), acc = 0;
    setInterval(function(){ saveMeta(); }, 5000);
    addEventListener("pagehide", function(){
      if(!WORLD_ID) return;
      dbGetWorlds().then(function(ws){
        ws.forEach(function(x){
          if(x.id===WORLD_ID){ x.px=px; x.py=py; x.pz=pz; x.yaw=yaw; x.sel=sel; x.hotbar=HOTBAR.slice(); x.ts=Date.now(); dbPutWorld(x); }
        });
      });
    });
    var fpsEl = document.getElementById("fps"), fpsFrames = 0, fpsT = performance.now();
    (function loop(t){
      requestAnimationFrame(loop);
      if(!WORLD_ID) pumpBakes(1); // load tambem bakeja: barra anda com mesh pronta antes do loop do mundo
      var dt = Math.min(0.05, (t-last)/1000); last = t;
      fpsFrames++;
      var fnow = performance.now();
      if(fnow - fpsT >= 500){
        var fps = Math.round(fpsFrames*1000/(fnow-fpsT));
        __lastFps = fps;
        fpsFrames = 0; fpsT = fnow;
        fpsEl.textContent = fps + " FPS";
        // auto-qualidade: FPS baixo = desliga luz dos materiais (MESMA textura, sem perder qualidade visual perto)
        if(fps < 12 && LITE_ON){ LITE_ON = false; applyLite(); }
        else if(fps > 25 && !LITE_ON){ LITE_ON = true; applyLite(); }
      }
      if(!WORLD_ID){ renderer.render(scene, camera); return; }
      var flyOn = !!window.__fly;
      var fv = flyOn ? (window.__flySpeed||1) : 1;
      var base = 6*dt*(keys.sneak?0.45:1) * (flyOn ? (2.2+fv*2.0) : 1);
      var f = (keys.f?1:0)-(keys.b?1:0), s = (keys.r?1:0)-(keys.l?1:0);
      var sin = Math.sin(yaw), cos = Math.cos(yaw);
      var dx = (-sin*f+cos*s)*base, dz = (-cos*f-sin*s)*base;
      var E = 0.3;
      function solidB(x,y,z){ return !!getS(Math.floor(x), Math.floor(y), Math.floor(z)); }
      function feetOk(x,z){
        return !solidB(x+E,py,z)&&!solidB(x-E,py,z)&&!solidB(x,py,z+E)&&!solidB(x,py,z-E)&&!solidB(x,py+1.6,z);
      }
      var steps = Math.max(1, Math.ceil(Math.abs(dx)/0.3)), si, tx;
      for(si=0;si<steps;si++){ tx = px+dx/steps; if(feetOk(tx,pz)) px = tx; else break; }
      steps = Math.max(1, Math.ceil(Math.abs(dz)/0.3));
      for(var sj=0;sj<steps;sj++){ var tz = pz+dz/steps; if(feetOk(px,tz)) pz = tz; else break; }
      // agua: 2 gets/frame (barato, sem custo de bake)
      var feetB = get(Math.floor(px),Math.floor(py+0.3),Math.floor(pz));
      var inWater = feetB === "water" || get(Math.floor(px),Math.floor(py+1.2),Math.floor(pz)) === "water";
      if(flyOn){
        if(window.__flyUp) vy = 7*fv;
        else if(window.__flyDown) vy = -7*fv;
        else vy *= 0.82;
        if(Math.abs(vy)<0.04) vy=0;
      } else if(inWater){
        vy = Math.max(-3, vy-6*dt); // afunda bem devagar
        if(keys.jump) vy = Math.min(5.2, vy+40*dt); // espaco = sobe rapido
        dx *= 0.6; dz *= 0.6; // arrasto da agua
        dx *= 0.6; dz *= 0.6;
      } else {
        vy = Math.max(-18, vy-26*dt);
      }
      // pe checa um fiapo ABAIXO (py-0.05): detecta o chao antes de afundar -> sem afunda-teleporta
      function footSolid(ty){
        return solidB(px+E,ty-0.05,pz)||solidB(px-E,ty-0.05,pz)||solidB(px,ty-0.05,pz+E)||solidB(px,ty-0.05,pz-E);
      }
      var dy = vy*dt, sub = flyOn ? 1 : Math.max(1, Math.ceil(Math.abs(dy)/0.3)), landed = false, sk, ty;
      if(!flyOn && vy<=0 && !keys.jump && footSolid(py) && Math.abs(py-(Math.floor(py-0.05)+1.01))<0.06){
        py = Math.floor(py-0.05)+1.01; vy = 0; landed = true; // grudado: nem gravidade encosta
        lastLandT = performance.now();
      }
      else for(sk=0;sk<sub;sk++){
        ty = py+dy/sub;
        if(flyOn){
          py = ty; landed=false; break;
        }
        var hitF = footSolid(ty);
        var hitH = solidB(px,ty+1.7,pz);
        if(vy<=0 && hitF){ py = Math.floor(ty-0.05)+1.01; vy = 0; landed = true; lastLandT = performance.now(); break; }
        else if(vy>0 && hitH){ vy = 0; py = ty; break; }
        else py = ty;
      }
      py = Math.max(1, py);
      if(keys.jump && landed && !inWater && !flyOn){ vy = 8.5; landed = false; }
      if(inWater && keys.jump){
        // auto-saida: tenta subir na borda em qualquer direcao (degrau assistido)
        var dirs=[[1,0],[-1,0],[0,1],[0,-1]];
        for(var di=0;di<4;di++){
          var bx=Math.floor(px)+dirs[di][0], bz=Math.floor(pz)+dirs[di][1];
          var topY=Math.floor(py)+1;
          if(getS(bx,topY,bz) && !solidB(bx,topY+1,bz) && !solidB(bx,topY+2,bz)){ py=topY+1.01; vy=0; break; }
        }
      }
      if(window.ShaderSys) window.ShaderSys.tick(dt);
      __frameN++;
      pumpBakes(1); // 1 bake/frame: sem spike de GPU
      if(unloadQueue.length){ // unload escalonado: 8/frame
        for(var ui=0; ui<8 && unloadQueue.length; ui++){
          var uk = unloadQueue.shift();
          knownChunks.delete(uk); disposeChunkMeshes(uk);
        }
      }
      acc += dt; if(acc > 0.25){ acc = 0; stream(); }
      var e2 = eye(), d2 = dirV();
      if(window.__BN._cine){ // cinematica de mod: interpola suave ate pos+olhar (+shake opcional)
        var C = window.__BN._cine;
        camera.position.x += (C.pos[0]-camera.position.x)*Math.min(1,dt*2.5);
        camera.position.y += (C.pos[1]-camera.position.y)*Math.min(1,dt*2.5);
        camera.position.z += (C.pos[2]-camera.position.z)*Math.min(1,dt*2.5);
        if(C.shake && performance.now() < C.shake.until){
          var s = C.shake.amp * ((C.shake.until-performance.now())/C.shake.dur);
          camera.position.x += (Math.random()*2-1)*s;
          camera.position.y += (Math.random()*2-1)*s;
          camera.position.z += (Math.random()*2-1)*s;
        }
        camera.lookAt(C.look[0], C.look[1], C.look[2]);
      }
      else if(window.__BN._shake && performance.now() < window.__BN._shake.until){
        // tremor fora da cinematica (1a pessoa): desloca e rotaciona a camera
        var Sh = window.__BN._shake;
        var s2 = Sh.amp * ((Sh.until-performance.now())/Sh.dur);
        camera.position.x += (Math.random()*2-1)*s2;
        camera.position.y += (Math.random()*2-1)*s2;
        camera.rotation.z = (Math.random()*2-1)*s2*0.05;
      }
      else if(third) camera.position.set(e2.x-d2.x*5, e2.y-d2.y*5+1, e2.z-d2.z*5);
      else camera.position.copy(e2);
      if(!window.__BN._cine && !(window.__BN._shake && performance.now() < window.__BN._shake.until)){ camera.rotation.order = "YXZ"; camera.rotation.y = yaw; camera.rotation.x = pitch; }
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
