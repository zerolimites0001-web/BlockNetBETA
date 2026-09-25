// perlindebug/worker.js — refeito do zero com noisejs (CDN, seed 1337)
importScripts('noisejs.js');
var NZ = new Noise(1337);
// simplex fbm (planicie + mascara base)
function sFbm(x,y,oct){ var a=0.5,f=1,s=0,n=0; for(var i=0;i<oct;i++){ s+=a*NZ.simplex2(x*f,y*f); n+=a; a*=0.5; f*=2.02; } return s/n; }
// perlin fbm (mascara de cordilheira)
function pFbm(x,y,oct){ var a=0.5,f=1,s=0,n=0; for(var i=0;i<oct;i++){ s+=a*NZ.perlin2(x*f,y*f); n+=a; a*=0.5; f*=2.02; } return s/n; }
// perlin ridged (crista da montanha)
function ridge(x,y,oct){ var a=0.5,f=1,s=0,n=0; for(var i=0;i<oct;i++){ var v=1-Math.abs(NZ.perlin2(x*f,y*f)); s+=a*v*v; n+=a; a*=0.5; f*=2.1; } return s/n; }
function biomeAt(X,Z){
  var plains = sFbm(X*0.004, Z*0.004, 3)*2.0;          // simplex: planicie +-2.5
  var mask = pFbm(X*0.00045+777, Z*0.00045-777, 2);      // perlin: mascara baixa freq
  var m = Math.max(0,(mask+0.08)/0.30); m=Math.min(1,m); m=m*m*(3-2*m);
  var r = ridge(X*0.0016+200, Z*0.0016-200, 4);          // perlin ridged: crista ate ~1
  var det = NZ.simplex2(X*0.02-500, Z*0.02+500);       // simplex: detalhe
  var mountH = r*60 + det*2.0;
  var h = Math.floor(9 + plains*(1-m) + (plains+mountH)*m);
  return h<4?4:h;
}
onmessage=function(e){
  var m=e.data;
  if(m.type!=='gen') return;
  var out=[];
  for(var x=0;x<16;x++) for(var z=0;z<16;z++)
    out.push([x,z,biomeAt(m.cx*16+x, m.cz*16+z)]);
  postMessage({type:'chunk', cx:m.cx, cz:m.cz, hs:out});
};
