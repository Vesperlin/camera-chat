import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY, BUCKET } from "./sb-config.js";

/* ====== 基本配置 ====== */
const ROOM_ID = "1010";
const ROLE = "B";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ====== DOM ====== */
const $ = s => document.querySelector(s);
const log = $("#log");
const viewer = $("#viewer");
const viewerImg = $("#viewer img");

/* ====== 身份 ====== */
const myId = (() => {
  const k = "client_id";
  let v = localStorage.getItem(k);
  if (!v) { v = crypto.randomUUID(); localStorage.setItem(k, v); }
  return v;
})();

/* ====== 渲染 ====== */
function addRow(m){
  const row = document.createElement("div");
  row.className = "row " + (m.author_id===myId?"self":"peer");
  const bubble = document.createElement("div"); bubble.className = "msg";
  if (m.type==="image"){
    const a = document.createElement("a");
    a.href = m.content;
    a.onclick = e=>{ e.preventDefault(); viewerImg.src = a.href; viewer.classList.add("show"); };
    const img = document.createElement("img"); img.src = m.content; a.appendChild(img);
    bubble.classList.add("enlarge"); bubble.appendChild(a);
  }else{
    const p = document.createElement("p"); p.textContent = m.content; bubble.appendChild(p);
  }
  row.appendChild(bubble); log.appendChild(row); log.scrollTop = log.scrollHeight;
}

/* ====== 历史 + 实时 ====== */
async function loadHistory(){
  const { data, error } = await supabase.from("messages").select("*")
    .eq("room_id", ROOM_ID).order("created_at",{ascending:true}).limit(500);
  if (error){ alert(error.message); return; }
  log.innerHTML = ""; data.forEach(addRow);
}
function subRealtime(){
  supabase.channel("room:"+ROOM_ID)
    .on("postgres_changes",{event:"INSERT", schema:"public", table:"messages", filter:`room_id=eq.${ROOM_ID}`},
      payload => addRow(payload.new))
    .subscribe();
}
await loadHistory(); subRealtime();
viewer.addEventListener("click", ()=> viewer.classList.remove("show"));

/* ====== 上传（通用） ====== */
async function uploadBlobToSupabase(blob){
  const path = `${ROOM_ID}/${Date.now()}-${Math.random().toString(16).slice(2)}.jpg`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
    contentType:"image/jpeg", upsert:false
  });
  if (error) throw error;
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  const url = data.publicUrl;
  const { error: e2 } = await supabase.from("messages").insert({
    room_id: ROOM_ID, author_id: myId, type: "image", content: url
  });
  if (e2) throw e2;
  return url;
}

/* ====== 相册上传按钮 ====== */
$("#pickBtn").addEventListener("click", ()=>{
  const input = document.createElement("input");
  input.type="file"; input.accept="image/*";
  input.onchange = async ()=>{
    const f = input.files[0]; if(!f) return;
    try{ await uploadBlobToSupabase(f); }catch(e){ alert(e.message); }
  };
  input.click();
});

/* ====== 相机：打开/关闭/切换/拍照 ====== */
let stream = null;
let usingFacing = "environment"; // 默认后置
const camPane = $("#camPane");
const camView = $("#camView");
const lastThumb = $("#lastThumb");

async function getStream(facing) {
  const strict = { video: { facingMode: { exact: facing } }, audio:false };
  const loose  = { video: { facingMode: facing }, audio:false };
  try { return await navigator.mediaDevices.getUserMedia(strict); }
  catch { return await navigator.mediaDevices.getUserMedia(loose); }
}
async function openCam(){
  try{
    camPane.style.display = "block";
    if (stream){ stream.getTracks().forEach(t=>t.stop()); stream=null; }
    stream = await getStream(usingFacing);
    camView.srcObject = stream;
    await camView.play();
    camView.style.transform = (usingFacing==="user")? "scaleX(-1)" : "none";
  }catch(e){
    camPane.style.display = "none";
    alert("相机打开失败："+e.message);
  }
}
function closeCam(){
  if (stream){ stream.getTracks().forEach(t=>t.stop()); stream=null; }
  camView.srcObject = null; camPane.style.display="none";
}
async function flipCam(){
  usingFacing = (usingFacing==="environment")? "user":"environment";
  await openCam();
}
async function shootAndUpload(){
  if (!stream || !camView.videoWidth){ alert("相机未就绪"); return; }
  const w = camView.videoWidth, h = camView.videoHeight;
  const c=document.createElement("canvas"); c.width=w; c.height=h;
  const ctx=c.getContext("2d");
  if(usingFacing==="user"){ ctx.translate(w,0); ctx.scale(-1,1); }
  ctx.drawImage(camView,0,0,w,h);
  const blob = await new Promise(r=> c.toBlob(r,"image/jpeg",0.92));
  try{
    await uploadBlobToSupabase(blob);
    lastThumb.src = URL.createObjectURL(blob);
    lastThumb.style.display = "block";
    setTimeout(()=> lastThumb.style.display="none", 3000);
  }catch(e){ alert("上传失败："+e.message); }
}

$("#openCamBtn").addEventListener("click", openCam);
$("#closeCamBtn").addEventListener("click", closeCam);
$("#flipBtn").addEventListener("click", flipCam);
$("#shootBtn").addEventListener("click", shootAndUpload);

/* ====== 列表点击大图预览 ====== */
log.addEventListener("click", e=>{
  const a = e.target.closest(".msg a"); if(!a) return;
  e.preventDefault(); viewerImg.src = a.href; viewer.classList.add("show");
});
