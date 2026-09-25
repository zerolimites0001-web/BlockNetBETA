// LevelNoise — Perlin + Simplex do zero (sem CDN), seedável
var LevelNoise = (function(){
  function mulberry(seed){
    var a = seed>>>0;
    return function(){
      a |= 0; a = (a + 0x6D2B79F5)|0;
      var t = Math.imul(a ^ (a>>>15), 1|a);
      t = (t + Math.imul(t ^ (t>>>7), 61|t))^t;
      return ((t ^ (t>>>14))>>>0)/4294967296;
    };
  }
  // ---- Perlin improved (2D) ----
  var perm = new Uint8Array(512);
  (function(){
    var rand = mulberry(1337), p = [];
    for(var i=0;i<256;i++)p[i]=i;
    for(var j=255;j>0;j--){var k=(rand()*(j+1))|0;var t=p[j];p[j]=p[k];p[k]=t;}
    for(var q=0;q<512;q++)perm[q]=p[q&255];
  })();
  function fade(t){return t*t*t*(t*(t*6-15)+10);}
  function lerp(a,b,t){return a+t*(b-a);}
  function grad(h,x,y){
    switch(h&7){
      case 0:return x+y; case 1:return x-y; case 2:return -x+y; case 3:return -x-y;
      case 4:return x; case 5:return -x; case 6:return y; default:return -y;
    }
  }
  function perlin(x,y){
    var X=Math.floor(x)&255, Y=Math.floor(y)&255;
    x-=Math.floor(x); y-=Math.floor(y);
    var u=fade(x), v=fade(y);
    var aa=perm[perm[X]+Y], ab=perm[perm[X]+Y+1];
    var ba=perm[perm[X+1]+Y], bb=perm[perm[X+1]+Y+1];
    return lerp(
      lerp(grad(aa,x,y),   grad(ba,x-1,y),u),
      lerp(grad(ab,x,y-1), grad(bb,x-1,y-1),u), v)*0.7071; // ~[-1,1]
  }
  // ---- Simplex 2D (Gustavson) ----
  var G2=(3-Math.sqrt(3))/6, F2=0.5*(Math.sqrt(3)-1);
  var grad2=[[1,1],[-1,1],[1,-1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]];
  function simplex(x,y){
    var s=(x+y)*F2, i=Math.floor(x+s), j=Math.floor(y+s);
    var t=(i+j)*G2, x0=x-(i-t), y0=y-(j-t);
    var i1=x0>y0?1:0, j1=x0>y0?0:1;
    var x1=x0-i1+G2, y1=y0-j1+G2, x2=x0-1+2*G2, y2=y0-1+2*G2;
    var ii=i&255, jj=j&255, n=0;
    var t0=0.5-x0*x0-y0*y0;
    if(t0>0){t0*=t0;var g=grad2[perm[ii+perm[jj]]&7];n+=t0*t0*(g[0]*x0+g[1]*y0);}
    var t1=0.5-x1*x1-y1*y1;
    if(t1>0){t1*=t1;var g1=grad2[perm[ii+i1+perm[jj+j1]]&7];n+=t1*t1*(g1[0]*x1+g1[1]*y1);}
    var t2=0.5-x2*x2-y2*y2;
    if(t2>0){t2*=t2;var g2=grad2[perm[ii+1+perm[jj+1]]&7];n+=t2*t2*(g2[0]*x2+g2[1]*y2);}
    return 70*n; // ~[-1,1]
  }
  // ---- fractais ----
  function fbm(fn,x,y,oct,lac,gain){
    var a=0.5,f=1,sum=0,norm=0;
    for(var i=0;i<oct;i++){sum+=a*fn(x*f,y*f);norm+=a;a*=gain;f*=lac;}
    return sum/norm; // ~[-1,1]
  }
  function perlinFbm(x,y,oct){return fbm(perlin,x,y,oct||4,2.02,0.5);}
  function simplexFbm(x,y,oct){return fbm(simplex,x,y,oct||4,2.02,0.5);}
  function ridged(x,y,oct){
    var a=0.5,f=1,sum=0,norm=0;
    for(var i=0;i<oct;i++){var n=1-Math.abs(simplex(x*f,y*f));n=n*n;sum+=a*n;norm+=a;a*=0.5;f*=2.1;}
    return sum/norm; // [0,1]
  }
  // ---- Perlin 3D real (com grad3) ----
  var grad3=[[1,1,0],[-1,1,0],[1,-1,0],[-1,-1,0],[1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1],[0,1,1],[0,-1,1],[0,1,-1],[0,-1,-1]];
  function perlin3(x,y,z){
    var X=Math.floor(x)&255,Y=Math.floor(y)&255,Z=Math.floor(z)&255;
    x-=Math.floor(x); y-=Math.floor(y); z-=Math.floor(z);
    var u=fade(x),v=fade(y),w=fade(z);
    var A=perm[X]+Y,AA=perm[A]+Z,AB=perm[A+1]+Z,B=perm[X+1]+Y,BA=perm[B]+Z,BB=perm[B+1]+Z;
    function g(h,x,y,z){ var gg=grad3[h%12]; return gg[0]*x+gg[1]*y+gg[2]*z; }
    var a=g(perm[AA],x,y,z),b=g(perm[BA],x-1,y,z),c=g(perm[AB],x,y-1,z),d=g(perm[BB],x-1,y-1,z);
    var e=g(perm[AA+1],x,y,z-1),f=g(perm[BA+1],x-1,y,z-1),gg=g(perm[AB+1],x,y-1,z-1),h2=g(perm[BB+1],x-1,y-1,z-1);
    return lerp(lerp(lerp(a,b,u),lerp(c,d,u),v),lerp(lerp(e,f,u),lerp(gg,h2,u),v),w)*0.964;
  }
  function caveNoise(x,y,z){ return perlin3(x*0.08,y*0.09,z*0.08)*0.6 + perlin3(x*0.18,y*0.22,z*0.18)*0.4; }
  return {perlin:perlin, simplex:simplex, fbm:perlinFbm, simplexFbm:simplexFbm, ridged:ridged, perlin3:perlin3, caveNoise:caveNoise};
})();
