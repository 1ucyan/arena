"use strict";
// QR Code Model 2 encoder: byte mode, versions 1–40, error correction M or better.
// Written for Arena so the page needs no network or third-party library; it follows the
// procedure of ISO/IEC 18004 as laid out in Project Nayuki's reference implementation.
const ArenaQR = (() => {
  // Indexed [level][version]; levels L, M, Q, H.
  const ECC = [
    [-1,7,10,15,20,26,18,20,24,30,18,20,24,26,30,22,24,28,30,28,28,28,28,30,30,26,28,30,30,30,30,30,30,30,30,30,30,30,30,30,30],
    [-1,10,16,26,18,24,16,18,22,22,26,30,22,22,24,24,28,28,26,26,26,26,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28],
    [-1,13,22,18,26,18,24,18,22,20,24,28,26,24,20,30,24,28,28,26,30,28,30,30,30,30,28,30,30,30,30,30,30,30,30,30,30,30,30,30,30],
    [-1,17,28,22,16,22,28,26,26,24,28,24,28,22,24,24,30,28,28,26,28,30,24,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30],
  ];
  const BLOCKS = [
    [-1,1,1,1,1,1,2,2,2,2,4,4,4,4,4,6,6,6,6,7,8,8,9,9,10,12,12,12,13,14,15,16,17,18,19,19,20,21,22,24,25],
    [-1,1,1,1,2,2,4,4,4,5,5,5,8,9,9,10,10,11,13,14,16,17,17,18,20,21,23,25,26,28,29,31,33,35,37,38,40,43,45,47,49],
    [-1,1,1,2,2,4,4,6,6,8,8,8,10,12,16,12,17,16,18,21,20,23,23,25,27,29,34,34,35,38,40,43,45,48,51,53,56,59,62,65,68],
    [-1,1,1,2,4,4,4,5,6,8,8,11,11,16,16,18,16,19,21,25,25,25,34,30,32,35,37,40,42,45,48,51,54,57,60,63,66,70,74,77,81],
  ];
  const FORMAT = [1,0,3,2];
  const MASKS = [
    (x,y)=>(x+y)%2===0, (x,y)=>y%2===0, (x,y)=>x%3===0, (x,y)=>(x+y)%3===0,
    (x,y)=>(Math.floor(x/3)+Math.floor(y/2))%2===0, (x,y)=>x*y%2+x*y%3===0,
    (x,y)=>(x*y%2+x*y%3)%2===0, (x,y)=>((x+y)%2+x*y%3)%2===0,
  ];

  // Reed–Solomon over GF(2^8) with the QR polynomial x^8+x^4+x^3+x^2+1.
  function multiply(x,y){let z=0;for(let i=7;i>=0;i--){z=(z<<1)^((z>>>7)*0x11d);z^=((y>>>i)&1)*x;}return z;}
  function divisor(degree){
    const result=new Array(degree).fill(0);result[degree-1]=1;let root=1;
    for(let i=0;i<degree;i++){
      for(let j=0;j<degree;j++){result[j]=multiply(result[j],root);if(j+1<degree)result[j]^=result[j+1];}
      root=multiply(root,2);
    }
    return result;
  }
  function remainder(data,div){
    const result=div.map(()=>0);
    for(const byte of data){const factor=byte^result.shift();result.push(0);div.forEach((c,i)=>{result[i]^=multiply(c,factor);});}
    return result;
  }
  function rawModules(v){
    let result=(16*v+128)*v+64;
    if(v>=2){const n=Math.floor(v/7)+2;result-=(25*n-10)*n-55;if(v>=7)result-=36;}
    return result;
  }
  const dataCodewords=(v,level)=>Math.floor(rawModules(v)/8)-ECC[level][v]*BLOCKS[level][v];
  function alignment(v){
    if(v===1)return [];
    const n=Math.floor(v/7)+2,step=Math.floor((v*8+n*3+5)/(n*4-4))*2,result=[6];
    for(let pos=v*4+10;result.length<n;pos-=step)result.splice(1,0,pos);
    return result;
  }

  function encode(text){
    const bytes=[...new TextEncoder().encode(text)];
    const need=v=>4+(v<10?8:16)+bytes.length*8;
    let v=1;
    while(need(v)>dataCodewords(v,1)*8)if(++v>40)throw Error('Ссылка слишком длинная для QR-кода.');
    let level=1;
    for(const better of [2,3])if(need(v)<=dataCodewords(v,better)*8)level=better;

    const bits=[],put=(value,length)=>{for(let i=length-1;i>=0;i--)bits.push((value>>>i)&1);};
    put(4,4);put(bytes.length,v<10?8:16);bytes.forEach(b=>put(b,8));
    const capacity=dataCodewords(v,level)*8;
    put(0,Math.min(4,capacity-bits.length));
    put(0,(8-bits.length%8)%8);
    for(let pad=0xec;bits.length<capacity;pad^=0xec^0x11)put(pad,8);
    const data=[];
    for(let i=0;i<bits.length;i+=8)data.push(bits.slice(i,i+8).reduce((a,b)=>a<<1|b,0));

    const blockCount=BLOCKS[level][v],eccLength=ECC[level][v],raw=Math.floor(rawModules(v)/8);
    const shortBlocks=blockCount-raw%blockCount,shortLength=Math.floor(raw/blockCount),div=divisor(eccLength),blocks=[];
    for(let i=0,k=0;i<blockCount;i++){
      const block=data.slice(k,k+shortLength-eccLength+(i<shortBlocks?0:1));k+=block.length;
      const ecc=remainder(block,div);if(i<shortBlocks)block.push(0);
      blocks.push(block.concat(ecc));
    }
    const words=[];
    for(let i=0;i<blocks[0].length;i++)blocks.forEach((block,j)=>{if(i!==shortLength-eccLength||j>=shortBlocks)words.push(block[i]);});

    const size=v*4+17;
    const dark=Array.from({length:size},()=>new Array(size).fill(false));
    const fixed=Array.from({length:size},()=>new Array(size).fill(false));
    const set=(x,y,on)=>{dark[y][x]=on;fixed[y][x]=true;};
    for(let i=0;i<size;i++){set(6,i,i%2===0);set(i,6,i%2===0);}
    for(const [cx,cy] of [[3,3],[size-4,3],[3,size-4]])
      for(let dy=-4;dy<=4;dy++)for(let dx=-4;dx<=4;dx++){
        const x=cx+dx,y=cy+dy,d=Math.max(Math.abs(dx),Math.abs(dy));
        if(x>=0&&x<size&&y>=0&&y<size)set(x,y,d!==2&&d!==4);
      }
    const align=alignment(v),last=align.length-1;
    align.forEach((ax,i)=>align.forEach((ay,j)=>{
      if((i===0&&j===0)||(i===0&&j===last)||(i===last&&j===0))return;
      for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++)set(ax+dx,ay+dy,Math.max(Math.abs(dx),Math.abs(dy))!==1);
    }));
    const format=mask=>{
      const value=FORMAT[level]<<3|mask;let rem=value;
      for(let i=0;i<10;i++)rem=(rem<<1)^((rem>>>9)*0x537);
      const word=(value<<10|rem)^0x5412,bit=i=>((word>>>i)&1)===1;
      for(let i=0;i<=5;i++)set(8,i,bit(i));
      set(8,7,bit(6));set(8,8,bit(7));set(7,8,bit(8));
      for(let i=9;i<15;i++)set(14-i,8,bit(i));
      for(let i=0;i<8;i++)set(size-1-i,8,bit(i));
      for(let i=8;i<15;i++)set(8,size-15+i,bit(i));
      set(8,size-8,true);
    };
    format(0);
    if(v>=7){
      let rem=v;for(let i=0;i<12;i++)rem=(rem<<1)^((rem>>>11)*0x1f25);
      const word=v<<12|rem;
      for(let i=0;i<18;i++){const on=((word>>>i)&1)===1,a=size-11+i%3,b=Math.floor(i/3);set(a,b,on);set(b,a,on);}
    }

    let n=0;
    for(let right=size-1;right>=1;right-=2){
      if(right===6)right=5;
      for(let vert=0;vert<size;vert++)for(let j=0;j<2;j++){
        const x=right-j,y=((right+1)&2)===0?size-1-vert:vert;
        if(!fixed[y][x]&&n<words.length*8){dark[y][x]=((words[n>>>3]>>>(7-(n&7)))&1)===1;n++;}
      }
    }

    const flip=mask=>{for(let y=0;y<size;y++)for(let x=0;x<size;x++)if(!fixed[y][x]&&MASKS[mask](x,y))dark[y][x]=!dark[y][x];};
    let best=0,lowest=Infinity;
    for(let mask=0;mask<8;mask++){
      flip(mask);format(mask);
      const score=penalty(dark,size);
      if(score<lowest){lowest=score;best=mask;}
      flip(mask);
    }
    flip(best);format(best);
    return {size,dark:(x,y)=>dark[y][x]};
  }

  // Lower is easier to scan: penalises long runs, 2×2 blocks, finder look-alikes and imbalance.
  function penalty(dark,size){
    let result=0;
    const line=at=>{
      let color=false,run=0;const history=[0,0,0,0,0,0,0];
      const add=length=>{if(history[0]===0)length+=size;history.pop();history.unshift(length);};
      const finders=()=>{
        const n=history[1],core=n>0&&history[2]===n&&history[3]===n*3&&history[4]===n&&history[5]===n;
        return (core&&history[0]>=n*4&&history[6]>=n?1:0)+(core&&history[6]>=n*4&&history[0]>=n?1:0);
      };
      for(let i=0;i<size;i++){
        if(at(i)===color){run++;if(run===5)result+=3;else if(run>5)result++;}
        else{add(run);if(!color)result+=finders()*40;color=at(i);run=1;}
      }
      if(color){add(run);run=0;}
      add(run+size);result+=finders()*40;
    };
    for(let y=0;y<size;y++)line(x=>dark[y][x]);
    for(let x=0;x<size;x++)line(y=>dark[y][x]);
    for(let y=0;y<size-1;y++)for(let x=0;x<size-1;x++){
      const c=dark[y][x];if(c===dark[y][x+1]&&c===dark[y+1][x]&&c===dark[y+1][x+1])result+=3;
    }
    let count=0;for(const row of dark)for(const c of row)if(c)count++;
    const total=size*size;
    return result+(Math.ceil(Math.abs(count*20-total*10)/total)-1)*10;
  }

  /** SVG markup with a four-module quiet zone; label is plain text for screen readers. */
  function svg(text,label){
    const q=encode(text),n=q.size+8;let d='';
    for(let y=0;y<q.size;y++)for(let x=0;x<q.size;){
      if(!q.dark(x,y)){x++;continue;}
      let w=1;while(x+w<q.size&&q.dark(x+w,y))w++;
      d+='M'+(x+4)+' '+(y+4)+'h'+w+'v1h-'+w+'z';x+=w;
    }
    const safe=String(label).replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';');
    return '<svg class="qr" viewBox="0 0 '+n+' '+n+'" role="img" aria-label="'+safe+'" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg"><rect width="'+n+'" height="'+n+'" fill="#fff"/><path fill="#000" d="'+d+'"/></svg>';
  }

  /** A PNG for printing, scale pixels per module. */
  function png(text,scale=16){
    const q=encode(text),n=q.size+8,canvas=document.createElement('canvas');
    canvas.width=canvas.height=n*scale;
    const g=canvas.getContext('2d');
    g.fillStyle='#fff';g.fillRect(0,0,canvas.width,canvas.height);g.fillStyle='#000';
    for(let y=0;y<q.size;y++)for(let x=0;x<q.size;x++)if(q.dark(x,y))g.fillRect((x+4)*scale,(y+4)*scale,scale,scale);
    return new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('Не удалось подготовить изображение.')),'image/png'));
  }

  return {encode,svg,png};
})();
if(typeof module!=="undefined"&&module.exports)module.exports=ArenaQR;
