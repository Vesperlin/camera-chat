import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./sb-config.js";

const ROOM = "1010";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const $=s=>document.querySelector(s); const log=$("#log"), viewer=$("#viewer"), vImg=$("#viewer img");
const myId="c_viewer"; let last=0;

function divider(t){
  const d=document.createElement("div");
  d.style.cssText="align-self:center;color:#7f8a98;font-size:12px;padding:4px 10px;border:1px solid #1e2430;border-radius:999px;opacity:.9;margin:6px 0 2px";
  d.textContent=new Date(t).toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit"});
  log.appendChild(d);
}

function render(m,h=false){
  const ts=new Date(m.created_at||Date.now()).getTime();
  if(ts-last>5*60*1000){ divider(m.created_at||new Date().toISOString()); }
  last=ts;
  const row=document.createElement("div");
  row.className="row "+(m.author_id===myId?"self":"peer");
  const bubble=document.createElement("div"); bubble.className="msg";
  if(m.type==="image"){
    const a=document.createElement("a"); a.href=m.content; a.onclick=e=>{e.preventDefault(); vImg.src=a.href; viewer.classList.add("show");};
    const img=document.createElement("img"); img.src=m.content; a.appendChild(img); bubble.appendChild(a);
  }else{
    const p=document.createElement("p"); p.textContent=m.content; bubble.appendChild(p);
  }
  row.appendChild(bubble); log.appendChild(row);
  if(!h) log.scrollTop=log.scrollHeight;
}

async function load(){
  const { data, error } = await supabase.from("messages").select("*").eq("room_id",ROOM).order("created_at",{ascending:true}).limit(500);
  if(error){ alert(error.message); return; }
  log.innerHTML=""; last=0; data.forEach(m=>render(m,true));
}
function sub(){
  supabase.channel("room:"+ROOM)
    .on("postgres_changes",{event:"INSERT",schema:"public",table:"messages",filter:`room_id=eq.${ROOM}`}, (payload)=>render(payload.new))
    .subscribe();
}
viewer.addEventListener("click", ()=> viewer.classList.remove("show"));
load(); sub();
