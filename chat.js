// chat.js —— 后置优先 + 枚举切换 + 稳定拍照/关闭

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY, BUCKET } from "./sb-config.js";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ===== 基础 DOM / 状态 ===== */
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

/* ===== 工具 ===== */
const tts = t => { if (!$("#ttsToggle")?.checked) return; try{ const u=new SpeechSynthesisUtterance(t); u.lang="zh-CN"; speechSynthesis.speak(u);}catch{} };
const toast = t => { if(!toastEl) return; toastEl.textContent=t; toastEl.classList.add("show"); setTimeout(()=>toastEl.classList.remove("show"),1200); };

/* ===== 渲染 ===== */
function needDivider(at){ const t=new Date(at).getTime(); if(t-lastDividerTime>5*60*1000){ lastDividerTime=t; return true;} return false; }
function addDivider(at){ const d=document.createElement("div"); d.className="time-divider"; d.textContent=new Date(at).toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit"}); log.appendChild(d); }
function renderOne(m,isHis=false){
  if(needDivider(m.created_at)) addDivider(m.created_at);
  const row=document.createElement("div"); row.className="row "+(m.author_id===myId?"self":"peer");
  const b=document.createElement("div"); b.className="msg";
  if(m.type==="image"){
    const a=document.createElement("a"); a.href=m.content; a.onclick=e=>{e.preventDefault(); viewerImg.src=a.href; viewer.classList.add("show");};
    const img=document.createElement("img"); img.src=m.content; a.appendChild(img);
    const mine=m.author_id===myId;
    const large=imageMode==="all-large"||(imageMode==="only-peer"&&!mine);
    if(large) b.classList.add("enlarge");
    b.appendChild(a);
  }else{
    const p=document.createElement("p"); p.textContent=m.content; b.appendChild(p);
  }
  row.appendChild(b); log.appendChild(row);
  if(!isHis) log.scrollTop=log.scrollHeight;
  if(m.type==="text" && m.author_id!==myId) tts(m.content);
}

/* ===== 历史/实时 ===== */
async function loadHistory(){
  const {data,error}=await supabase.from("messages").select("*").eq("room_id",roomId).order("created_at",{ascending:true}).limit(500);
  if(error){ alert(error.message); return; }
  log.innerHTML=""; lastDividerTime=0; data.forEach(m=>renderOne(m,true));
}
function subRealtime(){
  if(dbChannel) supabase.removeChannel(dbChannel);
  dbChannel=supabase.channel("room:"+roomId).on("postgres_changes",
    {event:"INSERT",schema:"public",table:"messages",filter:`room_id=eq.${roomId}`},
    payload=>renderOne(payload.new)
  ).subscribe();
}

/* ===== 房间 ===== */
$("#join").onclick=async ()=>{
  roomId=$("#room").value.trim()||crypto.randomUUID().slice(0,8);
  const url=new URL(location.href); url.searchParams.set("room",roomId); history.replaceState(null,"",url);
  await loadHistory(); subRealtime();
};
if(roomId){ loadHistory(); subRealtime(); }

/* ===== 文字 ===== */
$("#send").onclick=async ()=>{
  const v=$("#text").value.trim(); if(!v) return;
  $("#text").value="";
  await supabase.from("messages").insert({room_id:roomId,author_id:myId,type:"text",content:v});
};
$("#text").addEventListener("keydown",e=>{ if(e.key==="Enter") $("#send").click(); });

/* ===== 图片模式 ===== */
$("#modeSeg").addEventListener("click",e=>{
  const btn=e.target.closest("button"); if(!btn) return;
  [...$("#modeSeg").children].forEach(b=>b.classList.remove("active"));
  btn.classList.add("active"); imageMode=btn.dataset.mode;
  log.querySelectorAll(".row").forEach(row=>{
    const mine=row.classList.contains("self");
    const bubble=row.querySelector(".msg");
    const hasImg=!!row.querySelector("img");
    bubble.classList.remove("enlarge");
    if(!hasImg) return;
    const large=imageMode==="all-large"||(imageMode==="only-peer"&&!mine);
    if(large) bubble.classList.add("enlarge");
  });
});

/* ===== + 面板 ===== */
const sheet=$("#sheet"), mask=$("#sheetMask");
const openSheet=()=>{sheet.classList.add("show"); mask.classList.add("show");};
const closeSheet=()=>{sheet.classList.remove("show"); mask.classList.remove("show");};
$("#plusBtn").onclick=openSheet; mask.onclick=closeSheet;

const templates=["[状态] 我已到达","[状态] 我已离开","[表单] 姓名=；数量=；备注=","[系统] 我已拍照并上传"];
$("#sheetTemplate").onclick=()=>{ closeSheet(); const label="选择模板（数字）：\n"+templates.map((t,i)=>`${i+1}. ${t}`).join("\n"); const idx=Number(prompt(label,"1")); if(Number.isFinite(idx)&&idx>=1&&idx<=templates.length){ supabase.from("messages").insert({room_id:roomId,author_id:myId,type:"text",content:templates[idx-1]}); } };
$("#sheetUpload").onclick=()=>{
  closeSheet();
  const input=document.createElement("input"); input.type="file"; input.accept="image/*";
  input.onchange=async ()=>{ const f=input.files?.[0]; if(!f) return; const path=`${roomId}/${Date.now()}-${f.name}`; const {error}=await supabase.storage.from(BUCKET).upload(path,f,{upsert:false}); if(error) return alert(error.message); const {data}=supabase.storage.from(BUCKET).getPublicUrl(path); await supabase.from("messages").insert({room_id:roomId,author_id:myId,type:"image",content:data.publicUrl}); };
  input.click();
};
$("#sheetCamera").onclick=()=>{ closeSheet(); openCamFull(); };
$("#sheetMode").onclick=()=>{ closeSheet(); $("#modeSeg button")[1]?.click(); };

viewer.addEventListener("click",()=> viewer.classList.remove("show"));

/* ===== 相机：后置优先 + 切换 ===== */
const cam = {
  pane: $("#camPane"),
  video: $("#camView"),
  stream: null,
  list: [],      // 可用摄像头列表
  idx: 0         // 当前使用的 index
};

// 在相机面板里动态加一个“切换镜头”按钮（如果还没有的话）
(function ensureSwitchBtn(){
  const bar = document.querySelector(".cam-controls");
  if (bar && !$("#switchCamBtn")) {
    const btn = document.createElement("button");
    btn.id = "switchCamBtn";
    btn.className = "cam-btn"; btn.textContent = "切换镜头";
    bar.insertBefore(btn, $("#closeCamBtn"));
    btn.addEventListener("click", switchCamera);
  }
})();

async function getCameraListAfterGrant(){
  try { 
    // 先请求一次权限（iOS 不授权读不到 label）
    await navigator.mediaDevices.getUserMedia({video:true, audio:false});
  } catch(e) {
    console.log("预授权失败：", e);
  }
  const devs = await navigator.mediaDevices.enumerateDevices().catch(()=>[]);
  const cams = devs.filter(d=>d.kind==="videoinput");
  console.log("摄像头枚举：", cams.map(c=>({id:c.deviceId, label:c.label})));
  return cams;
}

function guessRearIndex(cams){
  const rx = /(back|rear|environment|后置|背面)/i;
  const i = cams.findIndex(c=>rx.test(c.label||""));
  return i>=0 ? i : 0;
}

async function openByIndex(i){
  // 关闭旧的
  if (cam.stream){ cam.stream.getTracks().forEach(t=>t.stop()); cam.stream=null; }
  try{
    const dev = cam.list[i];
    let constraints;
    if (dev) {
      constraints = { video: { deviceId: { exact: dev.deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio:false };
    } else {
      // 兜底：后置理想
      constraints = { video: { facingMode: { ideal:"environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio:false };
    }
    const s = await navigator.mediaDevices.getUserMedia(constraints);
    cam.stream = s;
    cam.video.srcObject = s;
    cam.video.style.transform = "none"; // 不镜像
    await cam.video.play();
    cam.idx = i;
    toast(dev?.label ? `已开启：${dev.label}` : "已开启相机");
  }catch(e){
    console.error("打开相机失败：", e);
    toast("相机打开失败");
  }
}

async function openCamFull(){
  cam.pane.classList.add("show");
  cam.list = await getCameraListAfterGrant();
  if (cam.list.length === 0) {
    // 没有 label/没有多摄像头，直接用后置理想
    await openByIndex(-1);
  } else {
    const rear = guessRearIndex(cam.list);
    await openByIndex(rear);
  }
}

function closeCam(){
  if (cam.stream){ cam.stream.getTracks().forEach(t=>t.stop()); cam.stream=null; }
  try{ cam.video.pause(); }catch{}
  cam.video.srcObject = null;
  cam.pane.classList.remove("show");
  toast("已关闭相机");
}

async function switchCamera(){
  if (!cam.list.length) { cam.list = await getCameraListAfterGrant(); }
  if (!cam.list.length) { toast("无可切换的摄像头"); return; }
  const next = (Number.isInteger(cam.idx) ? cam.idx+1 : 1) % cam.list.length;
  await openByIndex(next);
}

async function shootAndUpload(){
  if (!cam.stream) { toast("请先开启相机"); return; }
  const track = cam.stream.getVideoTracks()[0];
  let blob = null;

  // 优先 ImageCapture
  try{
    if (window.ImageCapture && track) {
      const ic = new ImageCapture(track);
      blob = await ic.takePhoto();
    }
  }catch(e){ console.log("ImageCapture 失败，改用 canvas", e); blob = null; }

  // 退回 canvas
  if (!blob) {
    const v = cam.video;
    if (v.readyState < 2) { try{ await v.play(); }catch{} }
    const w = v.videoWidth || 1280;
    const h = v.videoHeight || 720;
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    c.getContext("2d").drawImage(v,0,0,w,h);
    blob = await new Promise(res=> c.toBlob(res, "image/jpeg", 0.9));
  }

  if (!blob) { toast("拍照失败"); return; }

  const path = `${roomId}/${Date.now()}-${Math.random().toString(16).slice(2)}.jpg`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType:"image/jpeg", upsert:false });
  if (error) { alert("上传失败："+error.message); return; }
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  await supabase.from("messages").insert({ room_id:roomId, author_id:myId, type:"image", content:data.publicUrl });
  toast("已拍照并上传");
}

/* 绑定 */
$("#openCam")?.addEventListener("click", openCamFull);
$("#shot")?.addEventListener("click", shootAndUpload);
$("#closeCam")?.addEventListener("click", closeCam);
$("#shootBtn")?.addEventListener("click", shootAndUpload);
$("#closeCamBtn")?.addEventListener("click", closeCam);

/* 页面隐藏时释放摄像头 */
document.addEventListener("visibilitychange", ()=>{ if (document.hidden) closeCam(); });

/* 图片预览 */
log.addEventListener("click", e=>{
  const a=e.target.closest(".msg a"); if(!a) return;
  e.preventDefault(); viewerImg.src=a.href; viewer.classList.add("show");
});
