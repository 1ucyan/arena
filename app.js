"use strict";
// Арена: pages, the tournament wizard and the organizer's dialogs. The rules of the formats are
// in engine.js, brackets and tables in board.js, the screens in tv.js, helpers in core.js.

const formats={
  single:['Классическая сетка с выбыванием после первого поражения.','Победитель каждой встречи проходит в следующий раунд. При неполной сетке часть участников по жребию проходит первый раунд автоматически. Проигравшие в полуфиналах играют матч за 3-е место.'],
  double:['Второй шанс после первого поражения.','После первого поражения участник переходит в нижнюю сетку. Второе поражение завершает его турнир. В финале встречаются победители верхней и нижней сеток. Если первый финал выиграет участник из нижней сетки, по выбору организатора играется дополнительный финал.'],
  round:['Каждый играет с каждым.','Победитель определяется по итоговой таблице очков.'],
  roundFinal:['Финал между двумя лидерами.','После кругового этапа два участника с наибольшим количеством очков играют решающий матч. Остальные места определяются по таблице кругового этапа.'],
  groups:['Групповой этап и финальные матчи на выбывание.','В каждой группе все играют друг с другом. Двое лучших проходят в плей-офф. Места в группе определяют турнирные очки, а при равенстве очков — критерии в выбранном порядке.'],
};
const diagram=key=>html`<svg class="diagram" viewBox="0 0 120 72" aria-hidden="true"><use href="#f-${key}"/></svg>`;
const links={
  page:()=>location.origin+location.pathname,
  view:id=>links.page()+'#t/'+id,
  tv:id=>links.page()+'#tv/'+id,
  grid:id=>links.page()+'#grid/'+id,
  organizer:(id,key)=>links.page()+'#t/'+id+'/access/'+key,
};
const MAX_PLAYERS=512;

// ─── Storage ───────────────────────────────────────────────────────────────────────────────
// With a server, tournaments live in its database and this browser keeps a short list for
// «Мои турниры» with the role last seen here (never a key). In local mode (file:// or the
// GitHub Pages copy) the list holds the tournaments themselves.
const Store=(()=>{
  const KEY='arena-tournaments-v1',BASE='/api/tournaments';
  // Mirrors the server's request limit in src/tournaments.js.
  const MAX_SIZE=1200000;
  const list=()=>{try{return JSON.parse(localStorage.getItem(KEY)||'{}');}catch{return {};}};
  const write=entries=>localStorage.setItem(KEY,JSON.stringify(entries));
  async function api(path,method='GET',body){
    let r;
    try{r=await fetch(path,{method,headers:body?{'Content-Type':'application/json'}:{},body:body&&JSON.stringify(body),cache:'no-store',credentials:'same-origin'});}
    catch{throw Error('Нет связи с сервером. Проверьте подключение и повторите.');}
    if(!r.ok){
      let message;try{message=(await r.json()).error;}catch{}
      const e=Error(message||'Не удалось сохранить или загрузить турнир ('+r.status+').');e.status=r.status;throw e;
    }
    return r.json();
  }
  function remember(t){
    const entries=list(),s=t.state,seen=Date.now();
    entries[t.id]=localMode?{...t,seen}:{id:t.id,name:s.name,sport:s.sport,date:s.date,format:s.format,done:s.champion!==null||!!s.finished,role:t.role,archived:!!t.archived,seen};
    try{write(entries);}
    catch{
      if(localMode)throw Error('Браузер не смог сохранить турнир. Проверьте место и разрешение на локальное хранение.');
      notify('Турнир сохранён на сервере. Скопируйте его ссылку.');
    }
  }
  function forget(id){const entries=list();delete entries[id];write(entries);}
  function checkSize(state){
    if(!localMode&&JSON.stringify({state}).length>MAX_SIZE)throw Error('Турнир слишком большой для сохранения на сервере. Уменьшите число участников или выберите другой формат.');
  }
  const local=t=>({role:'organizer',archived:false,...t});
  return {
    KEY,list,remember,forget,checkSize,api,local,
    // The organizer key arrives once, in the answer to create; it is never stored.
    create:async state=>localMode?{id:crypto.randomUUID(),version:1,role:'organizer',archived:false}:api(BASE,'POST',{state}),
    async load(id){
      if(!localMode)return api(BASE+'/'+id);
      const t=list()[id];if(!t)throw Error('В этом браузере турнир не найден.');
      return local(t);
    },
    // While nothing has changed the server answers {unchanged:true} in a few bytes.
    poll:t=>api(BASE+'/'+t.id+'?seen='+t.version+'.'+t.role),
    save:async(t,state)=>localMode?{version:t.version+1}:api(BASE+'/'+t.id,'PUT',{state,version:t.version}),
    archive:async(t,archived)=>localMode?{version:t.version+1}:api(BASE+'/'+t.id,'PATCH',{archived,version:t.version}),
    newKey:t=>api(BASE+'/'+t.id+'/access','POST'),
    signIn:(id,key)=>api('/api/session','POST',{id,key}),
    signOut:id=>api('/api/session','DELETE',{id}),
  };
})();

// ─── Page state ────────────────────────────────────────────────────────────────────────────
let active=null;        // the open tournament: {id,state,version,role,archived}
let view='board';       // board | tv | grid
let tab='table';
let draft=null;         // the wizard's tournament until the draw
let freshKey=null;      // the organizer key of a tournament created just now, until it is shown
let routeToken=0,liveTimer=0,polling=false;

// The server decides who may change a tournament; these only choose which controls to show.
const isOrganizer=()=>localMode||active?.role==='organizer';
const canEdit=()=>isOrganizer()&&!active.archived&&!active.state.finished;
const started=s=>s.matches.some(m=>m.score||m.draws?.length||m.live);
const finishedState=s=>s.champion!==null||!!s.finished;

async function save(next){
  Store.checkSize(next);
  try{
    const info=await Store.save(active,next);
    active={...active,version:info.version,state:next};Store.remember(active);
  }catch(e){if(e.status===403||e.status===409)reload().catch(()=>{});throw e;}
}
async function reload(){active=await Store.load(active.id);Store.remember(active);render();}
/** Changes a copy of the open tournament, saves it and shows it. */
async function change(edit,message=''){
  const next=structuredClone(active.state);edit(next);
  await save(next);Dialog.close();render();if(message)notify(message);
}

