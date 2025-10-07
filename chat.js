// chat.js —— 相机：后置优先 / 可拍照 / 可关闭 / 前置不镜像

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY, BUCKET } from "./sb-config.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ========== DOM & 状态 ========== */
const $ = s => document.querySelector(s);
const log = $("#log");
const viewer = $("#viewer");
const viewerImg = $("#viewer img");
const toastEl = $("#toast");

let roomId = new URL(location.href).searchParams.get("room") || "";
if (roomId) $("#room").value = roomId;

const myId = (() => {
  const k = "client_id";
  let v = localStorage.getItem(k);
  if (!v) { v = crypto.randomUUID(); localStorage.setItem(k, v); }
  return v;
})();

let imageMode = "only-peer";
let dbChannel = null;
let lastDividerTime = 0;

/* ========== 工具 ========== */
const speak = t => {
  if (!$("#ttsToggle")?.checked) return;
  try { const u = new SpeechSynthesisUtterance(t); u.lang="zh-CN"; speechSynthesis.speak(u);} catch{}
};
const showToast = t => { if(!toastEl) return; toastEl.textContent=t; toastEl.classList.add("show"); setTimeout(()=>toastEl.classList.remove("show"),1200); };

/* ========== 渲染 ========== */
function needTimeDivider(createdAt){
  const t = new Date(createdAt).getTime();
  if (t - lastDividerTime > 5*60*1000){ lastDividerTime=t; return true; }
  return false;
}
function addTimeDivider(createdAt){
  const d = document.createElement("div");
  d.className="time-divider";
  d.textContent=new Date(createdAt).toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit"});
  log.appendChild(d);
}
function renderOne(m, isHistory=false){
  if (needTimeDivider(m.created_at)) addTimeDivider(m.created_at);
  const row = document.createElement("div");
  row.className = "row " + (m.author_id===myId?"self":"peer");
  const bubble = document.createElement("div"); bubble.className="msg";

  if (m.type==="image"){
    const a=document.createElement("a"); a.href=m.content; a.onclick=e=>{e.preventDefault(); viewerImg.src=a.href; viewer.classList.add("show");};
    const img=document.createElement("img"); img.src=m.content; a.appendChild(img);
    const mine=(m.author_id===myId);
    const shouldLarge=imageMode==="all-large"||(imageMode==="only-peer"&&!mine);
    if(shouldLarge) bubble.classList.add("enlarge");
    bubble.appendChild(a);
  }else{
    const p=document.createElement("p"); p.textContent=m.content; bubble.appendChild(p);
  }
  row.appendChild(bubble); log.appendChild(row);
  if(!isHistory) log.scrollTop=log.scrollHeight;
  if(m.type==="text" && m.author_id!==myId) speak(m.content);
}

/* ========== 历史 & 实时 ========== */
async function loadHistory(){
  const {data,error}=await supabase.from("messages").select("*").eq("room_id",roomId).order("created_at",{ascending:true}).limit(500);
  if(error){ alert(error.message); return; }
  log.innerHTML=""; lastDividerTime=0; data.forEach(m=>renderOne(m,true));
}
function subRealtime(){
  if(dbChannel) supabase.removeChannel(dbChannel);
  dbChannel = supabase.channel("room:"+roomId).on("postgres_changes",
    {event:"INSERT",schema:"public",table:"messages",filter:`room_id=eq.${roomId}`},
    payload=>renderOne(payload.new)
  ).subscribe();
}

/* ========== 房间 ========== */
$("#join").onclick = async ()=>{
  roomId = $("#room").value.trim() || crypto.randomUUID().slice(0,8);
  const url=new URL(location.href); url.searchParams.set("room",roomId); history.replaceState(null,"",url);
  await loadHistory(); subRealtime();
};
if(roomId){ loadHistory(); subRealtime(); }

/* ========== 发送文本 ========== */
$("#send").onclick = async ()=>{
  const v=$("#text").value.trim(); if(!v) return;
  $("#text").value="";
  await supabase.from("messages").insert({ room_id:roomId, author_id:myId, type:"text", content:v });
};
$("#text").addEventListener("keydown",e=>{ if(e.key==="Enter") $("#send").click(); });

/* ========== 图片模式切换 ========== */
$("#modeSeg").addEventListener("click", e=>{
  const btn=e.target.closest("button"); if(!btn) return;
  [...$("#modeSeg").children].forEach(b=>b.classList.remove("active"));
  btn.classList.add("active");
  imageMode=btn.dataset.mode;
  log.querySelectorAll(".row").forEach(row=>{
    const mine=row.classList.contains("self");
    const bubble=row.querySelector(".msg");
    const hasImg=!!row.querySelector("img");
    bubble.classList.remove("enlarge");
    if(!hasImg) return;
    const shouldLarge=imageMode==="all-large"||(imageMode==="only-peer"&&!mine);
    if(shouldLarge) bubble.classList.add("enlarge");
  });
});

/* ========== “更多”抽屉 ========== */
const sheet=$("#sheet"), mask=$("#sheetMask");
const openSheet=()=>{sheet.classList.add("show"); mask.classList.add("show");};
const closeSheet=()=>{sheet.classList.remove("show"); mask.classList.remove("show");};
$("#plusBtn").onclick=openSheet; mask.onclick=closeSheet;

