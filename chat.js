// chat.js —— 实时显示图片（去重）、全屏左右切换、角色(A/B)开关

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY, BUCKET } from "./sb-config.js";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ===== DOM & 状态 ===== */
const $ = s => document.querySelector(s);
const log = $("#log");
const viewer = $("#viewer");
const viewerImg = $("#viewer img");
const toastEl = $("#toast");

let roomId = new URL(location.href).searchParams.get("room") || "";
if (roomId) $("#room").value = roomId;

const role = (new URL(location.href)).searchParams.get("role") || "A"; // A/B
const myId = (() => {
  const k = "client_id";
  let v = localStorage.getItem(k);
  if (!v) { v = crypto.randomUUID(); localStorage.setItem(k, v); }
  return v;
})();

let imageMode = "only-peer"; // only-peer | all-small | all-large
let dbChannel = null;
let lastDividerTime = 0;

/* 最近我自己发过的内容（去重用） */
const recentSent = new Map(); // key=content, val=ts

/* 画廊（全屏切图） */
const gallery = []; // {url, mine}
let currentIndex = -1;

/* ===== 工具 ===== */
const tts = t => {
  if (!$("#ttsToggle")?.checked) return;
  try {
    const u = new SpeechSynthesisUtterance(t);
    u.lang = "zh-CN"; speechSynthesis.speak(u);
  } catch {}
};
const toast = t => { if(!toastEl) return; toastEl.textContent=t; toastEl.classList.add("show"); setTimeout(()=>toastEl.classList.remove("show"),1200); };
const isImg = s => /^https?:\/\/.+\.(jpg|jpeg|png|webp|gif)(\?.*)?$/i.test(s);

/* ===== 角色 UI ===== */
function applyRole(){
  if (role === "B"){
    // 隐藏 TTS
    const label = document.querySelector('label.chk'); // 顶部“朗读对方”所在label
    label && (label.style.display = "none");
  }
  // 其他 A/B 功能暂同；C 端远控需扩表后做
}
applyRole();

/* ===== 渲染 ===== */
function needTimeDivider(createdAt){
  const t = new Date(createdAt).getTime();
  if (t - lastDividerTime > 5*60*1000){ lastDividerTime = t; return true; }
  return false;
}
function addTimeDivider(createdAt){
  const d = document.createElement("div");
  d.className = "time-divider";
  d.textContent = new Date(createdAt).toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit"});
  log.appendChild(d);
}

/* 将图片加入画廊并标号 */
function pushToGallery(url, mine){
  const idx = gallery.push({ url, mine }) - 1;
  return idx; // 返回索引用于<a>标记
}

function renderOne(m, isHistory=false){
  // 去重：如果是我自己刚发的、内容一致，且 3 秒内，就不再渲染（避免乐观渲染 + 实时回显重复）
  if (m.author_id === myId && recentSent.has(m.content)) {
    const ts = recentSent.get(m.content);
    if (Date.now() - ts < 3000) {
      // 已经显示过了，这条跳过
      recentSent.delete(m.content);
      return;
    } else {
      recentSent.delete(m.content);
    }
  }

  if (needTimeDivider(m.created_at)) addTimeDivider(m.created_at);

  const row = document.createElement("div");
  row.className = "row " + (m.author_id===myId ? "self":"peer");

  const bubble = document.createElement("div");
  bubble.className = "msg";

  if (m.type === "image" || isImg(m.content)) {
    const a = document.createElement("a");
    a.href = m.content;

    const mine = (m.author_id===myId);
    const idx = pushToGallery(m.content, mine);
    a.dataset.idx = String(idx);

    a.onclick = e => {
      e.preventDefault();
      openViewer(idx);
    };

    const img = document.createElement("img"); img.src = m.content; a.appendChild(img);

    const shouldLarge = imageMode==="all-large" || (imageMode==="only-peer" && !mine);
    if (shouldLarge) bubble.classList.add("enlarge");
    bubble.appendChild(a);
  } else {
    const p = document.createElement("p"); p.textContent = m.content; bubble.appendChild(p);
  }

  row.appendChild(bubble);
  log.appendChild(row);
  if (!isHistory) log.scrollTop = log.scrollHeight;

  if (m.type!=="image" && m.author_id!==myId) tts(m.content);
}

/* ===== 历史 & 实时 ===== */
async function loadHistory(){
  const { data, error } = await supabase.from("messages")
    .select("*").eq("room_id", roomId)
    .order("created_at",{ascending:true}).limit(500);
  if (error) { alert(error.message); return; }
  log.innerHTML = ""; lastDividerTime = 0;
  gallery.length = 0; // 重建画廊
  data.forEach(m=>renderOne(m, true));
}
function subRealtime(){
  if (dbChannel) supabase.removeChannel(dbChannel);
  dbChannel = supabase
    .channel("room:"+roomId)
    .on("postgres_changes",
      { event:"INSERT", schema:"public", table:"messages", filter:`room_id=eq.${roomId}` },
      payload => renderOne(payload.new)
    ).subscribe();
}