// ─── Help and the home page ────────────────────────────────────────────────────────────────
actions.help=()=>Dialog.open({label:'Арена',title:'Справка организатора',body:html`<ol class="helpList">
<li>Нажмите «Создать турнир» и заполните сведения о соревновании.</li>
<li>Выберите формат. Для турнира с «подвалом» решите, нужен ли дополнительный финал, если первый финал выиграет участник из нижней сетки.</li>
<li>Введите участников вручную или загрузите TXT со списком по строкам либо CSV с разделителем «;».</li>
<li>Расставьте по порядку критерии, которые решают места при равенстве очков, и проведите жеребьёвку. Нажмите на встречу, чтобы назначить площадку и судью, начать матч и вести счёт, а после игры сохранить результат. Сетка и таблица обновляются автоматически.</li>
${localMode?html`<li>Турниры хранятся только в этом браузере. Открывайте сайт ${location.protocol==='file:'?'из той же папки':'по тому же адресу'} в том же браузере. Очистка данных браузера удаляет турниры, поэтому время от времени сохраняйте копию на странице «Мои турниры».</li>
<li>Кнопки «Табло числовое» и «Табло сетка» показывают турнир во весь экран, например на втором мониторе или проекторе. Числовое табло показывает текущие матчи, последние результаты и таблицу, табло-сетка — турнирную сетку. Табло в отдельном окне обновляется само.</li>`
:html`<li>Регистрация не нужна. После жеребьёвки Арена один раз покажет секретную ссылку и код организатора. Сохраните их: только организатор может менять настройки, проводить жеребьёвку, назначать судей и площадки, вносить и исправлять результаты, завершать и архивировать турнир. На другом устройстве откройте ссылку организатора или введите код кнопкой «Вход для организатора».</li>
<li>Для зрителей нажмите «Ссылка и QR-код». По публичной ссылке видны таблица, сетка, расписание и результаты, но изменить ничего нельзя. «Табло числовое» и «Табло сетка» открывают полноэкранный режим для телевизора или проектора, табло обновляется само.</li>`}</ol>`});

$('#cards').innerHTML=html`${Object.keys(formats).map(k=>html`<button class="card" data-act="formatInfo" data-format="${k}">${diagram(k)}<div class="cardText"><h3>${E.labels[k]}</h3><p>${formats[k][0]}</p></div></button>`)}`;
actions.formatInfo=button=>{
  const k=button.dataset.format;
  Dialog.open({label:'Формат турнира',title:E.labels[k],body:html`${diagram(k)}<p>${formats[k][1]}</p><div class="actions"><button class="primary" data-act="create" data-format="${k}">${icon('plus')}Создать турнир</button></div>`});
};

// ─── The wizard: details → format → participants → places and the draw ─────────────────────
// A wizard closed half-way keeps what was typed; «Создать турнир» goes on from the first step.
actions.create=button=>{
  const format=button.dataset.format;
  if(!draft||format)draft={meta:{},players:[],format:format||draft?.format||'single'};
  stepDetails();
};
let collect=null;   // keeps the open step's fields in the draft before «Назад»
actions.back=button=>{collect?.();[,stepDetails,stepFormat,stepPlayers][button.dataset.to]();};
const backButton=to=>html`<button type="button" class="secondary" data-act="back" data-to="${to}">Назад</button>`;
const sports=html`<datalist id="sports">${['Футбол','Баскетбол','Волейбол','Теннис','Настольный теннис','Бадминтон','Хоккей','Единоборства'].map(s=>html`<option>${s}</option>`)}</datalist>`;

function detailFields(m,withCount){
  const points=m.points??E.defaultPoints;
  return html`${field('Вид спорта','sport','text',m.sport,{attrs:'list="sports" placeholder="Например, волейбол" maxlength="100"'})}${sports}
${field('Название турнира','name','text',m.name,{attrs:'placeholder="Название соревнования" maxlength="150"'})}
<div class="columns">${field('Дата проведения','date','date',m.date)}${withCount?field('Количество участников','count','number',m.count,{attrs:`min="2" max="${MAX_PLAYERS}" step="1" placeholder="От 2"`}):''}</div>
${field('Главный судья (необязательно)','referee','text',m.referee,{attrs:'placeholder="Имя и фамилия" maxlength="150"',required:false})}
<fieldset class="group"><legend>Начисление очков</legend><div class="columns three">${[['Победа','win'],['Ничья','draw'],['Поражение','loss']].map(([text,key])=>field(text,key,'number',points[key],{attrs:'step="1"'}))}</div></fieldset>`;
}
const drawSwitch=(on,locked)=>html`<label class="switch"><input type="checkbox" name="allowDraw" role="switch"${on?raw(' checked'):''}${locked?raw(' disabled'):''}><span class="switchTrack" aria-hidden="true"></span><span>Возможность ничьей</span></label>`;
function readDetails(form){
  const d=Object.fromEntries([...new FormData(form)].map(([k,v])=>[k,String(v).trim()]));
  if(!d.sport||!d.name)throw Error('Заполните все поля.');
  const points={win:Number(d.win),draw:Number(d.draw),loss:Number(d.loss)};
  if(!Object.values(points).every(Number.isSafeInteger))throw Error('Введите целое число очков за каждый результат.');
  return {sport:d.sport,name:d.name,date:d.date,referee:d.referee,points,allowDraw:form.elements.allowDraw.checked};
}
/** Names must be filled in and differ, or the tables could not tell the participants apart. */
function checkNames(names){
  if(names.some(n=>!n))throw Error('Заполните имя каждого участника.');
  const seen=new Set();
  for(const n of names){
    const key=n.toLocaleLowerCase('ru').replace(/\s+/g,' ');
    if(seen.has(key))throw Error('Имя «'+n+'» встречается дважды. Добавьте уточнение, например город или номер.');
    seen.add(key);
  }
}

function stepDetails(){
  collect=null;
  Dialog.open({step:[1,4],title:'Новый турнир',body:html`<form data-form="details">${detailFields(draft.meta,true)}${drawSwitch(draft.meta.allowDraw,false)}${errBox}<div class="actions"><button class="primary">Перейти к выбору формата</button></div></form>`});
}
forms.details=form=>{
  try{
    const d=readDetails(form),count=Number(form.elements.count.value);
    if(!Number.isSafeInteger(count)||count<2||count>MAX_PLAYERS)throw Error('Укажите целое число участников от 2 до '+MAX_PLAYERS+'.');
    draft.meta={...draft.meta,...d,count};stepFormat();
  }catch(e){Dialog.error(e.message);}
};

