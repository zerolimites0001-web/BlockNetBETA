// BlockNetBETA ShaderSys v3 — simples. ZIP = ShaderOriginal/shaders/*.(glslv|glslf) + pack.json
// pack.json SO tem isso, nada mais:
// {
//   "name": "Meu Pack",
//   "description": "agua balanco",
//   "shaders": [
//     "ShaderOriginal/shaders/agua.vert.glsl",
//     "ShaderOriginal/shaders/tonemap.frag.glsl"
//   ]
// }
// Nome do arquivo/pasta 100% livre, o que vale é o caminho listado no pack.json.
// Detecção auto: se o código tem "gl_Position" = vertex, senão = fragment.
// Tudo é aplicado global (todos os blocos). Sem limite: snippet tem acesso total
// ao shader Lambert do three r128 (transformed, diffuseColor, vUv, uTime...).
(function(){
"use strict";
function extDB(){
  if(window.__extDBp) return window.__extDBp;
  window.__extDBp = new Promise(function(res, rej){
    try{
      var r = indexedDB.open("blocknet_ext", 1);
      r.onupgradeneeded = function(){ var d=r.result;
        if(!d.objectStoreNames.contains("shaders")) d.createObjectStore("shaders",{keyPath:"id"});
        if(!d.objectStoreNames.contains("mods")) d.createObjectStore("mods",{keyPath:"id"}); };
      r.onsuccess = function(){ res(r.result); }; r.onerror = function(){ rej(r.error); };
    }catch(e){ rej(e); }
  });
  return window.__extDBp;
}
window.extDB = extDB;
window.ShaderSys = {
  packs: [], activeId: null, time: 0,
  DB: "blocknet_shaders_v3",

  _ready: false,
  load(){
    var self = this;
    self.packs = []; self.activeId = null;
    extDB().then(function(d){
      try{
        var q = d.transaction("shaders").objectStore("shaders").getAll();
        q.onsuccess = function(){
          var rows = q.result||[];
          rows.sort(function(a,b){return (a.ts||0)-(b.ts||0);});
          self.packs = rows;
          self.activeId = null; // nunca auto-ativa: pack quebrado salvo nao pode cegar o jogo
          self._ready = true;
          if(window.__refreshShaderPanel) try{ window.__refreshShaderPanel(); }catch(e){}
        };
        q.onerror = function(){ self._ready = true; };
      }catch(e){ self._ready = true; }
    }).catch(function(){ self._ready = true; });
  },
  save(){
    var self = this;
    extDB().then(function(d){
      try{
        var t = d.transaction("shaders","readwrite").objectStore("shaders");
        t.clear();
        self.packs.forEach(function(p){ p.active = (p.id===self.activeId); p.ts = p.ts||Date.now(); try{ t.put(p); }catch(e){} });
      }catch(e){}
    }).catch(function(){});
  },
  active(){ for(var i=0;i<this.packs.length;i++) if(this.packs[i].id===this.activeId) return this.packs[i]; return null; },

  _validate(F, V){
    // valida GLSL antes de ativar: erro aqui = pack recusado, jogo intacto
    if(F && /diffuseColor\s*\.\s*a\s*=/.test(F)) return 'fragment mexe no alpha (transparencia)';
    if((F||'').split('{').length !== (F||'').split('}').length) return 'fragment com chaves desbalanceadas';
    if((V||'').split('{').length !== (V||'').split('}').length) return 'vertex com chaves desbalanceadas';
    if(/void\s+main/i.test(F||'') || /void\s+main/i.test(V||'')) return 'snippet nao pode ter void main';
    return null;
  },
  async importZip(file){
    if(typeof JSZip === "undefined") throw "JSZip não carregado (precisa internet p/ CDN)";
    var zip = await JSZip.loadAsync(file);
    var pf = zip.file("pack.json");
    if(!pf){
      // aceita pack.json dentro de subpasta (ex: ShaderOriginal/pack.json)
      var found = null;
      zip.forEach(function(p){ if(!found && /(^|\/)pack\.json$/.test(p)) found = p; });
      if(found) pf = zip.file(found); else throw "zip sem pack.json";
    }
    var meta = JSON.parse(await pf.async("string"));
    var list = meta.shaders || [];
    if(!list.length) throw "pack.json sem 'shaders' (lista de caminhos)";
    var vtx = [], frg = [];
    for(var i=0;i<list.length;i++){
      var path = list[i];
      var f = zip.file(path);
      if(!f) throw "faltando no zip: "+path;
      var code = await f.async("string");
      var lp = path.toLowerCase();
      if(/\.glslv$/.test(lp)) vtx.push("// file: "+path+"\n"+code);
      else if(/\.glslf$/.test(lp)) frg.push("// file: "+path+"\n"+code);
      else if(/gl_Position/i.test(code)) vtx.push("// file: "+path+"\n"+code);
      else frg.push("// file: "+path+"\n"+code);
    }
    var pack = {
      id: "pack_"+Date.now().toString(36),
      name: meta.name||file.name,
      description: meta.description||"",
      vertex: vtx.join("\n// ---- next ----\n"),
      fragment: frg.join("\n// ---- next ----\n")
    };
    var err = this._validate(pack.fragment, pack.vertex);
    if(err){ throw 'shader invalido: '+err+' (pack recusado, jogo intacto)'; }
    this.packs.push(pack);
    this.activeId = null; // importa DESLIGADO: user liga no painel depois de entrar no mundo
    this.save();
    return pack;
  },

  remove(id){
    this.packs = this.packs.filter(p=>p.id!==id);
    if(this.activeId===id){ this.activeId = null; this.save(); this.resetAll(); return; }
    this.save(); this.apply();
  },
  toggle(id, on){
    if(on){ this.activeId = id; this.save(); this.apply(); alert('shader ON — se ficar invisivel, aperte OFF que restaura'); }
    else if(this.activeId===id){ this.activeId = null; this.save(); this.resetAll(); }
  },
  resetAll(){
    this.activeId = null; this.save();
    try{
      if(window.__allMats){ var ms = window.__allMats();
        for(var i=0;i<ms.length;i++){ ms[i].onBeforeCompile = null; ms[i].userData.shaderUni = null; delete ms[i].customProgramCacheKey; ms[i].userData.shaderUni = null; ms[i].needsUpdate = true; }
      }
    }catch(e){}
  },

  // patch global: fragment em tudo + vertex vento so em leaves
  patchMaterial(mat){
    var pack = this.active();
    if(!pack){ return; }
    var isLeaf = /leaves/i.test(mat.userData.texName||'');
    var V = pack.vertex, F = pack.fragment;
    // so aplica vento em folha; tonemap em tudo
    var useV = isLeaf ? V : '';
    if(!useV && !F){ mat.needsUpdate = true; return; }
    var uni = { uTime: { value: this.time } };
    mat.userData.shaderUni = uni;
    var key = 'sp4_'+pack.id+'_'+(isLeaf?'leaf':'all');
    mat.customProgramCacheKey = function(){ return key; };
    mat.onBeforeCompile = function(sh){
      Object.assign(sh.uniforms, uni);
      try{
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;');
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uTime;');
        if(useV){
          if(sh.vertexShader.indexOf('#include <begin_vertex>')>=0)
            sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n'+useV);
        }
        if(F){
          if(sh.fragmentShader.indexOf('#include <map_fragment>')>=0)
            sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n'+F);
        }
      }catch(err){}
      mat.userData.shaderRef = sh;
    };
    mat.needsUpdate = true;
  },
  _patchDisabled(mat){
    mat.onBeforeCompile = null;
    mat.userData.shaderUni = null;
    var pack = this.active();
    if(!pack || (!pack.vertex && !pack.fragment)){ mat.needsUpdate = true; return; }
    var uni = { uTime: { value: this.time } };
    mat.userData.shaderUni = uni;
    var key = "sp3_"+pack.id;
    mat.customProgramCacheKey = function(){ return key; };
    var V = pack.vertex, F = pack.fragment;
    mat.onBeforeCompile = function(sh){
      Object.assign(sh.uniforms, uni);
      try{
      function splitGLSL(src){
        var head = [], body = [];
        var lines = String(src).split("\n");
        for(var i=0;i<lines.length;i++){
          var t = lines[i].trim();
          if(/^(uniform|varying|attribute)\b/.test(t)) head.push(lines[i]);
          else body.push(lines[i]);
        }
        return { head: head.join("\n"), body: body.join("\n") };
      }
      var Vs = splitGLSL(V.replace(/uniform\s+float\s+uTime\s*;/g,""));
      var Fs = splitGLSL(F.replace(/uniform\s+float\s+uTime\s*;/g,""));
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nuniform float uTime;\n"+Vs.head);
      sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nuniform float uTime;\n"+Fs.head);
      var Vclean = Vs.body, Fclean = Fs.body;
      // snippet DENTRO do main: vertex apos begin_vertex (transformed existe), fragment apos map_fragment (diffuseColor existe)
      if(Vclean){
        if(sh.vertexShader.indexOf("#include <begin_vertex>")>=0)
          sh.vertexShader = sh.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\n"+Vclean);
        else
          sh.vertexShader = sh.vertexShader.replace("void main() {", "void main() {\n"+Vclean);
      }
      if(Fclean){
        if(sh.fragmentShader.indexOf("#include <map_fragment>")>=0)
          sh.fragmentShader = sh.fragmentShader.replace("#include <map_fragment>", "#include <map_fragment>\n"+Fclean);
        else if(sh.fragmentShader.indexOf("#include <color_fragment>")>=0)
          sh.fragmentShader = sh.fragmentShader.replace("#include <color_fragment>", "#include <color_fragment>\n"+Fclean);
        else
          sh.fragmentShader = sh.fragmentShader.replace("void main() {", "void main() {\n"+Fclean);
      }
      }catch(err){ console.warn("ShaderSys inject fail", err); }
      mat.userData.shaderRef = sh;
    };
    mat.needsUpdate = true;
  },

  apply(){
    try{ if(window.__repatchAllMats) window.__repatchAllMats(); }
    catch(e){ console.warn("ShaderSys.apply", e); }
  },

  tick(dt){
    this.time += dt;
    try{
      if(window.__allMats){ var ms = window.__allMats();
        for(var i=0;i<ms.length;i++){ var u = ms[i].userData.shaderUni; if(u && u.uTime) u.uTime.value = this.time; }
      }
    }catch(e){}
  }
};
window.ShaderSys.load();
})();