/* ===== 房间 ===== */
$("#join").onclick = async () => {
  roomId = $("#room").value.trim() || crypto.randomUUID().slice(0,8);
  const url = new URL(location.href); url.searchParams.set("room", roomId); history.replaceState(null,"",url);
  await loadHistory(); subRealtime();
};
if (roomId) { loadHistory(); subRealtime(); }

/* ===== 发送文字（乐观渲染 + 去重） ===== */
$("#send").onclick = async ()=>{
  const v = $("#text").value.trim(); if(!v) return;
  $("#text").value = "";
  const pending = {
    room_id: roomId, author_id: myId, type:"text", content:v,
    created_at: new Date().toISOString()
  };
  recentSent.set(v, Date.now());
  renderOne(pending); // 先显示
  await supabase.from("messages").insert({ room_id: roomId, author_id: myId, type:"text", content:v });
};
$("#text").addEventListener("keydown", e=>{ if(e.key==="Enter") $("#send").click(); });

/* ===== 图片模式切换 ===== */
$("#modeSeg").addEventListener("click", e=>{
  const btn = e.target.closest("button"); if(!btn) return;
  [...$("#modeSeg").children].forEach(b=>b.classList.remove("active"));
  btn.classList.add("active");
  imageMode = btn.dataset.mode;

  // 重新应用
  log.querySelectorAll(".row").forEach(row=>{
    const mine = row.classList.contains("self");
    const bubble = row.querySelector(".msg");
    const hasImg = !!row.querySelector("img");
    bubble.classList.remove("enlarge");
    if (!hasImg) return;
    const shouldLarge = imageMode==="all-large" || (imageMode==="only-peer" && !mine);
    if (shouldLarge) bubble.classList.add("enlarge");
  });
});

/* ===== “更多”抽屉 ===== */
const sheet = $("#sheet"), mask = $("#sheetMask");
const openSheet = ()=>{ sheet.classList.add("show"); mask.classList.add("show"); }
const closeSheet = ()=>{ sheet.classList.remove("show"); mask.classList.remove("show"); }
$("#plusBtn").onclick = openSheet; mask.onclick = closeSheet;

/* 模板 */
const templates = [
  "[状态] 我已到达",
  "[状态] 我已离开",
  "[表单] 姓名=；数量=；备注=",
  "[系统] 我已拍照并上传"
];
$("#sheetTemplate").onclick = ()=>{
  closeSheet();
  const label = "选择模板（输入编号）：\n" + templates.map((t,i)=>`${i+1}. ${t}`).join("\n");
  const idx = Number(prompt(label,"1"));
  if(Number.isFinite(idx) && idx>=1 && idx<=templates.length){
    const v = templates[idx-1];
    const pending = { room_id:roomId, author_id:myId, type:"text", content:v, created_at:new Date().toISOString() };
    recentSent.set(v, Date.now());
    renderOne(pending);
    supabase.from("messages").insert({ room_id:roomId, author_id:myId, type:"text", content:v });
  }
};

/* 上传图片（乐观渲染 + 去重） */
$("#sheetUpload").onclick = ()=>{
  closeSheet();
  const input = document.createElement("input");
  input.type = "file"; input.accept = "image/*";
  input.onchange = async ()=>{
    const f = input.files?.[0]; if(!f) return;
    const path = `${roomId}/${Date.now()}-${f.name}`;
    // 先本地生成 URL 渲染占位（不依赖上传完成）
    const localURL = URL.createObjectURL(f);
    const pending = { room_id:roomId, author_id:myId, type:"image", content:localURL, created_at:new Date().toISOString() };
    recentSent.set(localURL, Date.now());
    renderOne(pending);

    const { error } = await supabase.storage.from(BUCKET).upload(path, f, { upsert:false });
    if(error) { alert(error.message); return; }
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
    // 替换为公网 URL 再发正式消息（realtime 会回显，recentSent 兜住不重复）
    recentSent.set(data.publicUrl, Date.now());
    await supabase.from("messages").insert({ room_id:roomId, author_id:myId, type:"image", content:data.publicUrl });
    toast("已上传");
  };
  input.click();
};

/* ===== 相机（使用你已有的 openCamFull / shoot / close） ===== */
const cam = { pane: $("#camPane"), video: $("#camView"), stream: null, list: [], idx: 0 };

