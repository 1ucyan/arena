"use strict";
const ArenaEngine = (() => {
  const labels = {single:"Олимпийская",double:"С «подвалом»",round:"Круговая",roundFinal:"Круговая с финалом",groups:"Групповая + плей-офф"};
  const defaultPoints = {win:3,draw:1,loss:0};
  // Draw rules. A tournament keeps the rules it was drawn with, so a result corrected later
  // replays the same pairings. 1: the first rules. 2 (every new draw): first-round byes meet
  // first-round winners, groups have at least three participants, and the double elimination
  // avoids pairing players who have already met. 3: the two semi-final losers play a match for
  // third place.
  const RULES = 3;
  // Places on equal points: the organizer's order of these criteria, then the draw order.
  // A tournament without its own order keeps the first one: goal difference, then goals scored.
  const tiebreakLabels={diff:['Разница мячей','Забитые минус пропущенные'],h2h:['Личные встречи','Очки во встречах между равными участниками'],for:['Забитые мячи','Больше забитых — выше'],wins:['Количество побед','Больше побед — выше']};
  const defaultTiebreak=['diff','h2h','for','wins'];
  const legacyTiebreak=['diff','for'];
  const pairKey=(a,b)=>a<b?a+'/'+b:b+'/'+a;

  function shuffle(list) {
    const result = [...list];
    for (let i=result.length-1;i>0;i--) {
      const j=Math.floor(Math.random()*(i+1));
      [result[i],result[j]]=[result[j],result[i]];
    }
    return result;
  }
  function pair(s,a,b,label,phase="knock",group=null,round=1) {
    s.matches.push({id:s.matches.length+1,a,b,label,phase,group,round,score:null,winner:null});
  }
  function league(s,players,group=null) {
    const ring=[...players];
    if (ring.length%2) ring.push(null);
    for(let r=1;r<ring.length;r++) {
      for(let i=0;i<ring.length/2;i++){
        const a=ring[i],b=ring[ring.length-1-i];
        if(a!==null && b!==null) pair(s,a,b,group===null?'Тур '+r:'Группа '+group+' · тур '+r,'league',group,r);
      }
      ring.splice(1,0,ring.pop());
    }
  }
  function table(s,group,all=false) {
    const ids=group==null?s.seed:s.groups[group],drawOrder=new Map(ids.map((id,i)=>[id,i]));
    const points=s.points??defaultPoints;
    const stats=new Map(ids.map(id=>[id,{id,w:0,d:0,l:0,f:0,a:0,pts:0,played:0}]));
    const games=[];
    for(const m of s.matches){
      if(!all && (m.phase!=='league'||m.group!==(group??null))) continue;
      if(!stats.has(m.a)||!stats.has(m.b)) continue;
      games.push(m);
      for(const [a,b] of m.draws??[]){
        for(const [id,x,y] of [[m.a,a,b],[m.b,b,a]]){
          const q=stats.get(id);q.played++;q.d++;q.f+=x;q.a+=y;q.pts+=points.draw;
        }
      }
      if(!m.score)continue;
      for(const [id,x,y] of [[m.a,...m.score],[m.b,m.score[1],m.score[0]]]){
        const q=stats.get(id);q.played++;q.f+=x;q.a+=y;
        if(m.winner===id){q.w++;q.pts+=points.win;}else if(m.winner===null){q.d++;q.pts+=points.draw;}else{q.l++;q.pts+=points.loss;}
      }
    }
    // Head-to-head: points earned in the games among the participants who are still level.
    const mutual=list=>{
      const inside=new Set(list.map(q=>q.id)),pts=new Map(list.map(q=>[q.id,0]));
      for(const m of games){
        if(!inside.has(m.a)||!inside.has(m.b))continue;
        for(const _ of m.draws??[]){pts.set(m.a,pts.get(m.a)+points.draw);pts.set(m.b,pts.get(m.b)+points.draw);}
        if(!m.score)continue;
        for(const id of [m.a,m.b])pts.set(id,pts.get(id)+(m.winner===id?points.win:m.winner===null?points.draw:points.loss));
      }
      return q=>pts.get(q.id);
    };
    const measure={pts:()=>q=>q.pts,diff:()=>q=>q.f-q.a,for:()=>q=>q.f,wins:()=>q=>q.w,h2h:mutual};
    // Each criterion sorts the participants who are level on the ones before it, so a
    // head-to-head mini table only takes the games among those participants.
    const rank=(list,keys)=>{
      if(list.length<2||!keys.length)return list.sort((x,y)=>drawOrder.get(x.id)-drawOrder.get(y.id));
      const [key,...rest]=keys,value=measure[key](list);
      list.sort((x,y)=>value(y)-value(x));
      const out=[];
      for(let i=0;i<list.length;){
        let j=i+1;while(j<list.length&&value(list[j])===value(list[i]))j++;
        out.push(...rank(list.slice(i,j),rest));i=j;
      }
      return out;
    };
    return rank([...stats.values()],['pts',...(s.tiebreak??legacyTiebreak)]);
  }
  function knockLabel(n,level) {
    if(n===2)return 'Финал';
    if(n===4)return 'Полуфинал';
    if(n===8)return 'Четвертьфинал';
    if(n===16)return '1/8 финала';
    return 'Раунд '+level;
  }
  // Second-round order after a round with byes: bye, winner, bye, winner… so a participant who
  // skipped the first round meets someone who played it, while there are such players left.
  function afterByes(byes,winners){
    const list=[];
    for(let i=0;i<Math.max(byes.length,winners.length);i++){if(i<byes.length)list.push(byes[i]);if(i<winners.length)list.push(winners[i]);}
    return list;
  }
  // Pairs a pool in order, avoiding players who have already met when the pool allows it.
  function pairPool(pool,met){
    let steps=0;
    const search=left=>{
      if(!left.length)return [];
      if(++steps>20000)return null;
      const [a,...rest]=left;
      for(let j=0;j<rest.length;j++){
        if(met.has(pairKey(a,rest[j])))continue;
        const tail=search(rest.filter((_,k)=>k!==j));
        if(tail)return [[a,rest[j]],...tail];
      }
      return null;
    };
    const found=search(pool);
    if(found)return found;
    const pairs=[];for(let i=0;i<pool.length;i+=2)pairs.push([pool[i],pool[i+1]]);return pairs;
  }
  function bracket(s,list) {
    if(list.length===1){s.champion=list[0];return;}
    s.level++;
    const power=2**Math.floor(Math.log2(list.length));
    const playing=power===list.length?power:(list.length-power)*2;
    s.byes=list.slice(playing);
    for(let i=0;i<playing;i+=2)pair(s,list[i],list[i+1],knockLabel(list.length,s.level),'knock',null,s.level);
  }
  function doubleRound(s) {
    const losses=new Map(s.seed.map(id=>[id,0]));
    const byeCount=new Map(s.seed.map(id=>[id,0]));
    for(const id of s.rest)byeCount.set(id,byeCount.get(id)+1);
    for(const m of s.matches)if(m.score){const loser=m.winner===m.a?m.b:m.a;losses.set(loser,losses.get(loser)+1);}
    const active=s.seed.filter(id=>losses.get(id)<2);
    if(active.length===1){s.champion=active[0];return;}
    // Both finalists have lost once: the lower-bracket player won the final. Without the extra
    // final (finalReset false) that final decides the title.
    if(active.length===2&&s.finalReset===false&&active.every(id=>losses.get(id)===1)){
      const final=[...s.matches].reverse().find(m=>m.phase==='final');
      if(final){s.champion=final.winner;return;}
    }
    s.level++;
    if(active.length===2){
      // Two participants (or a decider): the first final, a repeat when needed, and the decider
      // once both have lost once.
      const finals=s.matches.filter(m=>m.phase==='final').length;
      pair(s,...active,active.every(id=>losses.get(id)===1)?'Решающий финал':finals?'Финал · матч '+(finals+1):'Финал','final',null,s.level);return;
    }
    const met=new Set(s.matches.map(m=>pairKey(m.a,m.b)));
    for (const l of [0,1]) {
      const pool=active.filter(id=>losses.get(id)===l);
      if(pool.length%2){
        pool.sort((a,b)=>byeCount.get(a)-byeCount.get(b));s.rest.push(pool.shift());
      }
      const pairs=s.rules>=2?pairPool(pool,met):pool.flatMap((id,i)=>i%2?[]:[[id,pool[i+1]]]);
      for(const [a,b] of pairs)pair(s,a,b,(l?'Нижняя':'Верхняя')+' сетка · раунд '+s.level,'double',null,s.level);
    }
  }
  // groupCount: groups of at least three, as many as a power of two allows (2 → 4 → 8 in the play-off).
  const groupCount=(n,rules)=>rules>=2?(n<6?1:2**Math.floor(Math.log2(n/3))):(n<4?1:2**Math.floor(Math.log2(Math.max(2,n/3))));
  function create(meta,players,format,initialSeed=null){
    const seed=initialSeed?[...initialSeed]:shuffle(players.map((_,i)=>i));
    // A new draw takes the current rules; replaying a stored draw keeps the rules it had.
    const rules=initialSeed?(meta.rules??1):RULES;
    const s={...meta,rules,players,seed,format,matches:[],level:0,byes:[],rest:[],groups:{},champion:null,playoff:false};
    if(format==='single')bracket(s,seed);
    if(format==='double')doubleRound(s);
    if(format==='round'||format==='roundFinal')league(s,seed);
    if(format==='groups'){
      const count=groupCount(players.length,rules);
      seed.forEach((id,i)=>{const key=String(i%count+1);(s.groups[key]??=[]).push(id);});
      Object.entries(s.groups).forEach(([key,group])=>league(s,group,key));
    }
    return s;
  }
  // at: when the result came in, for the screen's latest results; null keeps it unknown.
  function record(s,id,a,b,tiebreak=null,at=null){
    const m=s.matches.find(x=>x.id===id);
    if(!m||m.score)throw Error('Результат уже сохранён.');
    if(![a,b].every(v=>Number.isSafeInteger(v)&&v>=0))throw Error('Введите целый неотрицательный счёт.');
    if(a===b&&s.allowDraw===false)throw Error('Ничья отключена. Укажите счёт, при котором определён победитель.');
    if(a===b && m.phase!=='league' && s.allowDraw===true && tiebreak===null){
      (m.draws??=[]).push([a,b]);
      delete m.live;
      return;
    }
    if(a===b&&m.phase!=='league'&&![m.a,m.b].includes(tiebreak))throw Error('При равном счёте укажите победителя тай-брейка.');
    m.score=[a,b];m.winner=a===b?(m.phase==='league'?null:tiebreak):a>b?m.a:m.b;
    delete m.live;if(at!==null)m.at=at;
    if(s.matches.some(x=>!x.score))return;
    if(s.format==='round'){s.champion=table(s,null)[0].id;return;}
    if(s.format==='roundFinal'){
      if(m.phase==='final'){s.champion=m.winner;return;}
      const leaders=table(s,null).slice(0,2);
      pair(s,leaders[0].id,leaders[1].id,'Финал','final',null,++s.level);
      return;
    }
    if(s.format==='double'){doubleRound(s);return;}
    if(s.format==='groups'&&!s.playoff){
      s.playoff=true;
      const ranks=Object.keys(s.groups).map(key=>table(s,key).slice(0,2).map(r=>r.id));
      const draw=[];
      if(ranks.length===1) draw.push(...ranks[0]);
      else for(let i=0;i<ranks.length;i+=2)draw.push(ranks[i][0],ranks[i+1][1],ranks[i+1][0],ranks[i][1]);
      bracket(s,draw);return;
    }
    const played=s.matches.filter(x=>x.phase==='knock'&&x.round===s.level),winners=played.map(x=>x.winner);
    const next=s.rules>=2?afterByes(s.byes,winners):[...s.byes,...winners];
    // After two semi-finals the losers play for third place, before the final.
    if(s.rules>=3&&next.length===2&&played.length===2)
      pair(s,...played.map(x=>x.winner===x.a?x.b:x.a),'Матч за 3-е место','third',null,s.level+1);
    bracket(s,next);
  }
  const meta=s=>({name:s.name,sport:s.sport,date:s.date,referee:s.referee,count:s.count,points:s.points,allowDraw:s.allowDraw,finished:s.finished,rules:s.rules,tiebreak:s.tiebreak,finalReset:s.finalReset});
  function update(s,id,a,b,tiebreak){
    const match=s.matches.find(m=>m.id===id);
    if(!match?.score){record(s,id,a,b,tiebreak,Date.now());return s;}
    return rebuild(s,{id,a,b,tiebreak});
  }
  // Draws again with the same seed and replays every result, so a corrected score or new
  // points settle into the next stages. change replaces one recorded result.
  function rebuild(s,change=null){
    const rebuilt=create(meta(s),s.players,s.format,s.seed);
    for(const old of s.matches){
      const current=rebuilt.matches.find(m=>m.phase===old.phase&&m.group===old.group&&m.round===old.round&&
        ((m.a===old.a&&m.b===old.b)||(m.a===old.b&&m.b===old.a)));
      if(!current){
        if(old.score||old.draws?.length)throw Error('Этот результат меняет состав уже сыгранной встречи следующего этапа. Прежний счёт сохранён.');
        continue;
      }
      if(old.court)current.court=old.court;
      if(old.referee)current.referee=old.referee;
      if(old.draws?.length)current.draws=old.draws.map(score=>[...score]);
      const orient=v=>current.a===old.a?[...v]:[v[1],v[0]];
      if(!old.score){if(old.live)current.live=orient(old.live);continue;}
      const edited=change?.id===old.id;
      const oriented=orient(edited?[change.a,change.b]:old.score);
      record(rebuilt,current.id,...oriented,edited?change.tiebreak:old.winner,edited?Date.now():old.at??null);
    }
    return rebuilt;
  }
  function podium(s) {
    if (s.champion == null) return [];
    if (s.format === "round") return table(s,null).slice(0,3).map(row=>[row.id]);
    const final = [...s.matches].reverse().find(m=>m.phase!=='third');
    const third = s.matches.find(m=>m.phase==='third');
    const loser = m => m.winner === m.a ? m.b : m.a;
    const silver = loser(final);
    if(s.format==="roundFinal")return [[s.champion],[silver],...table(s,null).slice(2,3).map(row=>[row.id])];
    let bronze = [];
    if (s.players.length > 2) {
      if (s.format === "double") {
        const losses = new Map();
        let lastExitRound = 0;
        for (const m of s.matches) {
          const id = loser(m);
          const count = (losses.get(id) || 0) + 1;
          losses.set(id,count);
          if (count !== 2 || id === silver || id === s.champion) continue;
          if (m.round > lastExitRound) { bronze = []; lastExitRound = m.round; }
          bronze.push(id);
        }
      } else if (third?.score) {
        bronze = [third.winner];
      } else {
        bronze = s.matches.filter(m=>m.phase==="knock" && m.round===final.round-1).map(loser);
        if (!bronze.length && s.format==="groups") {
          const ranking = table(s,Object.keys(s.groups)[0]);
          if (ranking[2]) bronze = [ranking[2].id];
        }
      }
    }
    return [[s.champion],[silver],bronze].filter(place=>place.length);
  }
  return {create,record,update,rebuild,meta,table,labels,podium,defaultPoints,afterByes,tiebreakLabels,defaultTiebreak,legacyTiebreak};
})();
if(typeof module!=="undefined"&&module.exports)module.exports=ArenaEngine;
