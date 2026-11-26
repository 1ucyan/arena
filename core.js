"use strict";
// Shared by every page script: the mode, safe markup, delegated events, the dialog and the toast.
// The GitHub Pages copy sets localMode to true: tournaments then live only in this browser.
const localMode=true;
const E=ArenaEngine;
const $=(s,root=document)=>root.querySelector(s);
const $$=(s,root=document)=>[...root.querySelectorAll(s)];

// Markup is written as html`…`. Every value is escaped unless it is markup already (html or raw);
// arrays are joined, and null, undefined and false leave nothing.
class Markup{constructor(text){this.text=text;}toString(){return this.text;}}
const raw=text=>new Markup(String(text));
const ESCAPES={'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'};
const esc=v=>v instanceof Markup?v.text:Array.isArray(v)?v.map(esc).join(''):v==null||v===false?'':String(v).replace(/[&<>"']/g,c=>ESCAPES[c]);
const html=(parts,...values)=>raw(parts.reduce((out,part,i)=>out+esc(values[i-1])+part));
const icon=name=>html`<svg class="icon" aria-hidden="true"><use href="#${name}"/></svg>`;
const plural=(n,one,few,many)=>{const a=n%10,b=n%100;return n+' '+(a===1&&b!==11?one:a>=2&&a<=4&&(b<12||b>14)?few:many);};
const dateLabel=d=>d?new Date(d+'T12:00:00').toLocaleDateString('ru-RU'):'';

// Buttons and forms name their handler: data-act="name" on a click, data-form="name" on a submit,
// data-change="name" on a change. Pages re-render freely without wiring their buttons again.
const actions={},forms={},changes={};
document.addEventListener('click',ev=>{
  const target=ev.target.closest('[data-act]');
  if(!target||target.disabled||!actions[target.dataset.act])return;
  ev.preventDefault();actions[target.dataset.act](target,ev);
});
document.addEventListener('submit',ev=>{
  const form=ev.target,fn=forms[form.dataset.form];
  if(!fn)return;
  ev.preventDefault();fn(form,ev.submitter??null);
});
document.addEventListener('change',ev=>{const fn=changes[ev.target.dataset.change];if(fn)fn(ev.target,ev);});

let noticeTimer=0;
function notify(text){
  const out=$('#notice');clearTimeout(noticeTimer);
  out.textContent=text;out.hidden=false;noticeTimer=setTimeout(()=>{out.hidden=true;},4000);
}
// Runs an action of a button: the button waits, and a failure is shown in the open dialog or as a toast.
async function run(button,fn,done=''){
  if(button)button.disabled=true;
  try{await fn();if(done)notify(done);}
  catch(e){Dialog.error(e.message)||notify(e.message);}
  finally{if(button)button.disabled=false;}
}

// The one dialog of the page. A form is closed only by its buttons, the cross or Escape, so a
// stray click beside it does not throw away what was typed.
const Dialog=(()=>{
  const box=$('#modal'),label=$('#dialogLabel'),title=$('#dialogTitle'),body=$('#dialogBody');
  let closed=null;
  function open({label:text='',step=null,title:heading,body:content,variant='',onClose=null}){
    const bar=step?html`<span class="steps" aria-hidden="true">${Array.from({length:step[1]},(_,i)=>html`<i class="${i<step[0]?'on':''}"></i>`)}</span>`:'';
    label.innerHTML=html`${bar}${step?`Шаг ${step[0]} из ${step[1]}`:text}`;
    title.textContent=heading;body.innerHTML=content;
    box.className=variant;closed=onClose;
    if(!box.open)box.showModal();
    box.scrollTop=0;
    return body;
  }
  function close(){if(box.open)box.close();}
  // An organizer key leaves the page as soon as its dialog closes.
  box.addEventListener('close',()=>{const fn=closed;closed=null;if(box.classList.contains('secret'))body.replaceChildren();fn?.();});
  box.addEventListener('click',ev=>{
    if(ev.target!==box||body.querySelector('form'))return;
    const r=box.getBoundingClientRect();
    if(ev.clientX<r.left||ev.clientX>r.right||ev.clientY<r.top||ev.clientY>r.bottom)close();
  });
  $('#close').addEventListener('click',close);
  /** Shows a message in the dialog's error line; false when no dialog shows one. */
  function error(message){const out=box.open&&$('.err',body);if(out)out.textContent=message;return !!out;}
  return {open,close,error,body,get isOpen(){return box.open;}};
})();
const errBox=html`<div class="err" role="alert"></div>`;

// Fields of the forms.
function field(text,name,type,value,{attrs='',required=true}={}){
  return html`<label class="field">${text}<input name="${name}" type="${type}" value="${value??''}"${required?raw(' required'):''} ${raw(attrs)}></label>`;
}
function copyField(text,value,id){
  return html`<div class="copyField"><label for="${id}">${text}</label><div class="copyRow"><input id="${id}" readonly value="${value}" spellcheck="false"><button type="button" class="secondary" data-act="copy" data-target="${id}">${icon('copy')}Копировать</button></div></div>`;
}
actions.copy=async button=>{
  const input=document.getElementById(button.dataset.target);
  try{await navigator.clipboard.writeText(input.value);notify('Скопировано');}
  catch{input.select();notify('Нажмите Ctrl+C, чтобы скопировать');}
};
/** Offers a file to save. */
function download(blob,name){
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name.replace(/[\\/:*?"<>|]/g,'').slice(0,80);
  document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),2000);
}