// The format picker of the wizard and of a new draw: the formats, the rules of the chosen one,
// and for double elimination the question about the extra final.
const finalResetChoice=(on,hidden=true)=>html`<fieldset class="group finalReset" id="finalReset"${hidden?raw(' hidden'):''}><legend>Дополнительный финал</legend>
<p class="small">Победитель верхней сетки приходит в финал без поражений, победитель нижней — с одним поражением. Если первый финал выигрывает участник из нижней сетки, поражений у финалистов становится поровну — по одному.</p>
<p class="fieldQuestion">Проводить дополнительный финал, если первый финал выиграл участник из нижней сетки?</p><div class="choices">${
  [[true,'Да, провести дополнительный финал','Чемпион определяется в ещё одном матче тех же финалистов. Так каждый участник выбывает только после двух поражений.'],
   [false,'Нет, первый финал решающий','Победитель первого финала сразу становится чемпионом. Турнир короче на один матч, но победитель верхней сетки выбывает после одного поражения.']]
  .map(([value,title,hint])=>html`<label><input type="radio" name="finalReset" value="${value}"${(on!==false)===value?raw(' checked'):''}><span><b>${title}</b><small>${hint}</small></span></label>`)}</div></fieldset>`;
const formatChoices=(current,finalReset)=>html`<div class="choices">${Object.keys(formats).map(k=>html`<label><input type="radio" name="format" value="${k}" data-change="formatPick"${k===current?raw(' checked'):''}><span><b>${E.labels[k]}</b><small>${formats[k][0]}</small></span></label>`)}</div>
<div class="formatNote" id="formatNote" aria-live="polite"></div>${finalResetChoice(finalReset)}`;
function syncFormat(form){
  const k=new FormData(form).get('format');
  $('#formatNote').innerHTML=k?html`${diagram(k)}<div><b>${E.labels[k]}</b><p>${formats[k][1]}</p></div>`:'';
  $('#finalReset').hidden=k!=='double';
}
changes.formatPick=input=>syncFormat(input.form);
const readFormat=form=>{const d=new FormData(form),format=d.get('format');return {format,finalReset:format==='double'?d.get('finalReset')!=='false':undefined};};

function stepFormat(){
  Dialog.open({step:[2,4],title:'Выберите формат проведения турнира',body:html`<form data-form="format"><p class="small">Формат определяет, кто с кем играет и как выбывают участники. Нажмите на формат, чтобы прочитать его правила.</p>${formatChoices(draft.format,draft.meta.finalReset)}${errBox}<div class="actions">${backButton(1)}<button class="primary">Перейти к вводу участников</button></div></form>`});
  const form=$('[data-form="format"]');syncFormat(form);
  collect=()=>{const {format,finalReset}=readFormat(form);if(format)draft.format=format;draft.meta.finalReset=finalReset;};
}
forms.format=()=>{collect();stepPlayers();};

const rosterInputs=(names,count)=>html`<div class="roster">${Array.from({length:count},(_,i)=>html`<label><span>${String(i+1).padStart(2,'0')}</span><input required maxlength="150" aria-label="Участник ${i+1}" placeholder="Участник ${i+1}" value="${names[i]??''}"></label>`)}</div>`;
const rosterValues=form=>$$('.roster input',form).map(input=>input.value.trim());
function stepPlayers(status=''){
  Dialog.open({step:[3,4],title:'Участники турнира',body:html`<p class="small">Введите имена спортсменов или названия команд.</p>
<label class="secondary filepick">${icon('upload')}Загрузить список участников<input type="file" data-change="importPlayers" aria-label="Загрузить список участников" accept=".txt,.csv,text/plain,text/csv"></label>
<p class="small">TXT — одно имя в строке. CSV — через «;», запятую или по строкам.</p><div role="status" class="importStatus">${status}</div>
<form data-form="players">${rosterInputs(draft.players,draft.meta.count)}${errBox}<div class="actions">${backButton(2)}<button class="primary">Завершить ввод</button></div></form>`});
  const form=$('[data-form="players"]');
  collect=()=>{draft.players=rosterValues(form);};
}
changes.importPlayers=async input=>{
  const file=input.files[0];if(!file)return;
  try{
    if(!/\.(csv|txt)$/i.test(file.name))throw Error('Выберите файл TXT или CSV.');
    const names=ArenaImport.parse(ArenaImport.decode(await file.arrayBuffer()),/\.csv$/i.test(file.name));
    if(!input.isConnected)return;
    if(!names.length)throw Error('Список участников пуст.');
    if(names.some(n=>n.length>150))throw Error('Имя участника должно содержать до 150 символов.');
    if(names.length>MAX_PLAYERS)throw Error('В списке '+names.length+' имён, а в турнире может быть до '+MAX_PLAYERS+' участников.');
    const n=draft.meta.count;collect();
    names.forEach((v,i)=>{draft.players[i]=v;});
    draft.meta.count=Math.max(n,names.length);
    stepPlayers('Загружено имён: '+names.length+' из файла '+file.name+(names.length<n?'. Проверьте оставшиеся строки.':''));
  }catch(e){Dialog.error(e.message);input.value='';}
};
forms.players=form=>{
  collect();
  try{checkNames(draft.players);stepPriority();}catch(e){Dialog.error(e.message);}
};

