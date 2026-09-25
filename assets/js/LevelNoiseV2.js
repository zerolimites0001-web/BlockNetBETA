// LevelNoiseV2 — terreno rico, nao repetitivo. Mesmo protocolo do original:
// recebe {type:'gen', cx, cz, seed} → responde {type:'chunk', cx, cz, blocks:[[x,y,z,b],...]}
// Domain-warped simplex 2D com seed (implementacao propria, sem dependencia).
var CS = 16, SEA = 12;

// ---- hash/gradiente seeded ----
function makeNoise2D(seed){
  var p = new Uint8Array(512);
  var perm = new Uint8Array(256);
  for(var i=0;i<256;i++) perm[i]=i;
  var s = seed>>>0 || 1;
  function rnd(){ s^=s<<13; s>>>=0; s^=s>>>17; s^=s<<5; s>>>=0; return s/4294967296; }
  for(var i=255;i>0;i--){ var j=(rnd()*(i+1))|0; var t=perm[i]; perm[i]=perm[j]; perm[j]=t; }
  for(var i=0;i<512;i++) p[i]=perm[i&255];
  var G=[[1,1],[-1,1],[1,-1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]];
  var F2=0.5*(Math.sqrt(3)-1), G2=(3-Math.sqrt(3))/6;
  function dot(g,x,y){ return g[0]*x+g[1]*y; }
  function noise(xin,yin){
    var n0,n1,n2, s_=(xin+yin)*F2, i=Math.floor(xin+s_), j=Math.floor(yin+s_);
    var t=(i+j)*G2, X0=i-t, Y0=j-t, x0=xin-X0, y0=yin-Y0, i1,j1;
    if(x0>y0){i1=1;j1=0;}else{i1=0;j1=1;}
    var x1=x0-i1+G2, y1=y0-j1+G2, x2=x0-1+2*G2, y2=y0-1+2*G2;
    var ii=i&255, jj=j&255, t0=0.5-x0*x0-y0*y0, t1=0.5-x1*x1-y1*y1, t2=0.5-x2*x2-y2*y2;
    if(t0<0)n0=0;else{t0*=t0; n0=t0*t0*dot(G[p[ii+p[jj]]&7],x0,y0);}
    if(t1<0)n1=0;else{t1*=t1; n1=t1*t1*dot(G[p[ii+i1+p[jj+j1]]&7],x1,y1);}
    if(t2<0)n2=0;else{t2*=t2; n2=t2*t2*dot(G[p[ii+1+p[jj+1]]&7],x2,y2);}
    return 70*(n0+n1+n2); // ~[-1,1]
  }
  return noise;
}
var _nz=null,_seed=null;
function NZ(seed){ if(!_nz||_seed!==seed){ _nz=makeNoise2D(seed*1013904223+7); _seed=seed; } return _nz; }
function fbm(nz,x,y,oct,lac,gain){
  var a=0.5,f=1,sum=0,norm=0;
  for(var i=0;i<oct;i++){ sum+=a*nz(x*f,y*f); norm+=a; a*=gain; f*=lac; }
  return sum/norm;
}
function rnd(x,y,z,s){
  var h=(x*374761393+y*668265263+z*2147483647+s*1442695041)|0;
  h=(h^(h>>13))|0; h=(h*1274126177)|0; h=(h^(h>>16))>>>0;
  return h/4294967295;
}
function biomeAt(X,Z,SD){
  var nz=NZ(SD), sf=SD*0.001;
  // domain warp: quebra repeticao
  var wx=fbm(nz,X*0.0011+sf,Z*0.0011-sf,3,2.03,0.5)*28;
  var wz=fbm(nz,X*0.0011-sf+300,Z*0.0011+sf+300,3,2.03,0.5)*28;
  var px=X+wx, pz=Z+wz;
  var cont=fbm(nz,px*0.00055+777+sf,pz*0.00055-777-sf,4,2.05,0.5); // -1..1 continentes
  var hills=fbm(nz,px*0.004+sf,pz*0.004-sf,4,2.1,0.5);
  var detail=nz(px*0.02-500-sf,pz*0.02+500+sf)*1.5;
  var r1=1-Math.abs(fbm(nz,px*0.0016+200+sf,pz*0.0016-200-sf,4,2.1,0.5));
  var mount=r1*r1*88;
  var mask=cont*0.5+0.5;
  var m=mask*mask*(3-2*mask);
  var h=Math.floor(13+hills*7*(1-m)+(hills*6+mount)*m+detail);
  if(h<3)h=3;
  // rio: linha fina onde r2~0
  var r2=Math.abs(fbm(nz,px*0.0012-900+sf,pz*0.0012+400-sf,3,2.0,0.5));
  var river=r2<0.035&&h>SEA-1;
  var moist=fbm(nz,px*0.006-400+sf*2,pz*0.006+200-sf,3,2.0,0.5);
  var type;
  if(river){ type='river'; }
  else if(h<=SEA-2){h=SEA-2;type='ocean';}
  else if(h<=SEA){type='beach';}
  else if(m>0.5&&h>SEA+14){type='mountain';}
  else if(moist>0.1){type='forest';}
  else if(moist<-0.25){type='desert';}
  else{type='plains';}
  return {h:h,type:type,m:m,river:river};
}
onmessage=function(e){
  var m=e.data; if(m.type!=='gen')return;
  var cx=m.cx,cz=m.cz,seed=m.seed,out=[];
  for(var x=0;x<CS;x++)for(var z=0;z<CS;z++){
    var wx=cx*CS+x,wz=cz*CS+z;
    var bi=biomeAt(wx,wz,seed),h=bi.h,t=bi.type;
    for(var y=0;y<=h;y++){
      var b;
      if(y===0)b='bedrock';
      else if(y===1&&rnd(wx,y,wz,seed+5)<0.5)b='bedrock';
      else if(t==='river'){ b=y===h?'sand':(y>h-2?'dirt':'stone'); }
      else if(t==='ocean')b=y===h?'sand':(y>h-2?'dirt':'stone');
      else if(t==='beach'||t==='desert')b=y===h?'sand':(y>h-3?'sand':'stone');
      else if(t==='mountain')b=y===h?(h>SEA+45?'snow':(h>SEA+30?'rock':(h>SEA+12?'stone':'grass'))):(y>h-3?(h>SEA+30?'stone':'dirt'):'stone');
      else b=y===h?'grass':(y>h-2?'dirt':'stone');
      if(b==='stone'){
        var or=rnd(wx,y,wz,seed+99);
        if(y<=4&&or<0.02)b='diamond_ore';
        else if(y<=6&&or<0.045)b='gold_ore';
        else if(y<=14&&or<0.09)b='iron_ore';
        else if(or<0.12)b='coal_ore';
        else if(or>0.985)b='gravel';
      }
      if(b==='dirt'&&rnd(wx,y,wz,seed+31)<0.06)b='clay';
      if(b==='sand'&&t!=='ocean'&&t!=='beach'&&rnd(wx,y,wz,seed+32)<0.15)b='gravel';
      if(y>2&&y<h-2){
        var nz=NZ(seed);
        var s1=nz(wx*0.045+wz*0.013+seed*0.01,y*0.06-wz*0.02);
        var s2=nz(wx*0.02-wz*0.05-seed*0.01,y*0.055+wx*0.017);
        if(Math.abs(s1)<0.09&&Math.abs(s2)<0.09)continue;
      }
      out.push([wx,y,wz,b]);
    }
    var td=t==='forest'?0.03:(t==='plains'?0.008:(t==='river'?0.015:0.0));
    var tree=td>0&&rnd(wx,wz,7,seed)<td;
    if(tree){
      var blocked=false;
      for(var ox=-1;ox<=1&&!blocked;ox++)for(var oz=-1;oz<=1&&!blocked;oz++){
        if(!ox&&!oz)continue;
        if(rnd(wx+ox,wz+oz,7,seed)<td*2)blocked=true;
      }
      if(blocked)tree=false;
    }
    if(tree&&h>SEA&&h<SEA+14&&bi.m<0.4){
      var th=4+((rnd(wx,h,wz,seed+7)*2)|0),top=h+th,i,dx,dz;
      for(i=1;i<=th;i++)out.push([wx,h+i,wz,'wood']);
      var seen={};
      function leaf(x,y,z){var k=x+','+y+','+z;if(seen[k])return;seen[k]=1;out.push([x,y,z,'leaves']);}
      for(dx=-2;dx<=2;dx++)for(dz=-2;dz<=2;dz++){
        if(Math.abs(dx)===2&&Math.abs(dz)===2)continue;
        if(dx===0&&dz===0)continue;
        leaf(wx+dx,top-1,wz+dz);leaf(wx+dx,top,wz+dz);
      }
      for(var dx2=-1;dx2<=1;dx2++)for(var dz2=-1;dz2<=1;dz2++){
        if(dx2===0&&dz2===0)continue;
        leaf(wx+dx2,top+1,wz+dz2);
      }
      leaf(wx,top+1,wz);leaf(wx,top+2,wz);
    }
    if(h<SEA)for(var w=h+1;w<=SEA;w++)out.push([wx,w,wz,'water']);
    if(t==='river')for(var w2=h+1;w2<=SEA;w2++)out.push([wx,w2,wz,'water']);
  }
  postMessage({type:'chunk',cx:cx,cz:cz,blocks:out});
};
