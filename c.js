import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./sb-config.js";

const ROOM_ID = "1010";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = s=>document.querySelector(s);
const log=$("#log"), viewer=$("#viewer"), viewerImg=$("#viewer img");

function addRow(m){
  const row=document.createElement("div");
  row.className="row "+(m.author_id==="C"?"self":"peer");
  const b=document.createElement("div"); b.className="msg";
  if(m.type==="image"){
    const a=document.createElement("a");
    a.href=m.content; a.onclick=e=>{e.preventDefault(); viewerImg.src=a.href; viewer.classList.add("show");};
    const img=document.createElement("img"); img.src=m.content; a.appendChild(img); b.appendChild(a);
  }else{
    const p=document.createElement("p"); p.textContent=m.content; b.appendChild(p);
  }
  row.appendChild(b); log.appendChild(row); log.scrollTop = log.scrollHeight;
}

async function load(){
  const {data,error}=await supabase.from("messages").select("*").eq("room_id",ROOM_ID).order("created_at",{ascending:true}).limit(500);
  if(error){ alert(error.message); return; }
  log.innerHTML=""; data.forEach(addRow);
}
function sub(){
  supabase.channel("room:"+ROOM_ID)
  .on("postgres_changes",{event:"INSERT",schema:"public",table:"messages",filter:`room_id=eq.${ROOM_ID}`},p=>addRow(p.new))
  .subscribe();
}
await load(); sub();
viewer.addEventListener("click", ()=> viewer.classList.remove("show"));