// Order of the criteria that place participants level on points. Rows are dragged with a mouse,
// or by the handle with a finger so that the list still scrolls; the arrows do the same from the keyboard.
const priorityIntro=html`<p class="small">Места в таблице определяют набранные очки. При равенстве очков критерии применяются по порядку сверху вниз. Перетащите строку, чтобы изменить порядок.</p>`;
const priorityOutro=html`<p class="small">Если равны все критерии, выше тот, кто раньше в жеребьёвке.</p>`;
const legacyOrder=()=>E.legacyTiebreak.concat(E.defaultTiebreak.filter(k=>!E.legacyTiebreak.includes(k)));
function priorityList(order){
  return html`<ol class="priority" id="priority">${order.map(key=>{const [name,hint]=E.tiebreakLabels[key];
    return html`<li data-key="${key}"><span class="grip" aria-hidden="true">${icon('grip')}</span><span class="prioNo"></span><span class="prioText"><b>${name}</b><small>${hint}</small></span><span class="prioMove"><button type="button" data-move="-1" aria-label="Поднять выше: ${name}">${icon('up')}</button><button type="button" data-move="1" aria-label="Опустить ниже: ${name}">${icon('down')}</button></span></li>`;})}</ol>`;
}
const priorityOrder=()=>$$('#priority li').map(li=>li.dataset.key);
function prioritySort(list){
  const rows=()=>[...list.children];
  const renumber=()=>rows().forEach((li,i,all)=>{li.querySelector('.prioNo').textContent=i+1;li.querySelector('[data-move="-1"]').disabled=i===0;li.querySelector('[data-move="1"]').disabled=i===all.length-1;});
  renumber();
  list.addEventListener('click',ev=>{
    const button=ev.target.closest('[data-move]');if(!button)return;
    const li=button.closest('li');
    if(button.dataset.move==='-1')li.previousElementSibling?.before(li);else li.nextElementSibling?.after(li);
    renumber();(button.disabled?li.querySelector('[data-move]:not(:disabled)'):button).focus();
  });
  list.addEventListener('pointerdown',ev=>{
    const li=ev.target.closest('li');
    if(!li||ev.target.closest('button')||ev.button>0||(ev.pointerType!=='mouse'&&!ev.target.closest('.grip')))return;
    ev.preventDefault();li.setPointerCapture(ev.pointerId);
    let start=ev.clientY,shift=0;
    const top=()=>li.getBoundingClientRect().top-shift;
    li.classList.add('dragging');
    const move=e=>{
      shift=e.clientY-start;li.style.transform='translateY('+shift+'px)';
      const next=rows().filter(x=>x!==li).find(x=>{const r=x.getBoundingClientRect();return e.clientY<r.top+r.height/2;})??null;
      if(next===li.nextElementSibling||(!next&&li===list.lastElementChild))return;
      // The row moves in the list; the offset is corrected so it stays under the pointer.
      const before=top();list.insertBefore(li,next);start+=top()-before;
      shift=e.clientY-start;li.style.transform='translateY('+shift+'px)';renumber();
    };
    const end=()=>{li.removeEventListener('pointermove',move);li.removeEventListener('pointerup',end);li.removeEventListener('pointercancel',end);
      li.classList.remove('dragging');li.style.transform='';renumber();};
    li.addEventListener('pointermove',move);li.addEventListener('pointerup',end);li.addEventListener('pointercancel',end);
  });
}
function stepPriority(){
  Dialog.open({step:[4,4],title:'Определение мест',body:html`<form data-form="tiebreak">${priorityIntro}${Board.knockFormat(draft)?html`<p class="small note">В этом формате места определяет сетка. Критерии влияют только на порядок строк в таблице статистики участников.</p>`:''}
${priorityList(draft.meta.tiebreak??E.defaultTiebreak)}${priorityOutro}<p class="small">Порядок можно изменить позже в настройках турнира. После нажатия «Провести жеребьёвку» участники будут распределены случайным образом.</p>${errBox}
<div class="actions">${backButton(3)}<button class="primary">Провести жеребьёвку</button></div></form>`});
  prioritySort($('#priority'));
  collect=()=>{draft.meta.tiebreak=priorityOrder();};
}
forms.tiebreak=(form,button)=>{collect();run(button,async()=>{
  const s=E.create(draft.meta,draft.players,draft.format);
  Store.checkSize(s);
  const {key,...info}=await Store.create(s);
  if(key)freshKey={id:info.id,key};
  active={...info,state:s};Store.remember(active);draft=null;
  Dialog.close();tab='table';location.hash='t/'+info.id;
});};

// ─── Routing ───────────────────────────────────────────────────────────────────────────────
async function route(){
  const token=++routeToken;let hash=location.hash.slice(1);
  // An organizer link carries its key after «#», so the key never reaches the server or its logs.
  // It leaves the address bar at once and is exchanged for an HTTP-only session cookie below.
  const access=/^t\/([\da-f-]{36})\/access\/([\w-]{1,100})$/i.exec(hash);
  if(access){hash='t/'+access[1];history.replaceState(null,'',location.pathname+location.search+'#'+hash);}
  stopLive();TV.stop();
  if(!freshKey)Dialog.close();
  $('#notice').hidden=true;
  const home=!hash||hash==='home',match=/^(t|tv|grid)\/([\da-f-]{36})$/i.exec(hash);
  view=match?{t:'board',tv:'tv',grid:'grid'}[match[1].toLowerCase()]:'board';
  const body=document.body;
  body.classList.toggle('landing',home);body.classList.remove('tournament');body.classList.toggle('tv',view!=='board');
  $('#home').hidden=!home;$('#secondary').hidden=home;
  $('#homeNav').toggleAttribute('aria-current',home);$('#myNav').toggleAttribute('aria-current',!home);
  window.scrollTo(0,0);
  if(home)return;
  if(!match){mine();return;}
  const id=match[2].toLowerCase(),root=$('#secondary');
  root.innerHTML=html`<p class="${view==='board'?'loading':'tvLoading'}">Загружаем турнир…</p>`;
  let accessError='';
  if(access&&!localMode){try{await Store.signIn(id,access[2]);}catch(e){accessError=e.message;}}
  try{
    const t=await Store.load(id);if(token!==routeToken)return;
    active=t;Store.remember(t);tab='table';render();startLive();
    if(accessError)notify(accessError);else if(access)notify('Вы вошли как организатор. Ключ убран из адресной строки.');
    if(freshKey?.id===id&&view==='board'){const key=freshKey.key;freshKey=null;createdDialog(key);}
  }catch(e){
    if(token!==routeToken)return;
    root.innerHTML=html`<h1>Не удалось открыть турнир</h1><p>${e.message}</p><button class="secondary" data-act="route">Повторить</button>`;
  }
}
actions.route=()=>route();
function render(){
  const root=$('#secondary');
  if(view==='tv')TV.numbers(root,active);else if(view==='grid')TV.grid(root,active);else dashboard();
}
// Pages pick up changes on their own: viewers every 10 s, the screens every 4 s. Local tabs
// hear each other through storage events.
function startLive(){stopLive();if(!localMode)liveTimer=setInterval(poll,view==='board'?10000:4000);}
function stopLive(){clearInterval(liveTimer);liveTimer=0;}
async function poll(){
  if(!active||polling||document.hidden||(view==='board'&&Dialog.isOpen))return;
  polling=true;const token=routeToken;
  try{
    const r=await Store.poll(active);if(token!==routeToken)return;
    TV.status(true);if(!r.unchanged){active=r;Store.remember(r);render();}
  }catch{if(token===routeToken)TV.status(false);}
  finally{polling=false;}
}
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&liveTimer)poll();});
window.addEventListener('storage',ev=>{
  if(!localMode||ev.key!==Store.KEY||!active||(view==='board'&&Dialog.isOpen))return;
  const t=Store.list()[active.id];
  if(t&&t.version!==active.version){active=Store.local(t);render();}
});
window.addEventListener('hashchange',route);

