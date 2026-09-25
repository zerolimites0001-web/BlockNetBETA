// BlockNetBETA ModSys v2 — seguro. Erro de mod NUNCA quebra o jogo.
(function(){
"use strict";
window.ModSys = {
  packs: [], activeIds: {}, DB: "blocknet_mods_v1",
  blobUrls: {},

  load(){
    var self = this;
    if(!self._wantsEnable()) return;
    function db(){ return (window.extDB ? window.extDB() : Promise.reject("nodb")); }
    db().then(function(d){
      try{
        var q = d.transaction("mods").objectStore("mods").getAll();
        q.onsuccess = function(){
          var rows = q.result||[];
          rows.sort(function(a,b){return (a.ts||0)-(b.ts||0);});
          // reimporta cada zip salvo, em ordem
          (function next(i){
            if(i>=rows.length){ if(window.__refreshModPanel) try{ window.__refreshModPanel(); }catch(e){} return; }
            var r = rows[i];
            try{
              var f = new File([r.blob], r.fileName||"mod.zip", {type:"application/zip"});
              self.importZip(f, true).then(function(){ next(i+1); }, function(){ next(i+1); });
            }catch(e){ next(i+1); }
          })(0);
        };
      }catch(e){}
    }).catch(function(){});
  },
  save(){
    var self = this;
    if(!window.extDB) return;
    window.extDB().then(function(d){
      try{
        var t = d.transaction("mods","readwrite").objectStore("mods");
        t.clear();
        self.packs.forEach(function(p){
          if(!p._blob) return;
          try{ t.put({id:p.id, name:p.name, description:p.description, fileName:p.fileName, ts:Date.now(), blob:p._blob}); }catch(e){}
        });
      }catch(e){}
    }).catch(function(){});
  },

  _wantsEnable(){ try{ if(/safemode|nomods/.test(location.search)) return false; }catch(e){} return true; },
  async importZip(file, silent){
    if(typeof JSZip === "undefined") throw "JSZip não carregado (precisa internet)";
    this._lastBlob = file;
    var zip = await JSZip.loadAsync(file);
    var pfPath = null;
    zip.forEach(function(p){ if(!pfPath && /(^|\/)pack\.json$/.test(p)) pfPath = p; });
    if(!pfPath) throw "zip sem pack.json";
    var base = pfPath.indexOf("/")>=0 ? pfPath.slice(0, pfPath.lastIndexOf("/")+1) : "";
    var meta;
    try{ meta = JSON.parse(await zip.file(pfPath).async("string")); }
    catch(e){ throw "pack.json invalido: "+e; }
    var id = "mod_"+Date.now().toString(36);
    // blob de tudo
    var urls = {};
    var jobs = [];
    zip.forEach(function(p, f){
      if(f.dir) return;
      jobs.push(f.async("blob").then(function(b){
        urls[p] = URL.createObjectURL(b);
      }).catch(function(){}));
    });
    await Promise.all(jobs);
    var pack = { id:id, name:String(meta.name||file.name).slice(0,40),
      description:String(meta.description||"").slice(0,200),
      js:(meta.js||[]).slice(0,10), css:(meta.css||[]).slice(0,10), html:(meta.html||[]).slice(0,10),
      base:base, nodes:[], fileName:file.name };

    var self = this;
    function resolvePath(ref, fromFile){
      ref = String(ref||"").trim();
      if(!ref || /^(http|https|data|blob):/.test(ref) || ref[0]==="#") return ref;
      var dir = fromFile.indexOf("/")>=0 ? fromFile.slice(0, fromFile.lastIndexOf("/")+1) : "";
      var cand = dir+ref;
      var parts = [];
      cand.split("/").forEach(function(s){ if(s==="..") parts.pop(); else if(s!==".") parts.push(s); });
      cand = parts.join("/");
      if(urls[cand]) return urls[cand];
      if(urls[ref]) return urls[ref];
      return ref; // deixa como está, não quebra
    }
    // CSS
    for(var ci=0; ci<pack.css.length; ci++){
      try{
        var cp = pack.css[ci], cf = zip.file(cp);
        if(!cf) throw "faltando: "+cp;
        var css = await cf.async("string");
        css = String(css).slice(0, 20000).replace(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g, function(m,u){ return "url("+resolvePath(u,cp)+")"; });
        var st = document.createElement("style");
        st.setAttribute("data-mod", id); st.textContent = css;
        document.head.appendChild(st); pack.nodes.push(st);
        pack._cssCode = pack._cssCode||[]; pack._cssCode.push({path:cp, code:css});
      }catch(e){ throw "css "+pack.css[ci]+": "+e; }
    }
    // HTML — dentro de container próprio, nunca solto no body
    var wrap = document.createElement("div");
    wrap.setAttribute("data-modwrap", id);
    wrap.style.cssText = "position:fixed;left:0;bottom:0;z-index:40;pointer-events:none;";
    document.body.appendChild(wrap); pack.nodes.push(wrap);
    for(var hi=0; hi<pack.html.length; hi++){
      try{
        var hp = pack.html[hi], hf = zip.file(hp);
        if(!hf) throw "faltando: "+hp;
        var html = String(await hf.async("string")).slice(0, 50000);
        var tmp = document.createElement("div");
        tmp.innerHTML = html;
        // reescreve src/href
        Array.prototype.forEach.call(tmp.querySelectorAll("[src]"), function(n){ try{ n.src = resolvePath(n.getAttribute("src"), hp); }catch(e){} });
        // move filhos p/ wrap (pointer-events quem precisa ativa no css)
        while(tmp.firstChild) wrap.appendChild(tmp.firstChild);
        pack._htmlCode = pack._htmlCode||[]; pack._htmlCode.push({path:hp, code:String(html)});
      }catch(e){ throw "html "+pack.html[hi]+": "+e; }
    }
    // JS — cada um em script com try/catch, erro aparece em alert e NÃO trava jogo
    for(var ji=0; ji<pack.js.length; ji++){
      try{
        var jp = pack.js[ji], jf = zip.file(jp);
        if(!jf) throw "faltando: "+jp;
        var js = String(await jf.async("string")).slice(0, 200000);
        var sc = document.createElement("script");
        sc.setAttribute("data-mod", id);
        sc.textContent = "try{var Mod=window.ModSys.api("+JSON.stringify(id)+");\n"+js+"\n}catch(e){alert('mod erro ("+pack.name+" / "+jp+"): '+(e&&e.message||e));}";
        document.body.appendChild(sc); pack.nodes.push(sc);
        pack._jsCode = pack._jsCode||[]; pack._jsCode.push({path:jp, code:String(js)});
      }catch(e){ self._rollback(pack); throw "js "+pack.js[ji]+": "+e; }
    }
    this.blobUrls[id] = urls;
    pack._blob = this._lastBlob;
    this.packs = this.packs.filter(p=>p.name!==pack.name);
    this.packs.push(pack);
    this.activeIds[id] = true;
    if(!silent) this.save();
    if(window.__refreshModPanel && !silent) try{ window.__refreshModPanel(); }catch(e){}
    return pack;
  },

  _rollback(pack){
    (pack.nodes||[]).forEach(function(n){ try{ if(n.parentNode) n.parentNode.removeChild(n); }catch(e){} });
  },
  api(id){
    var self = this;
    return {
      id: id,
      asset: function(p){ return self.resolve(id, p); },
      worker: function(f, cb){ return self.worker(id, f, cb); },
      on: function(ev, fn){ document.addEventListener("mod:"+ev, fn); },
      emit: function(ev, d){ document.dispatchEvent(new CustomEvent("mod:"+ev, {detail:d})); },
      // atalho seguro p/ criar UI sem quebrar layout
      el: function(tag, css, parent){
        var n = document.createElement(tag||"div");
        if(css) n.style.cssText = css;
        n.style.pointerEvents = "auto";
        (parent||document.body).appendChild(n);
        var pack = null;
        for(var i=0;i<self.packs.length;i++) if(self.packs[i].id===id) pack=self.packs[i];
        if(pack) pack.nodes.push(n);
        return n;
      }
    };
  },

  worker(id, workerFile, onMsg){
    // worker separado por mod: Mod.worker('calc.js', fn)
    // workerFile = caminho dentro do zip; roda em thread separada, nao congela aba
    var pack = null;
    for(var i=0;i<this.packs.length;i++) if(this.packs[i].id===id) pack = this.packs[i];
    if(!pack) return null;
    var urls = this.blobUrls[id]||{};
    var url = urls[workerFile] || urls[pack.base+workerFile];
    if(!url){ // fallback: procura por nome do arquivo
      for(var k in urls){ if(k.endsWith('/'+workerFile) || k===workerFile){ url = urls[k]; break; } }
    }
    if(!url){ try{ alert('worker nao achado: '+workerFile); }catch(e){} return null; }
    var w;
    try{ w = new Worker(url); }
    catch(e){ try{ alert('worker falhou: '+(e&&e.message||e)); }catch(_){} return null; }
    if(onMsg) w.onmessage = function(e){ try{ onMsg(e.data); }catch(err){} };
    pack.nodes.push({parentNode:{removeChild:function(){}}, style:{}, _worker:w});
    pack._workers = pack._workers||[]; pack._workers.push(w);
    return w;
  },
  resolve(id, ref){
    var pack = null;
    for(var i=0;i<this.packs.length;i++) if(this.packs[i].id===id) pack = this.packs[i];
    if(!pack) return ref;
    if(!ref || /^(http|https|data|blob):/.test(ref)) return ref;
    var urls = this.blobUrls[id]||{};
    var cands = [ref, pack.base+ref];
    for(var k=0;k<cands.length;k++) if(urls[cands[k]]) return urls[cands[k]];
    for(var key in urls){ if(key.endsWith("/"+ref)) return urls[key]; }
    return ref;
  },

  remove(id){
    for(var i=0;i<this.packs.length;i++) if(this.packs[i].id===id){
      this._rollback(this.packs[i]);
      try{ (this.packs.filter(function(p){return p.id===id;})[0]._workers||[]).forEach(function(w){try{w.terminate();}catch(e){}}); }catch(e){}
      var urls = this.blobUrls[id]||{};
      for(var k in urls){ try{ URL.revokeObjectURL(urls[k]); }catch(e){} }
      delete this.blobUrls[id];
      this.packs.splice(i,1); break;
    }
    delete this.activeIds[id]; this.save();
  },
  toggle(id, on){
    var pack = null;
    for(var i=0;i<this.packs.length;i++) if(this.packs[i].id===id) pack = this.packs[i];
    if(!pack) return;
    if(on){ this._enable(pack); this.activeIds[id] = true; }
    else { this._disable(pack); delete this.activeIds[id]; }
    this.save();
  },
  _disable(pack){
    // OFF de verdade: remove TUDO (js para de rodar sozinho nao — interval precisa cooperar,
    // entao avisamos via evento + removemos DOM + matamos workers)
    try{ document.dispatchEvent(new CustomEvent('mod:off', {detail:{id:pack.id}})); }catch(e){}
    try{ (pack._workers||[]).forEach(function(w){ try{ w.terminate(); }catch(e){} }); pack._workers = []; }catch(e){}
    (pack.nodes||[]).forEach(function(n){ try{ if(n._worker){ try{n._worker.terminate();}catch(e){} return; } if(n.parentNode) n.parentNode.removeChild(n); }catch(e){} });
    pack.nodes = [];
    pack.enabled = false;
  },
  _enable(pack){
    var self = this;
    // re-injeta css/html/js guardados. js roda de novo do zero.
    pack.nodes = [];
    (pack._cssCode||[]).forEach(function(item){
      var st = document.createElement("style");
      st.setAttribute("data-mod", pack.id); st.textContent = item.code;
      document.head.appendChild(st); pack.nodes.push(st);
    });
    var wrap = document.createElement("div");
    wrap.setAttribute("data-modwrap", pack.id);
    wrap.style.cssText = "position:fixed;left:0;bottom:0;z-index:40;pointer-events:none;";
    document.body.appendChild(wrap); pack.nodes.push(wrap);
    (pack._htmlCode||[]).forEach(function(item){
      var tmp = document.createElement("div");
      tmp.innerHTML = item.code;
      while(tmp.firstChild) wrap.appendChild(tmp.firstChild);
    });
    (pack._jsCode||[]).forEach(function(item){
      var sc = document.createElement("script");
      sc.setAttribute("data-mod", pack.id);
      sc.textContent = "try{var Mod=window.ModSys.api("+JSON.stringify(pack.id)+");\n"+item.code+"\n}catch(e){alert('mod erro ("+pack.name+" / "+item.path+"): '+(e&&e.message||e));}";
      document.body.appendChild(sc); pack.nodes.push(sc);
    });
    try{ document.dispatchEvent(new CustomEvent('mod:on', {detail:{id:pack.id}})); }catch(e){}
    pack.enabled = true;
  }
};
window.ModSys.load();
})();
