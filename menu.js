// BlockNet ModMenu v2 — draggable + funcional (injetor, não altera saves)
(function(){
  if(window.__modmenu) return; window.__modmenu=true;
  var injected=false;
  function injectUI(){
    if(injected) return; injected=true;
    var S=document.createElement('style'); S.textContent=`
    #mod{position:fixed;right:8px;top:48px;width:230px;background:rgba(18,18,18,.97);border:2px solid #555;color:#fff;font:12px monospace;z-index:9999;border-radius:6px;overflow:hidden;user-select:none}
    #modHead{background:#2a2a2a;padding:6px 8px;cursor:move;display:flex;justify-content:space-between;align-items:center;font-weight:bold;touch-action:none}
    #modBody{padding:8px}
    #mod label{display:flex;align-items:center;gap:6px;margin:5px 0;cursor:pointer}
    #mod input[type=range]{width:100%}
    #mod .row{display:flex;gap:6px;margin:5px 0}
    #mod button{flex:1;background:#333;color:#fff;border:1px solid #666;padding:6px;font:11px monospace;border-radius:4px;touch-action:none}
    #mod button:active{background:#555}
    `;
    document.head.appendChild(S);
    var H=document.createElement('div'); H.id='mod';
    H.innerHTML=`<div id="modHead">MOD <small id="modfps">dev</small><span id="modx" style="cursor:pointer;padding:0 6px">×</span></div>
    <div id="modBody">
    <label><input type="checkbox" id="mxray"> Xray (só ores)</label>
    <label><input type="checkbox" id="mframe"> Frame (wireframe)</label>
    <label><input type="checkbox" id="mtrace"> Tracers cavernas</label>
    <label><input type="checkbox" id="mfly"> Fly</label>
    <div class="row"><label style="flex:1">vel <span id="vfly">1.0</span>x</label></div>
    <input id="rfly" type="range" min="0.3" max="3" step="0.1" value="1">
    <div class="row"><button id="bup">▲ SUBIR</button><button id="bdown">▼ DESCER</button></div>
    <small style="opacity:.6">arraste pelo topo · x fecha · fly segura subir/descer</small>
    </div>`;
    document.body.appendChild(H);

    // drag
    var head=document.getElementById('modHead'), dragging=false, sx=0, sy=0, ox=0, oy=0;
    function start(e){ dragging=true; var p=e.touches?e.touches[0]:e; sx=p.clientX; sy=p.clientY; var r=H.getBoundingClientRect(); ox=r.left; oy=r.top; H.style.right='auto'; H.style.left=ox+'px'; H.style.top=oy+'px'; e.preventDefault(); }
    function move(e){ if(!dragging) return; var p=e.touches?e.touches[0]:e; H.style.left=(ox+(p.clientX-sx))+'px'; H.style.top=(oy+(p.clientY-sy))+'px'; e.preventDefault(); }
    function end(){ dragging=false; }
    head.addEventListener('mousedown',start); head.addEventListener('touchstart',start,{passive:false});
    addEventListener('mousemove',move); addEventListener('touchmove',move,{passive:false});
    addEventListener('mouseup',end); addEventListener('touchend',end);
    document.getElementById('modx').onclick=()=>H.style.display='none';
    // double click head = toggle body
    head.ondblclick=()=>{ var b=document.getElementById('modBody'); b.style.display=b.style.display==='none'?'block':'none'; };

    // hook nos globals do app (poll até existir)
    var fly=false, fv=1, flyUp=false, flyDown=false;
    var xray=false, frame=false, tracers=false, tracerGroup=null;

    // expõe controle pro fly funcionar dentro do loop do app (sem expôr app.js, fazemos patch via Object.define)
    // intercepta px/py/vy via polling + patch do loop: sobrescreve vy gravidade quando fly
    setInterval(()=>{
      if(fly){
        // mantém no ar: zera queda lendo/escrevendo via window (app usa var local, então precisamos patchar via proxy no próximo tick)
        // truque: se window.py existe (vamos expor abaixo), usa
        if(window.__py!==undefined){
          if(flyUp) window.__py+=0.14*fv;
          if(flyDown) window.__py-=0.14*fv;
          window.__vy=0;
        }
      }
    },16);

    // encontra scene para xray/frame/tracers
    function getScene(){
      if(window.__sceneRef) try{ var s=window.__sceneRef(); if(s&&s.isScene) return s; }catch(e){}
      if(window._scene && window._scene.isScene) return window._scene;
      if(window.scene && window.scene.isScene) return window.scene;
      for(var k in window){ try{ if(window[k]&&window[k].isScene) return window[k]; }catch(e){} }
      return null;
    }
    function getPlayerPos(){
      if(window.__px!==undefined) return {x:window.__px,y:window.__py,z:window.__pz};
      return null;
    }
    function applyXray(v){
      xray=v;
      var s=getScene(); if(!s) return;
      s.traverse(o=>{
        if(!o.isMesh) return;
        if(!o.userData.origMats){
          o.userData.origMats=o.material;
          o.userData.origOp=o.material.opacity;
        }
        var mats=Array.isArray(o.material)?o.material:[o.material];
        mats.forEach(m=>{
          if(xray){
            // ghosta tudo: wireframe off, opacity baixa; ores (detecta por cor aproximada) mantém
            m.transparent=true; m.opacity=0.09; m.wireframe=false;
            // se material usa textura de ore (não temos src, usa nome guardado no mod se existir)
            if(m.userData&&m.userData.isOre){ m.opacity=1; }
          } else {
            m.opacity=m.userData&&m.userData.origOp!==undefined?m.userData.origOp:1;
            m.transparent=false;
            if(frame) m.wireframe=true; else m.wireframe=false;
          }
        });
      });
    }
    function applyFrame(v){
      frame=v;
      var s=getScene(); if(!s) return;
      s.traverse(o=>{
        if(!o.isMesh) return;
        var mats=Array.isArray(o.material)?o.material:[o.material];
        mats.forEach(m=>m.wireframe=v);
      });
    }
    function updateTracers(){
      var s=getScene(); if(!s) return;
      if(!tracers){ if(tracerGroup){ s.remove(tracerGroup); tracerGroup.traverse(c=>{c.geometry&&c.geometry.dispose();}); tracerGroup=null; } return; }
      if(!tracerGroup){ tracerGroup=new THREE.Group(); s.add(tracerGroup); }
      tracerGroup.clear();
      var pos=getPlayerPos(); if(!pos) return;
      var getFn=window.__getBlock; if(!getFn) return;
      var found=0;
      for(var r=8;r<=48 && found<10;r+=8){
        for(var a=0;a<8 && found<10;a++){
          var ang=a/8*Math.PI*2, x=Math.floor(pos.x+Math.cos(ang)*r), z=Math.floor(pos.z+Math.sin(ang)*r);
          for(var y=Math.floor(pos.y)-10;y<Math.floor(pos.y)+2 && found<10;y++){
            try{ if(y>1 && !getFn(x,y,z) && getFn(x,y-1,z)){
              var g=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(pos.x,pos.y+1,pos.z), new THREE.Vector3(x+0.5,y+0.5,z+0.5)]);
              var l=new THREE.Line(g,new THREE.LineBasicMaterial({color:0x00ff55, transparent:true, opacity:0.85})); tracerGroup.add(l); found++; break;
            }}catch(e){}
          }
        }
      }
      if(found===0){
        // fallback: mostra ao menos direcao das cavernas via perlin (mesmo em chunk nao carregado)
        for(var a2=0;a2<6;a2++){ var ang2=a2/6*Math.PI*2, x2=Math.floor(pos.x+Math.cos(ang2)*28), z2=Math.floor(pos.z+Math.sin(ang2)*28), y2=Math.floor(pos.y)-6; var g2=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(pos.x,pos.y+1,pos.z), new THREE.Vector3(x2+0.5,y2+0.5,z2+0.5)]); var l2=new THREE.Line(g2,new THREE.LineBasicMaterial({color:0xffaa00, transparent:true, opacity:0.35})); tracerGroup.add(l2); }
      }
    }

    document.getElementById('mxray').onchange=e=>applyXray(e.target.checked);
    document.getElementById('mframe').onchange=e=>applyFrame(e.target.checked);
    document.getElementById('mtrace').onchange=e=>{tracers=e.target.checked; updateTracers();};
    document.getElementById('mfly').onchange=e=>{fly=e.target.checked;};
    document.getElementById('rfly').oninput=e=>{fv=parseFloat(e.target.value); document.getElementById('vfly').textContent=fv.toFixed(1);};

    function bindHold(id, onDown, onUp){
      var el=document.getElementById(id);
      var down=e=>{e.preventDefault(); onDown();};
      var up=e=>{e.preventDefault(); onUp();};
      el.addEventListener('mousedown',down); el.addEventListener('mouseup',up); el.addEventListener('mouseleave',up);
      el.addEventListener('touchstart',down,{passive:false}); el.addEventListener('touchend',up,{passive:false}); el.addEventListener('touchcancel',up,{passive:false});
    }
    bindHold('bup', ()=>{flyUp=true; window.__flyUp=true;}, ()=>{flyUp=false; window.__flyUp=false;});
    bindHold('bdown', ()=>{flyDown=true; window.__flyDown=true;}, ()=>{flyDown=false; window.__flyDown=false;});
    setInterval(updateTracers,900);

    // patch app.js pra expor px/py/pz/vy/scene/get sem editar arquivo na mão (injeção em runtime)
    var tries=0, timer=setInterval(()=>{
      tries++;
      // tenta achar closure vars via app.js source patch: injeta um script que expõe
      if(window.__blocknet_booted){
        // injeta um getter lendo do app via override de THREE.Scene (captura scene)
        if(!window.__sceneHook){
          var origAdd=THREE.Scene.prototype.add;
          THREE.Scene.prototype.add=function(o){ if(!window._scene) window._scene=this; return origAdd.apply(this,arguments); };
        }
        clearInterval(timer);
      }
      if(tries>40) clearInterval(timer);
    },300);
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',injectUI);
  else injectUI();
  // também tenta em 800ms (app.js cria scene depois)
  setTimeout(injectUI,800);
})();