// ─── «Мои турниры» ─────────────────────────────────────────────────────────────────────────
function mine(){
  const entries=Object.values(Store.list());
  // Last opened first; entries from before «seen» keep the order they were added in.
  const rows=entries.map((r,i)=>({r,i})).sort((x,y)=>(y.r.seen??0)-(x.r.seen??0)||y.i-x.i).map(x=>x.r);
  const item=r=>{
    const t=r.state??r,done=r.state?finishedState(t):r.done;
    const badge=r.archived?'В архиве':done?'Завершён':'Идёт турнир';
    return html`<div class="item"><a href="#t/${r.id}"><strong>${t.name}</strong><span class="facts"><span>${t.sport}</span>${t.date?html`<span>${dateLabel(t.date)}</span>`:''}<span>${E.labels[t.format]}</span>${
      !localMode&&r.role==='organizer'?html`<span class="mineRole">${icon('key')}Вы организатор</span>`:''}</span></a><span class="badge${done||r.archived?'':' live'}">${badge}</span><button class="square" data-act="forget" data-id="${r.id}" aria-label="${(localMode?'Удалить турнир ':'Убрать из списка ')+t.name}" title="${localMode?'Удалить турнир':'Убрать из списка'}">${icon('x')}</button></div>`;
  };
  const list=items=>html`<div class="list">${items.map(item)}</div>`;
  const current=rows.filter(r=>!r.archived),archived=rows.filter(r=>r.archived);
  const backup=localMode?html`<section class="settingBlock backup"><h2 class="listHeading">${icon('download')}Резервная копия</h2><p class="small">Турниры хранятся только в этом браузере. Сохраните копию в файл, чтобы перенести турниры на другой компьютер или не потерять их при очистке браузера.</p><div class="toolRow"><button class="tool" data-act="exportAll"${rows.length?'':raw(' disabled')}>${icon('download')}Сохранить копию</button><label class="tool filepick">${icon('upload')}Загрузить копию<input type="file" accept=".json,application/json" data-change="importAll" aria-label="Загрузить копию турниров"></label></div></section>`:'';
  $('#secondary').innerHTML=html`<div class="topTools"><h1>Мои турниры</h1><button class="primary" data-act="create">${icon('plus')}Создать турнир</button></div>${
    rows.length?html`${current.length?list(current):html`<p class="small">Активных турниров нет.</p>`}${archived.length?html`<h2 class="listHeading">${icon('archive')}Архив</h2>${list(archived)}`:''}`
    :html`<div class="panel empty">${icon('cup')}<h2>Здесь появятся ваши турниры</h2><p>Создайте первый турнир, чтобы провести жеребьёвку и записать результаты матчей.</p></div>`}${backup}`;
}
actions.forget=button=>{
  const r=Store.list()[button.dataset.id];if(!r)return;
  const name=(r.state??r).name;
  Dialog.open({label:'Мои турниры',title:localMode?'Удалить турнир?':'Убрать из списка?',body:html`<p>${localMode
    ?html`Турнир «${name}» будет удалён из этого браузера вместе со всеми результатами. Отменить удаление нельзя.`
    :html`Турнир «${name}» исчезнет только из списка на этом устройстве. Он останется на сервере и откроется снова по своей ссылке.${r.role==='organizer'?' Права организатора на этом устройстве сохранятся.':''}`}</p>
<div class="actions"><button class="secondary" data-act="closeDialog">Отмена</button><button class="primary danger" data-act="forgetGo" data-id="${r.id}">${localMode?'Удалить турнир':'Убрать из списка'}</button></div>`});
};
actions.forgetGo=button=>{Store.forget(button.dataset.id);Dialog.close();mine();notify(localMode?'Турнир удалён':'Турнир убран из списка');};
actions.closeDialog=()=>Dialog.close();
actions.exportAll=()=>download(new Blob([JSON.stringify({arena:1,saved:new Date().toISOString(),tournaments:Store.list()},null,1)],{type:'application/json'}),'Арена — турниры '+new Date().toLocaleDateString('ru-RU')+'.json');
const TOURNAMENT_ID=/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const looksLikeTournament=t=>!!t&&TOURNAMENT_ID.test(t.id)&&Number.isSafeInteger(t.version)&&!!t.state&&typeof t.state.name==='string'&&
  Array.isArray(t.state.players)&&Array.isArray(t.state.matches)&&Array.isArray(t.state.seed)&&Object.hasOwn(E.labels,t.state.format)&&
  (t.state.tiebreak===undefined||Array.isArray(t.state.tiebreak)&&t.state.tiebreak.every(k=>Object.hasOwn(E.tiebreakLabels,k)));
changes.importAll=async input=>{
  const file=input.files[0];input.value='';if(!file)return;
  try{
    const data=JSON.parse(await file.text()),found=Object.values(data?.tournaments??{}).filter(looksLikeTournament);
    if(!found.length)throw Error('В файле нет турниров Арены.');
    const entries=Store.list();let added=0,kept=0;
    // A tournament already here is replaced only by a newer version of itself.
    for(const t of found){if(entries[t.id]&&entries[t.id].version>=t.version){kept++;continue;}entries[t.id]={...t,role:'organizer'};added++;}
    try{localStorage.setItem(Store.KEY,JSON.stringify(entries));}catch{throw Error('Браузер не смог сохранить турниры. Проверьте место для локального хранения.');}
    mine();notify('Загружено турниров: '+added+(kept?', уже были здесь: '+kept:''));
  }catch(e){notify(e instanceof SyntaxError?'Файл повреждён или это не копия Арены.':e.message);}
};

