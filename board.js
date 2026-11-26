"use strict";
// The graphic part of a tournament: brackets, the table of meetings and the standings.
// Tiles are buttons only when editable; viewers and the screens get the same tiles as text.
const Board=(()=>{
  const knockFormat=s=>s.format==='single'||s.format==='double';
  const isLive=m=>!!m.live&&!m.score;
  // Bracket lines: a tile or a bye is a node, and each participant row names the node it came from.
  const data=(name,value)=>value?raw(' data-'+name+'="'+esc(value)+'"'):'';
  const roundName=(n,round)=>n===2?'Финал':n===4?'Полуфинал':n===8?'Четвертьфинал':n===16?'1/8 финала':'Раунд '+round;

  function matchTile(s,m,link,editable){
    const live=isLive(m),shown=m.score??(live?m.live:null);
    const info=[live&&'Идёт',m.court&&'Площадка '+m.court].filter(Boolean).join(' · ');
    const inner=html`${m.draws?.length?html`<small class="replayLabel">Переигровка после ${m.draws.at(-1).join(' : ')}</small>`:''}${info?html`<small class="fixtureInfo">${info}</small>`:''}${
      [m.a,m.b].map((id,i)=>html`<span class="fixtureTeam${m.winner===id?' won':''}"${data('from',link.from?.[i])}><span>${s.players[id]}</span><b>${shown?shown[i]:'—'}</b></span>`)}`;
    const cls='fixture'+(live?' live':'');
    if(!editable)return html`<div class="${cls}"${data('node',link.node)}>${inner}</div>`;
    const state=m.score?'счёт '+m.score.join(' : ')+', изменить результат':live?'идёт, счёт '+m.live.join(' : ')+', обновить':'ввести счёт';
    return html`<button class="${cls}"${data('node',link.node)} data-act="match" data-id="${m.id}" aria-label="${s.players[m.a]+' — '+s.players[m.b]+', '+state}">${inner}</button>`;
  }
  const futureTile=(a,b,link={})=>html`<div class="fixture future"${data('node',link.node)}>${[a,b].map((name,i)=>html`<span class="fixtureTeam"${data('from',link.from?.[i])}>${name}</span>`)}</div>`;
  const byeTile=b=>html`<div class="fixture bye"${data('node',b.node)}><small class="fixtureInfo">Проход без игры</small><span class="fixtureTeam won"${data('from',b.from)}><span>${b.name}</span></span></div>`;
  const column=(title,tiles)=>html`<div class="bracketRound"><h4>${title}</h4><div class="roundBody">${tiles}</div></div>`;
  const panel=(title,content)=>html`<section class="panel"><h3>${title}</h3>${content}</section>`;

  // Play-off pairs in the order engine.js draws them: group winners cross with the runners-up.
  function playoffDraw(s){
    const ranks=Object.keys(s.groups).map(g=>E.table(s,g).slice(0,2).map(r=>r.id));
    if(ranks.length===1)return ranks[0];
    const draw=[];
    for(let i=0;i<ranks.length;i+=2)draw.push(ranks[i][0],ranks[i+1][1],ranks[i+1][0],ranks[i][1]);
    return draw;
  }
  function elimination(s,editable){
    const draw=s.format==='groups'?playoffDraw(s):s.seed;
    // Each slot carries the node it came from, so the next round's rows can be joined to it.
    let slots=draw.map((id,i)=>({name:s.format==='groups'&&!s.playoff?'Место в плей-офф '+(i+1):s.players[id],node:null}));
    const columns=[];
    for(let round=1;slots.length>1;round++){
      const n=slots.length,power=2**Math.floor(Math.log2(n)),playing=n===power?n:2*(n-power);
      const matches=s.matches.filter(m=>m.phase==='knock'&&m.round===round);
      const byes=slots.slice(playing).map((slot,i)=>({name:slot.name,node:'b'+round+'-'+i,from:slot.node}));
      const winners=[];
      for(let i=0;i<playing;i+=2){
        const m=matches[i/2],link={node:'k'+round+'-'+i/2,from:[slots[i].node,slots[i+1].node]};
        winners.push({name:m?.score?s.players[m.winner]:'Победитель пары '+(i/2+1),node:link.node,
          tile:m?matchTile(s,m,link,editable):futureTile(slots[i].name,slots[i+1].name,link)});
      }
      // The column lists byes and matches in the order the next round is drawn, so the lines run
      // straight: under rules 2 and later a bye, then a match, and so on.
      const advancing=s.rules>=2?E.afterByes(byes,winners):[...byes,...winners];
      columns.push(column(roundName(n,round),advancing.map(x=>x.tile??byeTile(x))));
      slots=advancing;
    }
    // Match for third place (rules 3): shown under the bracket once the draw has two semi-finals.
    const third=s.matches.find(m=>m.phase==='third');
    const thirdPlace=s.rules>=3&&(third||draw.length>=4)?html`<div class="bracket thirdPlace">${column('Матч за 3-е место',[third?matchTile(s,third,{},editable):futureTile('Проигравший полуфинала 1','Проигравший полуфинала 2')])}</div>`:'';
    return panel('Сетка плей-офф',html`<div class="bracket tree">${columns}</div>${thirdPlace}`);
  }
  function doubleLanes(s,editable){
    const lanes=[['Верхняя сетка',m=>m.label.startsWith('Верхняя'),'Здесь появятся участники после первого поражения.'],
      ['Нижняя сетка',m=>m.label.startsWith('Нижняя'),'Здесь появятся участники после первого поражения.'],
      ['Финал',m=>m.phase==='final','Финальная пара определится по результатам раундов.']];
    return lanes.map(([name,accept,empty])=>{
      const rounds=new Map();
      for(const m of s.matches)if(accept(m))(rounds.get(m.round)??rounds.set(m.round,[]).get(m.round)).push(m);
      if(!rounds.size)return panel(name,html`<p class="small">${empty}</p>`);
      // A participant's row is joined to the match they played in this lane's previous round.
      const list=[...rounds.values()];
      const cols=list.map((ms,i)=>column(ms[0].phase==='final'?ms[0].label:'Раунд '+ms[0].round,ms.map(m=>matchTile(s,m,{node:'m'+m.id,
        from:[m.a,m.b].map(id=>{const p=i>0&&list[i-1].find(x=>x.a===id||x.b===id);return p?'m'+p.id:null;})},editable))));
      return panel(name,html`<div class="bracket tree">${cols}</div>`);
    });
  }
  function meetings(s,g,editable){
    const ids=g===null?s.seed:s.groups[g],lookup=new Map();
    for(const m of s.matches)if(m.phase==='league'&&m.group===g){lookup.set(m.a+'/'+m.b,m);lookup.set(m.b+'/'+m.a,m);}
    const name=id=>html`<span class="cellName">${s.players[id]}</span>`;
    const cell=(id,opp)=>{
      if(opp===id)return html`<td class="diagonal" aria-label="Один участник">·</td>`;
      const m=lookup.get(id+'/'+opp);if(!m)return html`<td>—</td>`;
      const live=isLive(m),shown=m.score??(live?m.live:null);
      const value=shown?(m.a===id?shown:[shown[1],shown[0]]).join(' : '):editable?'+':'—';
      const cls='cellScore '+(m.score?(m.winner===id?'win':m.winner===null?'draw':'loss'):live?'live':'');
      if(!editable)return html`<td><span class="${cls}"${live?raw(' title="Матч идёт"'):''}>${value}</span></td>`;
      return html`<td><button class="${cls}" data-act="match" data-id="${m.id}" aria-label="${s.players[id]+' — '+s.players[opp]+', '+(m.score?value:live?'идёт, '+value:'ввести счёт')}">${value}</button></td>`;
    };
    return panel(g===null?'Встречи участников':'Группа '+g+': встречи участников',html`<div class="tablescroll"><table class="matrix"><thead><tr><th scope="col">Участник</th>${ids.map(id=>html`<th scope="col">${name(id)}</th>`)}</tr></thead><tbody>${
      ids.map(id=>html`<tr><th scope="row">${name(id)}</th>${ids.map(opp=>cell(id,opp))}</tr>`)}</tbody></table></div>`);
  }
  /** Brackets, and for round-robin play the table of meetings. The bracket screen (screen) shows
   *  the groups until the play-off starts, then the play-off alone. */
  function bracket(s,{editable=false,screen=false}={}){
    if(s.format==='single')return elimination(s,editable);
    if(s.format==='double')return html`${doubleLanes(s,editable)}`;
    if(s.format==='groups'){
      if(screen&&s.playoff)return elimination(s,editable);
      return html`${Object.keys(s.groups).map(g=>meetings(s,g,editable))}${screen?'':elimination(s,editable)}`;
    }
    const final=s.matches.find(m=>m.phase==='final');
    const finalPanel=s.format==='roundFinal'?panel('Финал',html`<div class="bracket">${column('За первое место',[final?matchTile(s,final,{},editable):futureTile('1-е место кругового этапа','2-е место кругового этапа')])}</div>`):'';
    return html`${meetings(s,null,editable)}${finalPanel}`;
  }

  // Standings as the page shows them; the screen pages through the same rows. In knock-out
  // formats the bracket gives the places, so the table is only the statistics.
  function standings(s,g){
    const knock=knockFormat(s),stats=E.table(s,g,knock),ranks=new Map();
    if(knock&&s.champion!==null){
      E.podium(s).forEach((ids,i)=>ids.forEach(id=>ranks.set(id,i+1)));
      stats.sort((a,b)=>(ranks.get(a.id)??Infinity)-(ranks.get(b.id)??Infinity));
    }
    const title=g?'Группа '+g:knock?'Статистика участников':s.format==='roundFinal'?'Таблица кругового этапа':'Турнирная таблица';
    return {title,rows:stats.map((r,i)=>({place:knock?(ranks.get(r.id)??'—'):i+1,id:r.id,played:r.played,w:r.w,d:r.d,l:r.l,diff:r.f-r.a,pts:r.pts}))};
  }
  const columns=['Место','Участник','Игры','Победы','Ничьи','Поражения','Разница','Очки'];
  const cells=(s,r)=>[r.place,s.players[r.id],r.played,r.w,r.d,r.l,r.diff,r.pts];
  function table(s,g){
    const {title,rows}=standings(s,g);
    return panel(title,html`<div class="tablescroll"><table class="standings"><thead><tr>${columns.map(c=>html`<th>${c}</th>`)}</tr></thead><tbody>${
      rows.map(r=>html`<tr${r.place===1?raw(' class="lead"'):''}>${cells(s,r).map(v=>html`<td>${v}</td>`)}</tr>`)}</tbody></table></div>`);
  }
  /** The «Турнирная таблица» tab. */
  function render(container,s,editable){
    const tables=s.format==='groups'?Object.keys(s.groups).map(g=>table(s,g)):[table(s,null)];
    container.innerHTML=html`${editable?html`<p class="boardHint">Нажмите на встречу, чтобы назначить площадку и судью, начать матч или ввести счёт.</p>`:''}${bracket(s,{editable})}${tables}`;
    connect(container);
  }

  // Draws the bracket lines. Each participant row of a match gets a short line from the right
  // edge at its middle; the two join, and one line runs on to the middle of the row it feeds in
  // the next round. A bye tile has one row and so one line. The winner's way is ball orange.
  // Lines that share a gap get their own vertical track wherever their spans overlap, and where a
  // horizontal line crosses another's vertical it jumps over it in a half circle. Coordinates are
  // divided by the tree's scale, so the lines also fit a scaled-down screen.
  let watched=[];
  function connect(root,{onWiden=null}={}){
    watched=watched.filter(w=>{if(w.tree.isConnected)return true;w.observer.disconnect();return false;});
    for(const tree of $$('.tree',root))watched.push(connectTree(tree,onWiden));
  }
  function connectTree(tree,onWiden){
    const ns='http://www.w3.org/2000/svg';
    const overlay=document.createElementNS(ns,'svg');overlay.setAttribute('aria-hidden','true');overlay.classList.add('connectors');tree.prepend(overlay);
    const draw=()=>{
      if(!tree.isConnected||!tree.offsetWidth)return;
      const root=tree.getBoundingClientRect(),scale=root.width/tree.offsetWidth||1,plain=[],win=[];
      const x=v=>(v-root.left)/scale+tree.scrollLeft,y=v=>(v-root.top)/scale+tree.scrollTop;
      const middle=node=>{const r=node.getBoundingClientRect();return y(r.top+r.height/2);};
      // One source per tile; a source may feed several rows (a final replayed by the same pair).
      const sources=new Map();
      for(const row of tree.querySelectorAll('[data-from]')){
        const node=tree.querySelector('[data-node="'+row.dataset.from+'"]');if(!node)continue;
        if(!sources.has(node))sources.set(node,{node,x1:x(node.getBoundingClientRect().right),teams:[...node.querySelectorAll('.fixtureTeam')],targets:[]});
        sources.get(node).targets.push({x2:x(row.getBoundingClientRect().left)-1,y2:middle(row)});
      }
      // Gaps between columns: sources whose right edges line up.
      const gaps=new Map();
      for(const src of sources.values()){const key=Math.round(src.x1/4);(gaps.get(key)??gaps.set(key,[]).get(key)).push(src);}
      const segments=[];let widened=false;
      for(const list of gaps.values()){
        const x1=Math.min(...list.map(s=>s.x1)),x2=Math.min(...list.flatMap(s=>s.targets.map(t=>t.x2)));
        const gap=Math.max(12,x2-x1),xj=x1+Math.min(10,gap*.35);
        for(const src of list){
          const won=src.teams.findIndex(team=>team.classList.contains('won'));
          src.win=won>=0;
          if(src.teams.length===2){
            const [ya,yb]=src.teams.map(middle);src.ys=(ya+yb)/2;src.xs=xj;
            src.teams.forEach((_,i)=>(i===won?win:plain).push('M'+x1+' '+(i?yb:ya)+'H'+xj+'V'+src.ys));
          }else{src.ys=src.teams.length?middle(src.teams[0]):middle(src.node);src.xs=x1;}
          const ys=[src.ys,...src.targets.map(t=>t.y2)];src.top=Math.min(...ys);src.bottom=Math.max(...ys);
        }
        // Tracks: a source takes the first track whose last span ends above its own span.
        const tracks=[];
        for(const src of [...list].sort((a,b)=>a.top-b.top||a.bottom-b.bottom)){
          let k=tracks.findIndex(end=>end<src.top-3);
          if(k<0){k=tracks.length;tracks.push(0);}
          tracks[k]=src.bottom;src.track=k;
        }
        // Several tracks need room: the column before the gap moves its neighbour right, and the
        // lines are drawn again once the layout has settled.
        const need=tracks.length>1?Math.ceil(xj-x1+4+(tracks.length+1)*9+6-gap):0;
        const before=need>0&&list[0].node.closest('.bracketRound');
        if(before){before.style.marginRight=((parseFloat(before.style.marginRight)||0)+need)+'px';widened=true;continue;}
        // A single track sits where the lines always ran; several share the room past the joins.
        const left=xj+4,right=x2-6;
        for(const src of list){
          src.xt=tracks.length===1?x1+gap*.6:left+(right-left)*(src.track+1)/(tracks.length+1);
          const out=src.win?win:plain;
          segments.push({src,out,y:src.ys,xa:src.xs,xb:src.xt});
          if(src.top!==src.bottom)segments.push({src,out,vertical:true,x:src.xt,ya:src.top,yb:src.bottom});
          for(const t of src.targets)segments.push({src,out,y:t.y2,xa:src.xt,xb:t.x2});
        }
      }
      if(widened){requestAnimationFrame(()=>{onWiden?.();draw();});return;}
      // Horizontal lines jump over the verticals of other sources that they cross.
      const verticals=segments.filter(s=>s.vertical),r=3.5;
      for(const seg of segments){
        if(seg.vertical){seg.out.push('M'+seg.x+' '+seg.ya+'V'+seg.yb);continue;}
        const hops=verticals.filter(v=>v.src!==seg.src&&v.x>seg.xa+r&&v.x<seg.xb-r&&seg.y>v.ya+.5&&seg.y<v.yb-.5).map(v=>v.x).sort((a,b)=>a-b);
        let d='M'+seg.xa+' '+seg.y,last=-Infinity;
        for(const hx of hops){if(hx-last<2*r+1)continue;d+='H'+(hx-r)+'A'+r+' '+r+' 0 0 1 '+(hx+r)+' '+seg.y;last=hx;}
        seg.out.push(d+'H'+seg.xb);
      }
      overlay.setAttribute('width',String(tree.scrollWidth));
      overlay.setAttribute('height',String(tree.scrollHeight));
      overlay.replaceChildren(...[[plain,''],[win,'win']].map(([d,cls])=>{const path=document.createElementNS(ns,'path');path.setAttribute('d',d.join(' '));if(cls)path.classList.add(cls);return path;}));
    };
    requestAnimationFrame(draw);document.fonts?.ready.then(draw);
    const observer=new ResizeObserver(draw);
    observer.observe(tree);tree.querySelectorAll('.bracketRound').forEach(round=>observer.observe(round));
    return {tree,observer};
  }
  return {bracket,standings,columns,cells,render,connect,isLive,knockFormat};
})();
