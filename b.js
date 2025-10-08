import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY, BUCKET } from "./sb-config.js";

const ROOM = "1010";                 // 固定房间
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const $ = s => document.querySelector(s);
const log = $("#log"), viewer=$("#viewer"), vImg=$("#viewer img");
const toast = (t)=>{ const el=$("#toast"); el.textContent=t; el.classList.add("show"); setTimeout(()=>el.classList.remove("show"),1200); };

const myId = (()=>{ const k="client_id_web_b"; let v=localStorage.getItem(k); if(!v){v=crypto.randomUUID();localStorage.setItem(k,v);} return v;})();

let imageMode = "only-peer";
function needTimeDivider(last, cur){ return cur-last>5*60*1000; }
let lastT = 0;

function addTimeDivider(createdAt){
  const d=document.createElement("div");
  d.style.cssText="align-self:center;color:#7f8a98;font-size:12px;padding:4px 10px;border:1px solid var(--line);border-radius:999px;opacity:.9;margin:6px 0 2px";
  d.textContent = new Date(createdAt).toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit"});
  log.appendChild(d);
}

function render(m, history=false){
  const t = new Date(m.created_at||Date.now()).getTime();
  if(needTimeDivider(lastT,t)) addTimeDivider(m.created_at||new Date().toISOString());
  lastT = t;

  const row = document.createElement("div");
  row.className = "row " + (m.author_id===myId? "self":"peer");

  const bubble = document.createElement("div");
  bubble.className = "msg";

  if(m.type==="image"){
    const a=document.createElement("a"); a.href=m.content; a.onclick=e=>{e.preventDefault(); vImg.src=a.href; viewer.style.display='flex';};
    const img=document.createElement("img"); img.src=m.content; a.appendChild(img);
    const mine = (m.author_id===myId);
    const large = imageMode==="all-large" || (imageMode==="only-peer" && !mine);
    if(large) bubble.classList.add("enlarge");
    bubble.appendChild(a);
  }else{
    const p=document.createElement("p"); p.textContent=m.content; bubble.appendChild(p);
  }
  row.appendChild(bubble); log.appendChild(row);
  if(!history) log.scrollTop=log.scrollHeight;
}

async function loadHistory(){
  const { data, error } = await supabase.from("messages")
    .select("*").eq("room_id", ROOM)
    .order("created_at",{ascending:true}).limit(500);
  if(error){ alert(error.message); return; }
  log.innerHTML=""; lastT=0; data.forEach(m=>render(m,true));
}
function subRealtime(){
  supabase.channel("room:"+ROOM)
    .on("postgres_changes",{event:"INSERT",schema:"public",table:"messages",filter:`room_id=eq.${ROOM}`}, (payload)=> render(payload.new))
    .subscribe();
}
loadHistory(); subRealtime();

/* 发送文字 */
$("#send").onclick = async ()=>{
  const v=$("#text").value.trim(); if(!v) return;
  $("#text").value="";
  const { error } = await supabase.from("messages").insert({ room_id:ROOM, author_id:myId, type:"text", content:v });
  if(error) alert(error.message);
};
$("#text").addEventListener("keydown", e=>{ if(e.key==="Enter") $("#send").click(); });

/* 图片模式切换 */
document.querySelector(".seg").addEventListener("click", e=>{
  const btn=e.target.closest("button"); if(!btn) return;
  imageMode = btn.dataset.mode;
  document.querySelectorAll(".msg").forEach(b=>b.classList.remove("enlarge"));
  document.querySelectorAll(".row").forEach(row=>{
    const mine=row.classList.contains("self"); const has=row.querySelector("img");
    if(!has) return;
    const large = imageMode==="all-large" || (imageMode==="only-peer" && !mine);
    if(large) row.querySelector(".msg").classList.add("enlarge");
  });
});

/* 相册上传 */
$("#pick").onclick = ()=> $("#file").click();
$("#file").onchange = async ()=>{
  const f=$("#file").files[0]; if(!f) return;
  const path=`${ROOM}/${Date.now()}-${f.name}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, f, { upsert:false });
  if(error) return alert(error.message);
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  await supabase.from("messages").insert({ room_id:ROOM, author_id:myId, type:"image", content:data.publicUrl });
};

/* 摄像头拍照上传（默认后置，iOS 旧机型可能只支持前置） */
let stream=null;
$("#openCam").onclick = async ()=>{
  try{
    stream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode:{ ideal:"environment" } }, audio:false });
    $("#cam").srcObject=stream; await $("#cam").play(); toast("相机已开启");
  }catch(e){ alert("相机失败："+e.message); }
};
$("#closeCam").onclick = ()=>{ if(stream){ stream.getTracks().forEach(t=>t.stop()); stream=null; toast("相机已关闭"); } };
$("#shot").onclick = async ()=>{
  if(!stream) return alert("请先打开相机");
  const video=$("#cam"); const c=document.createElement("canvas");
  c.width = video.videoWidth||1280; c.height = video.videoHeight||720;
  c.getContext("2d").drawImage(video,0,0,c.width,c.height);
  const blob = await new Promise(r=>c.toBlob(r,"image/jpeg",0.9));
  const path=`${ROOM}/${Date.now()}-${Math.random().toString(16).slice(2)}.jpg`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType:"image/jpeg", upsert:false });
  if(error) return alert(error.message);
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  await supabase.from("messages").insert({ room_id:ROOM, author_id:myId, type:"image", content:data.publicUrl });
  toast("已拍照并发送");
};

/* 预览关闭 */
viewer.addEventListener("click", ()=> viewer.style.display='none');