const templates=["[状态] 我已到达","[状态] 我已离开","[表单] 姓名=；数量=；备注=","[系统] 我已拍照并上传"];
$("#sheetTemplate").onclick=()=>{
  closeSheet();
  const label="选择模板（输入编号）：\n"+templates.map((t,i)=>`${i+1}. ${t}`).join("\n");
  const idx=Number(prompt(label,"1"));
  if(Number.isFinite(idx)&&idx>=1&&idx<=templates.length){
    supabase.from("messages").insert({room_id:roomId,author_id:myId,type:"text",content:templates[idx-1]});
  }
};
$("#sheetUpload").onclick=()=>{
  closeSheet();
  const input=document.createElement("input"); input.type="file"; input.accept="image/*";
  input.onchange=async ()=>{
    const f=input.files?.[0]; if(!f) return;
    const path=`${roomId}/${Date.now()}-${f.name}`;
    const {error}=await supabase.storage.from(BUCKET).upload(path,f,{upsert:false});
    if(error) return alert(error.message);
    const {data}=supabase.storage.from(BUCKET).getPublicUrl(path);
    await supabase.from("messages").insert({room_id:roomId,author_id:myId,type:"image",content:data.publicUrl});
  };
  input.click();
};
$("#sheetCamera").onclick=()=>{ closeSheet(); openCamFull(); };
$("#sheetMode").onclick = ()=>{ closeSheet(); $("#modeSeg button")[1]?.click(); };

viewer.addEventListener("click",()=> viewer.classList.remove("show"));

/* ========== 相机（后置优先 / 拍照 / 关闭） ========== */
const cam = {
  stream:null, opening:false,
  pane: $("#camPane"),
  video: $("#camView")  // HTML 里 <video id="camView" playsinline muted></video>
};

// 先要一次权限，再枚举设备找“后置”
async function openRearStream() {
  // 请求一次最宽松的权限，iOS 不给权限时 enumerateDevices 读不到 label
  try { await navigator.mediaDevices.getUserMedia({video:true, audio:false}); } catch {}
  const devs = await navigator.mediaDevices.enumerateDevices().catch(()=>[]);
  const cams = devs.filter(d=>d.kind==="videoinput");
  // 关键：匹配 “后置/背面/Back/Rear/Environment”
  const rx = /(back|rear|environment|后置|背面)/i;
  const rear = cams.find(d=>rx.test(d.label));
  if (rear) {
    return await navigator.mediaDevices.getUserMedia({ video:{ deviceId:{ exact: rear.deviceId } }, audio:false });
  }
  // 没标识就用 facingMode 试后置
  return await navigator.mediaDevices.getUserMedia({ video:{ facingMode:{ ideal:"environment" } }, audio:false });
}

async function openAnyStream() {
  return await navigator.mediaDevices.getUserMedia({ video:true, audio:false });
}

async function openCamFull(){
  if (cam.opening) return;
  cam.opening = true;
  let stream = null;
  try {
    stream = await openRearStream();
  } catch {}
  if (!stream) {
    try { stream = await openAnyStream(); } catch {}
  }
  cam.opening = false;

  if (!stream) { showToast("相机权限失败"); return; }

  // 设置预览
  cam.stream = stream;
  cam.video.srcObject = stream;
  // 不要镜像（前置通常会镜像，统一取消）
  cam.video.style.transform = "none";
  cam.pane.classList.add("show");
  try { await cam.video.play(); } catch {}
  showToast("已开启相机");
}

function closeCam(){
  if (cam.stream) {
    cam.stream.getTracks().forEach(t=>t.stop());
    cam.stream = null;
  }
  try { cam.video.pause(); } catch{}
  cam.video.srcObject = null;
  cam.pane.classList.remove("show");
  showToast("已关闭相机");
}

async function shootAndUpload(){
  if (!cam.stream) { showToast("请先开启相机"); return; }

  const track = cam.stream.getVideoTracks()[0];
  let blob = null;

  // 尝试 ImageCapture（有则画质更好）
  try {
    const ImageCaptureCtor = window.ImageCapture;
    if (ImageCaptureCtor && track) {
      const ic = new ImageCaptureCtor(track);
      blob = await ic.takePhoto();
    }
  } catch { blob = null; }

  // 退回 canvas 抓帧
  if (!blob) {
    const v = cam.video;
    if (v.readyState < 2) { try{ await v.play(); }catch{} }
    const w = v.videoWidth || 1280;
    const h = v.videoHeight || 720;
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    c.getContext("2d").drawImage(v,0,0,w,h);
    blob = await new Promise(res=> c.toBlob(res,"image/jpeg",0.9));
  }

  if (!blob) { showToast("拍照失败"); return; }

  const path = `${roomId}/${Date.now()}-${Math.random().toString(16).slice(2)}.jpg`;
  const { error:upErr } = await supabase.storage.from(BUCKET).upload(path, blob, {
    contentType:"image/jpeg", upsert:false
  });
  if (upErr) { alert("上传失败："+upErr.message); return; }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  await supabase.from("messages").insert({ room_id:roomId, author_id:myId, type:"image", content:data.publicUrl });
  showToast("已拍照并上传");
}

/* 绑定两套按钮 */
$("#openCam")?.addEventListener("click", openCamFull);
$("#shot")?.addEventListener("click", shootAndUpload);
$("#closeCam")?.addEventListener("click", closeCam);
$("#shootBtn")?.addEventListener("click", shootAndUpload);
$("#closeCamBtn")?.addEventListener("click", closeCam);

/* 防止页面隐藏还占用摄像头 */
document.addEventListener("visibilitychange", ()=>{ if (document.hidden) closeCam(); });

/* 图片点击预览 */
log.addEventListener("click", e=>{
  const a=e.target.closest(".msg a"); if(!a) return;
  e.preventDefault(); viewerImg.src=a.href; viewer.classList.add("show");
});