// ─── The tournament page ───────────────────────────────────────────────────────────────────
const tool=(act,ic,text)=>html`<button class="tool" data-act="${act}">${icon(ic)}${text}</button>`;
function roleBar(s){
  if(!isOrganizer())return html`<div class="roleBar"><span class="roleTag">${icon('eye')}Режим просмотра</span><p>Результаты обновляются автоматически. Изменять турнир может только организатор.</p><div class="toolRow">${tool('login','key','Вход для организатора')}</div></div>`;
  const tools=active.archived?tool('unarchive','archive','Вернуть из архива')
    :s.finished?html`${tool('reopen','flag','Возобновить турнир')}${tool('archive','archive','Перенести в архив')}`
    :html`${tool('settings','sliders','Настройки')}${tool('finish','flag','Завершить турнир')}`;
  return html`<div class="roleBar organizer"><span class="roleTag">${icon('key')}${localMode?'Управление турниром':'Вы организатор'}</span><div class="toolRow">${tools}${localMode?'':tool('access','key','Доступ организатора')}</div></div>`;
}
const stateNote=(ic,title,text)=>html`<div class="stateNote">${icon(ic)}<div><strong>${title}</strong><span>${text}</span></div></div>`;
const TABS={table:'Турнирная таблица',matches:'Расписание',roster:'Участники'};
function dashboard(){
  const s=active.state,editable=canEdit();
  const played=s.matches.reduce((n,m)=>n+Number(!!m.score)+(m.draws?.length??0),0);
  document.body.classList.add('tournament');
  const status=active.archived?stateNote('archive','Турнир в архиве','Результаты закрыты для изменений.'+(isOrganizer()?' Верните турнир из архива, чтобы продолжить.':''))
    :s.finished?stateNote('flag','Турнир завершён','Организатор закрыл результаты для изменений.'):'';
  const champion=s.champion===null?'':html`<button class="resultBanner" data-act="podium">${icon('cup')}<span>Победитель турнира <strong>${s.players[s.champion]}</strong></span><b>Пьедестал</b></button>`;
  const root=$('#secondary');
  root.innerHTML=html`<section class="scoreHeader"><div class="scoreTop"><span class="eventType"><span>${s.sport}</span><span>${E.labels[s.format]}</span></span><span class="headTools">
<a class="shareBtn" href="#tv/${active.id}">${icon('tv')}Табло числовое</a><a class="shareBtn" href="#grid/${active.id}">${icon('grid')}Табло сетка</a>${localMode?'':html`<button class="shareBtn" data-act="share">${icon('qr')}Ссылка и QR-код</button>`}<button class="shareBtn" data-act="print">${icon('print')}Печать</button></span></div>
<h1>${s.name}</h1><dl class="eventFacts"><div><dt>Дата проведения</dt><dd>${dateLabel(s.date)||'—'}</dd></div>${s.referee?html`<div><dt>Главный судья</dt><dd>${s.referee}</dd></div>`:''}<div><dt>Участники</dt><dd>${s.players.length}</dd></div><div><dt>Сыграно матчей</dt><dd>${played}</dd></div></dl></section>
${roleBar(s)}${status}${champion}
<div class="tabs">${Object.entries(TABS).map(([k,text])=>html`<button aria-pressed="${tab===k}" data-act="tab" data-tab="${k}">${text}</button>`)}</div><div id="tabBody"></div>`;
  const body=$('#tabBody');
  if(tab==='table')Board.render(body,s,editable);
  else if(tab==='roster')body.innerHTML=html`${editable?html`<div class="tabTools">${tool('rename','edit','Изменить имена')}</div>`:''}<div class="panel"><ol class="rosterList">${s.players.map(n=>html`<li>${n}</li>`)}</ol></div>`;
  else{
    const byLabel=new Map();
    for(const m of s.matches)(byLabel.get(m.label)??byLabel.set(m.label,[]).get(m.label)).push(m);
    body.innerHTML=html`${[...byLabel].map(([label,ms])=>html`<section class="panel"><h3>${label}</h3>${ms.map(m=>matchRow(s,m,editable))}</section>`)}`;
  }
}
actions.tab=button=>{tab=button.dataset.tab;dashboard();};
actions.print=()=>window.print();
function matchStatus(s,m){
  if(m.score)return m.winner===null?'Ничья':m.score[0]===m.score[1]?'Тай-брейк: '+s.players[m.winner]:'Завершён';
  return Board.isLive(m)?html`<span class="liveTag">Идёт</span>`:m.draws?.length?'Переигровка':'Ожидается';
}
function matchRow(s,m,editable){
  const live=Board.isLive(m),shown=m.score??(live?m.live:null),status=matchStatus(s,m);
  const meta=[editable&&status,m.court&&'Площадка '+m.court,m.referee&&'Судья: '+m.referee].filter(Boolean);
  const side=editable?html`<button data-act="match" data-id="${m.id}">${m.score?'Исправить':live?'Обновить счёт':'Ввести счёт'}</button>`:html`<small class="small">${status}</small>`;
  return html`<div class="match${live?' isLive':''}"><span>${s.players[m.a]}</span><span class="score">${shown?shown.join(' : '):'—'}</span><span>${s.players[m.b]}</span>${side}${meta.length?html`<small class="matchMeta">${meta.map((part,i)=>html`${i?' · ':''}${part}`)}</small>`:''}</div>`;
}

// ─── Podium ────────────────────────────────────────────────────────────────────────────────
function showPodium(s){
  const places=E.podium(s);if(!places.length)return;
  Dialog.open({label:'Турнир завершён',title:'Пьедестал почёта',variant:'awards',body:html`<p class="awardsEvent">${s.name}</p><ol class="medalList">${
    places.map((ids,i)=>html`<li class="medalRow medal${i+1}"><span class="medalNumber" aria-hidden="true">${i+1}</span><div><small class="vh">${i+1} место: </small><strong>${ids.map((id,k)=>html`${k?raw('<br>'):''}${s.players[id]}`)}</strong></div></li>`)}</ol><button class="primary awardsDone" data-act="podiumDone">К турнирной таблице</button>`});
}
actions.podium=()=>showPodium(active.state);
actions.podiumDone=()=>{Dialog.close();tab='table';dashboard();};