async function getCameraListAfterGrant(){
  try { await navigator.mediaDevices.getUserMedia({video:true, audio:false}); } catch {}
  const devs = await navigator.mediaDevices.enumerateDevices().catch(()=>[]);
  return devs.filter(d=>d.kind==="videoinput");
}
function guessRearIndex(cams){
  const rx=/(back|rear|environment|后置|背面)/i;
  const i=cams.findIndex(c=>rx.test(c.label||""));
  return i>=0? i : 0;
}
async function openByIndex(i){
  if (cam.stream){ cam.stream.getTracks().forEach(t=>t.stop()); cam.stream=null; }
  const cams = cam.list;
  try{
    const dev = cams[i];
    let constraints;
    if (dev) constraints = { video: { deviceId:{ exact:dev.deviceId } }, audio:false };
    else constraints = { video: { facingMode:{ ideal:"environment" } }, audio:false };
    const s = await navigator.mediaDevices.getUserMedia(constraints);
    cam.stream = s; cam.video.srcObject = s; cam.video.style.transform="none";
    await cam.video.play();
    cam.idx = i;
    toast(dev?.label ? `已开启：${dev.label}` : "已开启相机");
  }catch(e){ console.error(e); toast("相机打开失败"); }
}
async function openCamFull(){
  cam.pane.classList.add("show");
  cam.list = await getCameraListAfterGrant();
  const rear = cam.list.length ? guessRearIndex(cam.list) : -1;
  await openByIndex(rear);
}
function closeCam(){
  if (cam.stream){ cam.stream.getTracks().forEach(t=>t.stop()); cam.stream=null; }
  try{ cam.video.pause(); }catch{}
  cam.video.srcObject = null; cam.pane.classList.remove("show");
  toast("已关闭相机");
}
async function shootAndUpload(){
  if (!cam.stream) { toast("请先开启相机"); return; }
  const v = cam.video;
  if (v.readyState < 2) { try{ await v.play(); }catch{} }
  const w = v.videoWidth || 1280, h = v.videoHeight || 720;
  const c = document.createElement("canvas"); c.width=w; c.height=h;
  c.getContext("2d").drawImage(v,0,0,w,h);
  const blob = await new Promise(res=> c.toBlob(res,"image/jpeg",0.9));
  if (!blob) { toast("拍照失败"); return; }

  // 先本地预览（占位）
  const localURL = URL.createObjectURL(blob);
  recentSent.set(localURL, Date.now());
  renderOne({ room_id:roomId, author_id:myId, type:"image", content:localURL, created_at:new Date().toISOString() });

  const path = `${roomId}/${Date.now()}-${Math.random().toString(16).slice(2)}.jpg`;
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType:"image/jpeg", upsert:false });
  if (upErr) { alert("上传失败："+upErr.message); return; }
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  recentSent.set(data.publicUrl, Date.now());
  await supabase.from("messages").insert({ room_id:roomId, author_id:myId, type:"image", content:data.publicUrl });
  toast("已拍照并上传");
}

$("#openCam")?.addEventListener("click", openCamFull);
$("#shot")?.addEventListener("click", shootAndUpload);
$("#closeCam")?.addEventListener("click", closeCam);
$("#shootBtn")?.addEventListener("click", shootAndUpload);
$("#closeCamBtn")?.addEventListener("click", closeCam);
document.addEventListener("visibilitychange", ()=>{ if (document.hidden) closeCam(); });

/* ===== 全屏查看：左右切换 & 滑动 ===== */
function openViewer(idx){
  currentIndex = idx;
  viewerImg.src = gallery[idx].url;
  viewer.classList.add("show");
}
viewer.addEventListener("click", ()=> viewer.classList.remove("show"));

// 添加左右按钮（JS 动态注入，不改 HTML）
(function ensureNavButtons(){
  if (!viewer) return;
  if (!$("#viewerPrev")){
    const prev = document.createElement("div"); prev.id="viewerPrev";
    Object.assign(prev.style,{position:"fixed",left:"8px",top:"50%",transform:"translateY(-50%)",fontSize:"26px",color:"#fff",padding:"8px",userSelect:"none"});
    prev.textContent = "‹"; viewer.appendChild(prev);
    prev.addEventListener("click", e=>{ e.stopPropagation(); nav(-1); });
  }
  if (!$("#viewerNext")){
    const next = document.createElement("div"); next.id="viewerNext";
    Object.assign(next.style,{position:"fixed",right:"8px",top:"50%",transform:"translateY(-50%)",fontSize:"26px",color:"#fff",padding:"8px",userSelect:"none"});
    next.textContent = "›"; viewer.appendChild(next);
    next.addEventListener("click", e=>{ e.stopPropagation(); nav(1); });
  }
})();
function nav(delta){
  if (currentIndex < 0) return;
  const N = gallery.length; if (!N) return;
  currentIndex = (currentIndex + delta + N) % N;
  viewerImg.src = gallery[currentIndex].url;
}
// 触摸滑动
let sx=0, sy=0;
viewer.addEventListener("touchstart", e=>{ const t=e.touches[0]; sx=t.clientX; sy=t.clientY; }, {passive:true});
viewer.addEventListener("touchend", e=>{
  const t=e.changedTouches[0]; const dx=t.clientX - sx; const dy=t.clientY - sy;
  if (Math.abs(dx)>50 && Math.abs(dy)<80){ nav(dx<0? 1 : -1); }
}, {passive:true});

/* ===== 点击消息中的图片，打开全屏（用上面 openViewer） ===== */
log.addEventListener("click", e=>{
  const a = e.target.closest(".msg a"); if(!a) return;
  e.preventDefault();
  const idx = Number(a.dataset.idx || -1);
  openViewer(idx >= 0 ? idx : 0);
});
