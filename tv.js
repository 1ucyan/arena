"use strict";
// Табло: full-screen pages for a TV, monitor or projector. They always show the viewer's picture,
// even on the organizer's device; app.js reloads them while they are open.
//  «Табло числовое» (#tv/<id>): matches being played, the latest results and the standings.
//  «Табло сетка» (#grid/<id>): the bracket alone, scaled to fill the screen.
const TV=(()=>{
  let lastSync=null,online=true,wake=null,clockTimer=0,idleTimer=0,layoutFrame=0,qr={id:null,svg:''};
  // Standings pager: the sections to show, the pages that fit the screen and the page shown.
  let stand=null,pages=[],page=0,pageTimer=0;
  const screen=()=>document.getElementById('tvScreen');
  // On phones the screen is an ordinary scrolling page; everything else is one fixed window.
  const fixed=()=>{const el=screen();return !!el&&getComputedStyle(el).overflowY==='hidden';};
  const shown=()=>document.body.classList.contains('tv');
  const time=()=>new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});
  const statusText=()=>!online?'Нет связи с сервером, повторяем…':lastSync?'Обновлено в '+lastSync.toLocaleTimeString('ru-RU'):'Обновляется автоматически';
  // «Групповой этап · тур 2» breaks only between its parts, never inside «тур 2».
  const label=(text,joint=' · ')=>raw(text.split(' · ').map(part=>esc(part).replace(/ /g,'&nbsp;')).join(joint));

  function matchesOf(s){
    const byCourt=(x,y)=>String(x.court??'￿').localeCompare(String(y.court??'￿'),'ru',{numeric:true})||x.id-y.id;
    return {live:s.matches.filter(Board.isLive).sort(byCourt),queue:s.matches.filter(m=>!m.score&&!m.live)};
  }
  function roundText(s){
    if(s.champion!==null||s.finished)return 'Турнир завершён';
    const {live,queue}=matchesOf(s),ref=live.length?live.reduce((a,b)=>a.id<b.id?a:b):queue[0];
    if(!ref)return '—';
    if(ref.phase==='league')return s.format==='groups'?'Групповой этап · тур '+ref.round:'Тур '+ref.round;
    return ref.phase==='double'?'Раунд '+ref.round:ref.label;
  }
  // Both screens share the title row with the round and the clock, and the bottom row with the
  // QR code, the connection state and the controls.
  function frame(t,cls,body){
    const s=t.state;
    if(!localMode&&qr.id!==t.id)qr={id:t.id,svg:ArenaQR.svg(links.view(t.id),'QR-код страницы турнира')};
    return html`<div class="tvScreen ${cls}" id="tvScreen"><header class="tvHead"><div class="tvTitle"><span>${s.sport} · ${E.labels[s.format]}</span><h1>${s.name}</h1></div>
<div class="tvRound"><span>Текущий раунд</span><strong>${label(roundText(s))}</strong></div><div class="tvClock"><span>Время</span><strong id="tvClock">${time()}</strong></div></header>
${body}
<footer class="tvFoot">${localMode?'':html`<div class="tvQR">${raw(qr.svg)}</div><p>Наведите камеру телефона на код, чтобы открыть таблицу и сетку турнира.</p>`}
<span class="tvSync${online?'':' off'}" id="tvSync">${statusText()}</span><div class="tvControls">${document.fullscreenEnabled?html`<button data-act="tvFull" id="tvFull">${icon('expand')}${document.fullscreenElement?'Обычный режим':'Во весь экран'}</button>`:''}<a href="#t/${t.id}">${icon('x')}Выйти</a></div></footer></div>`;
  }
  function mounted(){
    if(!clockTimer)clockTimer=setInterval(()=>{const c=document.getElementById('tvClock');if(c)c.textContent=time();},10000);
    layout();document.fonts?.ready.then(layout);
    keepAwake();wakeControls();
  }

  function numbers(container,t){
    const s=t.state,ended=s.champion!==null||!!s.finished,name=id=>s.players[id];
    const {live}=matchesOf(s);
    // Lists carry more items than a small screen holds; fit() keeps the ones that fit whole.
    const lead=live.slice(0,12);
    const recent=s.matches.filter(m=>m.score).sort((x,y)=>(y.at??0)-(x.at??0)||y.id-x.id).slice(0,4);
    // Left column of every match: the court when the organizer set one, and the round. On cards
    // «Группа 1 · тур 2» goes on two lines; in lists it wraps where it must.
    const where=(m,cls)=>html`<span class="${cls}${m.court?'':' noCourt'}">${m.court?html`<b${m.court.length>4?raw(' class="long"'):''}>${m.court}</b>`:''}<small>${label(m.label,cls==='tvWhere'?'<br>':' · ')}</small></span>`;
    const card=m=>html`<article class="tvMatch">${where(m,'tvWhere')}<div class="tvTeams">${[m.a,m.b].map((id,i)=>html`<div class="tvTeam"><span>${name(id)}</span><b>${m.live[i]}</b></div>`)}<small class="tvMeta"><span class="tvLiveTag">Идёт</span>${m.referee?html`<span>Судья: ${m.referee}</span>`:''}</small></div></article>`;
    const row=m=>html`<li>${where(m,'tvC')}<span class="tvN home${m.winner===m.a?' won':''}">${name(m.a)}</span><span class="tvS">${m.score.join(' : ')}</span><span class="tvN${m.winner===m.b?' won':''}">${name(m.b)}</span></li>`;
    let main;
    if(ended){
      const places=E.podium(s);
      main=html`<div class="tvChampion">${places.length?html`${icon('cup')}<span>Победитель турнира</span><strong>${places[0].map(name).join(', ')}</strong>${
        places.length>1?html`<ol class="tvPlaces">${places.slice(1).map((ids,i)=>html`<li><b>${i+2} место</b>${ids.map(name).join(', ')}</li>`)}</ol>`:''}`:html`<strong>Турнир завершён</strong>`}</div>`;
    }else if(lead.length){
      main=html`<div class="tvLive${lead.length>2?' grid':''}${lead.length<=4?' few':''}" data-fit data-more="${live.length-lead.length}">${lead.map(card)}</div><p class="tvMore" hidden></p>`;
    }else main=html`<p class="tvEmpty">Сейчас матчей нет. Здесь появятся матчи, которые начнёт организатор.</p>`;
    container.innerHTML=frame(t,'numbers',html`<section class="tvPanel tvNow"><h2>${ended?'Итоги турнира':'Сейчас играют'}</h2>${main}</section>
<section class="tvPanel tvRecent"><h2>Последние результаты</h2>${recent.length?html`<ol class="tvList" data-fit>${recent.map(row)}</ol>`:html`<p class="tvEmpty">Результатов пока нет.</p>`}</section>
<section class="tvPanel tvTable"><h2><span id="tvTableTitle"></span><span class="tvPage" id="tvPageNo"></span></h2><div class="tvTableBody" id="tvTableBody"></div></section>`);
    stand={s,sections:s.format==='groups'?Object.keys(s.groups).map(g=>Board.standings(s,g)):[Board.standings(s,null)]};
    mounted();
  }
  // Round-robin formats show the table of meetings, group tournaments show the groups until the
  // play-off starts.
  function grid(container,t){
    stand=null;
    container.innerHTML=frame(t,'gridScreen',html`<section class="tvPanel tvGrid"><div class="tvGridFit" id="tvGridFit"><div class="tvGridInner" id="tvGridInner">${Board.bracket(t.state,{screen:true})}</div></div></section>`);
    Board.connect($('#tvGridInner'),{onWiden:gridFit});
    mounted();
  }
  // Scales the bracket to the space between the title and the bottom row, keeping its proportions.
  // Several sections (upper and lower bracket, groups) are tried in one, two or three columns,
  // and the arrangement that comes out largest wins.
  function gridFit(){
    const box=document.getElementById('tvGridFit'),inner=document.getElementById('tvGridInner');if(!box||!inner)return;
    inner.style.transform='';inner.style.gridTemplateColumns='';
    if(!fixed())return;
    const fit=()=>Math.min(box.clientWidth/inner.offsetWidth,box.clientHeight/inner.offsetHeight,3);
    let best={cols:1,scale:fit()};
    for(let cols=2;cols<=Math.min(3,inner.children.length);cols++){
      inner.style.gridTemplateColumns='repeat('+cols+',max-content)';
      const scale=fit();if(scale>best.scale)best={cols,scale};
    }
    inner.style.gridTemplateColumns=best.cols>1?'repeat('+best.cols+',max-content)':'';
    inner.style.transform='translateX('+Math.max(0,(box.clientWidth-inner.offsetWidth*best.scale)/2)+'px) scale('+best.scale+')';
  }
  // Hides the rows and cards that do not fit whole, from the end of each list, so a 23-inch
  // monitor shows fewer matches than a large TV instead of cutting the last ones in half.
  function fit(){
    const el=screen();if(!el)return;
    const isFixed=fixed();
    for(const box of el.querySelectorAll('[data-fit]')){
      const items=[...box.children],more=box.nextElementSibling?.classList.contains('tvMore')?box.nextElementSibling:null;
      const extra=Number(box.dataset.more??0);
      items.forEach(item=>{item.hidden=false;});
      let hidden=0;
      const trim=()=>{const bottom=box.getBoundingClientRect().bottom+1;for(let i=items.length-1-hidden;i>0&&items[i].getBoundingClientRect().bottom>bottom;i--){items[i].hidden=true;hidden++;}};
      if(isFixed)trim();
      if(!more)continue;
      more.hidden=!(hidden+extra);
      // The note takes room of its own, so the cards are fitted again once it shows.
      if(!more.hidden&&isFixed)trim();
      more.textContent='Ещё идут матчей: '+(hidden+extra);
    }
  }
  const layout=()=>{fit();table();gridFit();};
  window.addEventListener('resize',()=>{if(shown()){cancelAnimationFrame(layoutFrame);layoutFrame=requestAnimationFrame(layout);}});

  // Standings at the bottom of the screen, the same rows as the page. On a fixed screen they are
  // cut into columns of the rows that fit, two columns side by side when the screen is wide
  // enough, and the pages turn every 5 seconds. In group tournaments each column belongs to one
  // group, so two small groups share a page.
  const standTable=(s,rows)=>html`<table class="tvStand"><colgroup><col class="place"><col><col span="6" class="num"></colgroup><thead><tr>${Board.columns.map(c=>html`<th>${c}</th>`)}</tr></thead><tbody>${
    rows.map(r=>html`<tr${r.place===1?raw(' class="lead"'):''}>${Board.cells(s,r).map(v=>html`<td>${v}</td>`)}</tr>`)}</tbody></table>`;
  const standColumn=(s,col)=>html`<div class="tvCol">${col.title?html`<h3>${col.title}</h3>`:''}${standTable(s,col.rows)}</div>`;
  function table(){
    const body=document.getElementById('tvTableBody');if(!body||!stand)return;
    const {s,sections}=stand,several=sections.length>1;
    document.getElementById('tvTableTitle').textContent=several?'Турнирные таблицы групп':sections[0].title;
    const all=sections.map(sec=>({title:several?sec.title:'',rows:sec.rows}));
    if(!fixed()){
      pages=[];body.style.removeProperty('--cols');document.getElementById('tvPageNo').textContent='';
      body.innerHTML=html`${all.map(col=>standColumn(s,col))}`;
      return;
    }
    const em=parseFloat(getComputedStyle(body).fontSize),cols=body.clientWidth/em>=76?2:1;
    body.style.setProperty('--cols',cols);
    // Long names wrap, so rows differ in height. Every table is laid out once at the width of a
    // page column, and each page column takes rows until the next one would not fit.
    body.innerHTML=html`${all.map(col=>standColumn(s,col))}`;
    const room=body.clientHeight,columns=[];
    [...body.children].forEach((el,k)=>{
      const {title,rows}=all[k],boxes=[...el.querySelectorAll('tbody tr')].map(tr=>tr.getBoundingClientRect());
      if(!boxes.length){columns.push({title,rows:[]});return;}
      const box=el.getBoundingClientRect(),frameHeight=boxes[0].top-box.top+box.bottom-boxes.at(-1).bottom;
      let start=0,used=frameHeight;
      boxes.forEach((r,i)=>{
        if(i>start&&used+r.height>room){columns.push({title,rows:rows.slice(start,i)});start=i;used=frameHeight;}
        used+=(i+1<boxes.length?boxes[i+1].top:r.bottom)-r.top;
      });
      columns.push({title,rows:rows.slice(start)});
    });
    pages=[];for(let i=0;i<columns.length;i+=cols)pages.push(columns.slice(i,i+cols));
    if(page>=pages.length)page=0;
    drawPage(false);
    if(!pageTimer)pageTimer=setInterval(()=>{if(pages.length>1&&fixed()){page=(page+1)%pages.length;drawPage(true);}},5000);
  }
  function drawPage(turn){
    const body=document.getElementById('tvTableBody'),cols=pages[page];if(!body||!cols)return;
    document.getElementById('tvPageNo').textContent=pages.length>1?'Страница '+(page+1)+' из '+pages.length:'';
    body.innerHTML=html`${cols.map(col=>standColumn(stand.s,col))}`;
    if(turn){body.classList.remove('turn');void body.offsetWidth;body.classList.add('turn');}
  }

  function status(ok){
    online=ok;if(ok)lastSync=new Date();
    const out=document.getElementById('tvSync');
    if(out){out.classList.toggle('off',!ok);out.textContent=statusText();}
  }
  function toggleFullscreen(){
    if(document.fullscreenElement)document.exitFullscreen().catch(()=>{});
    else document.documentElement.requestFullscreen().catch(()=>notify('Браузер не разрешил полноэкранный режим. Нажмите F11.'));
  }
  actions.tvFull=toggleFullscreen;
  // A screen across the hall should not dim or show a cursor.
  async function keepAwake(){
    if(wake||document.hidden||!('wakeLock' in navigator))return;
    try{wake=await navigator.wakeLock.request('screen');wake.addEventListener('release',()=>{wake=null;});}catch{}
  }
  function wakeControls(){
    const el=screen();if(!el)return;
    el.classList.remove('idle');clearTimeout(idleTimer);
    idleTimer=setTimeout(()=>el.classList.add('idle'),3000);
  }
  function stop(){
    clearInterval(clockTimer);clockTimer=0;clearTimeout(idleTimer);
    clearInterval(pageTimer);pageTimer=0;page=0;stand=null;pages=[];
    wake?.release().catch(()=>{});wake=null;
    if(document.fullscreenElement)document.exitFullscreen().catch(()=>{});
  }
  document.addEventListener('pointermove',()=>{if(shown())wakeControls();});
  document.addEventListener('keydown',ev=>{if(shown()&&/^[fFаА]$/.test(ev.key)&&!ev.ctrlKey&&!ev.metaKey&&!ev.altKey)toggleFullscreen();});
  document.addEventListener('fullscreenchange',()=>{const b=document.getElementById('tvFull');if(b)b.innerHTML=html`${icon('expand')}${document.fullscreenElement?'Обычный режим':'Во весь экран'}`;});
  document.addEventListener('visibilitychange',()=>{if(shown()&&!document.hidden)keepAwake();});
  return {numbers,grid,status,stop};
})();