// ─── The match card: court and referee, start the match and keep its score, then the result ─
function readScore(value){
  if(typeof value!=='string'||!/^\d+$/.test(value)||!Number.isSafeInteger(Number(value)))throw Error('Введите целое число от 0.');
  return Number(value);
}
const scoreField=(player,name,value)=>html`<div class="scoreField"><label for="score-${name}">${player}</label><div class="scoreCounter"><button type="button" data-act="scoreStep" data-step="-1" aria-label="Уменьшить счёт: ${player}">−</button><input required id="score-${name}" name="${name}" type="text" value="${value??0}" inputmode="numeric" pattern="[0-9]+" placeholder="0" title="Целое число от 0" autocomplete="off"><button type="button" data-act="scoreStep" data-step="1" aria-label="Увеличить счёт: ${player}">+</button></div></div>`;
actions.match=button=>{
  if(!canEdit())return;
  const s=active.state,id=Number(button.dataset.id),m=s.matches.find(x=>x.id===id);if(!m)return;
  const live=Board.isLive(m),shown=m.score??m.live;
  const referees=[...new Set([s.referee,...s.matches.map(x=>x.referee)].filter(Boolean))];
  // The result button comes first in the form, so Enter saves the result.
  const main=m.score?html`<button class="primary" name="action" value="final">Исправить результат</button>`
    :html`<button class="primary" name="action" value="final">${live?'Завершить матч':'Сохранить результат'}</button><button class="secondary" name="action" value="live">${live?'Обновить счёт':'Начать матч'}</button>`;
  Dialog.open({label:m.label,title:'Матч',body:html`<p class="matchState">Статус: <b>${m.score?'Завершён':live?html`<span class="liveTag">Идёт</span>`:'Не начат'}</b></p>${
    m.draws?.length?html`<p class="small">Предыдущие ничьи: ${m.draws.map(d=>d.join(' : ')).join(', ')}. Введите счёт переигровки.</p>`:''}
<form data-form="score" data-id="${m.id}"><div class="columns">${field('Площадка','court','text',m.court,{attrs:'maxlength="30" placeholder="Например, 1" autocomplete="off"',required:false})}${field('Судья матча','referee','text',m.referee,{attrs:'maxlength="150" list="referees" placeholder="Имя и фамилия" autocomplete="off"',required:false})}</div>
<datalist id="referees">${referees.map(r=>html`<option value="${r}">`)}</datalist>
<div class="columns">${scoreField(s.players[m.a],'a',shown?.[0])}${scoreField(s.players[m.b],'b',shown?.[1])}</div>
<label class="field" id="tie" hidden>Исход при равном счёте<select name="tie"><option value="">${s.allowDraw===true?'Ничья и переигровка':'Выберите победителя тай-брейка'}</option><option value="${m.a}">${s.players[m.a]}</option><option value="${m.b}">${s.players[m.b]}</option></select></label>${errBox}
<div class="actions matchActions">${main}</div>${m.score?'':html`<div class="minorActions"><button class="textBtn" name="action" value="plan" formnovalidate>Сохранить только площадку и судью</button>${live?html`<button class="textBtn" name="action" value="stop" formnovalidate>Матч не начался</button>`:''}</div>`}</form>`});
  const form=$('[data-form="score"]'),{a,b,tie}=form.elements;
  // The tie-break choice appears when a match that needs a winner ends level.
  const sync=()=>{$('#tie').hidden=!(s.allowDraw!==false&&m.phase!=='league'&&a.value!==''&&b.value!==''&&Number(a.value)===Number(b.value));};
  for(const input of [a,b])input.addEventListener('input',()=>{
    const message=input.value&&(!/^\d+$/.test(input.value)||!Number.isSafeInteger(Number(input.value)))?'Введите целое число от 0.':'';
    input.setCustomValidity(message);Dialog.error(message);sync();
  });
  sync();if(m.winner!==null)tie.value=String(m.winner);
};
actions.scoreStep=button=>{
  const input=button.parentElement.querySelector('input'),value=Number(input.value);
  input.value=String(Math.min(Number.MAX_SAFE_INTEGER,Math.max(0,(Number.isSafeInteger(value)&&value>=0?value:0)+Number(button.dataset.step))));
  input.dispatchEvent(new Event('input',{bubbles:true}));
};
forms.score=(form,submitter)=>run(submitter??$('.primary',form),async()=>{
  const id=Number(form.dataset.id),action=submitter?.value||'final',d=new FormData(form);
  const before=active.state,wasLive=Board.isLive(before.matches.find(x=>x.id===id));
  let next=structuredClone(before);
  const target=next.matches.find(x=>x.id===id);
  for(const key of ['court','referee']){const v=String(d.get(key)??'').trim();if(v)target[key]=v;else delete target[key];}
  if(action==='live')target.live=[readScore(d.get('a')),readScore(d.get('b'))];
  if(action==='stop')delete target.live;
  if(action==='final')next=E.update(next,id,readScore(d.get('a')),readScore(d.get('b')),d.get('tie')===''?null:Number(d.get('tie')));
  await save(next);Dialog.close();render();
  if(action!=='final'){notify(action==='live'?(wasLive?'Счёт обновлён':'Матч начался'):action==='stop'?'Матч возвращён в ожидание':'Площадка и судья сохранены');return;}
  if(next.champion!==null&&JSON.stringify(E.podium(before))!==JSON.stringify(E.podium(next)))showPodium(next);
  else notify(next.matches.find(x=>x.id===id)?.score?'Результат сохранён':'Ничья сохранена. Откройте эту пару для переигровки.');
});

// ─── Organizer: settings, names, a new draw, finishing and the archive ─────────────────────
actions.settings=()=>{
  const s=active.state,locked=started(s);
  Dialog.open({label:'Управление турниром',title:'Настройки',body:html`<form data-form="settings">${detailFields(s,false)}${drawSwitch(s.allowDraw,locked)}${locked?html`<p class="small">Ничью можно включить или выключить только до первого матча.</p>`:''}
<fieldset class="group"><legend>Определение мест</legend>${priorityIntro}${priorityList(s.tiebreak??legacyOrder())}${priorityOutro}</fieldset>${s.format==='double'?finalResetChoice(s.finalReset,false):''}${errBox}
<div class="actions"><button class="primary">Сохранить настройки</button></div></form>
<section class="settingBlock"><h3>Участники</h3><p class="small">Исправьте опечатки в именах. Пары и результаты не изменятся.</p><button class="secondary" data-act="rename">${icon('edit')}Изменить имена</button></section>
<section class="settingBlock"><h3>Жеребьёвка</h3><p class="small">${locked?'Провести жеребьёвку заново можно только до первого матча.':'Участники будут заново распределены случайным образом. Можно выбрать другой формат.'}</p><button class="secondary" data-act="redraw"${locked?raw(' disabled'):''}>${icon('shuffle')}Провести жеребьёвку заново</button></section>`});
  prioritySort($('#priority'));
};
forms.settings=(form,button)=>run(button,async()=>{
  const s=active.state,d=readDetails(form),order=priorityOrder();
  // A tournament without its own order counts difference and goals only; it keeps that until
  // the organizer moves a row.
  if(s.tiebreak||order.join()!==legacyOrder().join())d.tiebreak=order;
  if(s.format==='double'){const reset=new FormData(form).get('finalReset')!=='false';if(reset!==(s.finalReset!==false))d.finalReset=reset;}
  if(started(s))d.allowDraw=s.allowDraw;
  // New points, places or finals can reorder a finished stage, so the tournament is replayed.
  const replay=JSON.stringify(d.points)!==JSON.stringify(s.points??E.defaultPoints)||JSON.stringify(d.tiebreak)!==JSON.stringify(s.tiebreak)||'finalReset' in d;
  let next={...structuredClone(s),...d};
  if(replay){
    try{next=E.rebuild(next);}
    catch{throw Error(d.finalReset===false&&s.matches.some(m=>m.label==='Решающий финал'&&m.score)?'Дополнительный финал уже сыгран, его нельзя отменить. Настройки не сохранены.':'С новыми настройками меняется состав уже сыгранных встреч следующего этапа. Настройки не сохранены.');}
  }
  await save(next);Dialog.close();render();notify('Настройки сохранены');
});
actions.rename=()=>{
  const s=active.state;
  Dialog.open({label:'Управление турниром',title:'Имена участников',body:html`<form data-form="names">${rosterInputs(s.players,s.players.length)}${errBox}<div class="actions"><button class="primary">Сохранить имена</button></div></form>`});
};
forms.names=(form,button)=>run(button,async()=>{
  const names=rosterValues(form);checkNames(names);
  await change(next=>{next.players=names;},'Имена сохранены');
});
actions.redraw=()=>{
  const s=active.state;
  Dialog.open({label:'Управление турниром',title:'Новая жеребьёвка',body:html`<p class="small">Пары будут составлены заново. Назначенные площадки и судьи матчей сбросятся.</p><form data-form="redraw">${formatChoices(s.format,s.finalReset)}${errBox}<div class="actions"><button class="primary">Провести жеребьёвку</button></div></form>`});
  syncFormat($('[data-form="redraw"]'));
};
forms.redraw=(form,button)=>run(button,async()=>{
  const s=active.state;
  if(started(s))throw Error('Матчи уже начались, жеребьёвку провести нельзя.');
  const {format,finalReset}=readFormat(form);
  await save(E.create({...E.meta(s),finalReset},s.players,format));Dialog.close();tab='table';render();notify('Жеребьёвка проведена заново');
});
actions.finish=()=>Dialog.open({label:'Управление турниром',title:'Завершить турнир',body:html`<p>${active.state.champion===null?'Победитель ещё не определён, несыгранные матчи останутся без результата.':'Все матчи сыграны.'} После завершения результаты нельзя изменить, пока вы не возобновите турнир. Завершённый турнир можно перенести в архив.</p>${errBox}
<div class="actions"><button class="secondary" data-act="closeDialog">Отмена</button><button class="primary" data-act="finishGo">${icon('flag')}Завершить турнир</button></div>`});
actions.finishGo=button=>run(button,()=>change(next=>{next.finished=true;next.matches.forEach(m=>delete m.live);},'Турнир завершён'));
actions.reopen=button=>run(button,()=>change(next=>{next.finished=false;}),'Турнир возобновлён');
async function setArchived(flag){
  const info=await Store.archive(active,flag);
  active={...active,version:info.version,archived:flag};Store.remember(active);render();
}
actions.archive=button=>run(button,()=>setArchived(true),'Турнир перенесён в архив');
actions.unarchive=button=>run(button,()=>setArchived(false),'Турнир возвращён из архива');

// ─── Access: the organizer key, the public link and QR code, signing in and out ────────────
const keyBlock=key=>html`<div class="keyBlock"><p class="secretNote">${icon('key')}<span><b>Только для организатора.</b> Ссылка и код дают полное управление турниром. Сохраните их сейчас: Арена хранит лишь их отпечаток и показать их снова не сможет.</span></p>${
  copyField('Ссылка организатора',links.organizer(active.id,key),'orgLink')}${copyField('Код доступа',key.match(/.{1,4}/g).join('-'),'orgCode')}</div>`;
const qrCode=(cls='')=>html`<div class="qrBox ${cls}">${raw(ArenaQR.svg(links.view(active.id),'QR-код публичной ссылки турнира'))}</div>`;
function createdDialog(key){
  Dialog.open({label:'Турнир создан',title:'Сохраните доступ организатора',variant:'secret',body:html`${keyBlock(key)}<p class="small">На этом устройстве вы уже вошли как организатор. На другом устройстве откройте ссылку организатора или введите код кнопкой «Вход для организатора».</p>
<h3 class="dialogSub">Для зрителей</h3><div class="shareRow">${qrCode()}${copyField('Публичная ссылка: только просмотр',links.view(active.id),'viewLink')}</div><div class="actions"><button class="primary" data-act="closeDialog">Ссылки сохранены</button></div>`});
}
actions.share=()=>Dialog.open({label:'Для зрителей',title:'Ссылка и QR-код',body:html`${qrCode('big')}<p>Отсканируйте код камерой телефона, и откроется страница турнира. Зрители видят таблицу, сетку, расписание и результаты, но ничего не могут изменить.</p>
${copyField('Публичная ссылка',links.view(active.id),'viewLink')}${copyField('Табло числовое',links.tv(active.id),'tvLink')}${copyField('Табло сетка',links.grid(active.id),'gridLink')}${errBox}
<div class="actions"><button class="secondary" data-act="qrPng">${icon('download')}Скачать QR-код</button><a class="secondary" href="#tv/${active.id}">${icon('tv')}Табло числовое</a><a class="secondary" href="#grid/${active.id}">${icon('grid')}Табло сетка</a></div>`});
actions.qrPng=button=>run(button,async()=>download(await ArenaQR.png(links.view(active.id)),'QR — '+active.state.name+'.png'));
function accessDialog(key=null){
  Dialog.open({label:'Организатор',title:'Доступ организатора',variant:key?'secret':'',body:html`${key?keyBlock(key):html`<p>Ссылка и код организатора показываются один раз: при создании турнира и при выпуске нового ключа. Если они потеряны или могли попасть к посторонним, выпустите новый ключ.</p>`}${errBox}
<div class="actions"><button class="secondary" data-act="rotate">${icon('key')}Выпустить новый ключ</button></div><p class="small">Прежние ссылка и код перестанут действовать, а другие устройства потеряют права организатора. Это устройство останется организатором.</p>
<div class="settingBlock"><button class="textBtn" data-act="logout">${icon('logout')}Выйти из режима организатора на этом устройстве</button><p class="small">Вернуться можно по ссылке или коду организатора. Убедитесь, что они сохранены.</p></div>`});
}
actions.access=()=>accessDialog();
actions.rotate=button=>run(button,async()=>{const {key}=await Store.newKey(active);accessDialog(key);notify('Выпущен новый ключ. Прежний больше не действует.');});
actions.logout=button=>run(button,async()=>{await Store.signOut(active.id);Dialog.close();await reload();notify('Вы вышли из режима организатора');});
actions.login=()=>Dialog.open({label:'Организатор',title:'Вход для организатора',body:html`<form data-form="login"><p>Вставьте ссылку организатора или введите код доступа, который Арена показала при создании турнира.</p><label class="field">Ссылка или код<input name="key" required autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX-XXXX-…"></label>${errBox}<div class="actions"><button class="primary">Войти</button></div></form>`});
forms.login=(form,button)=>run(button,async()=>{
  const value=form.elements.key.value.trim(),key=/\/access\/([\w-]+)/.exec(value)?.[1]??value;
  await Store.signIn(active.id,key);
  form.reset();Dialog.close();await reload();notify('Вы вошли как организатор');
});

// ─── Start ─────────────────────────────────────────────────────────────────────────────────
// On phones the hero bracket zooms in on the last three rounds so its names stay readable.
{
  const narrow=matchMedia('(max-width:640px)'),demo=$('#demoBracket');
  const fit=()=>demo.setAttribute('viewBox',narrow.matches?'137 0 427 380':'-2 0 566 380');
  narrow.addEventListener('change',fit);fit();
}
route();
