import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY, BUCKET } from "./sb-config.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/** ====== DOM & 状态 ====== */
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

let imageMode = "only-peer"; // only-peer | all-small | all-large
let dbChannel = null;
let lastDividerTime = 0;

/** ====== 工具 ====== */
const speak = t => {
  if (!$("#ttsToggle").checked) return;
  try {
    const u = new SpeechSynthesisUtterance(t);
    u.lang = "zh-CN"; speechSynthesis.speak(u);
  } catch {}
};
const showToast = t => {
  toastEl.textContent = t;
  toastEl.classList.add("show");
  setTimeout(()=>toastEl.classList.remove("show"), 1200);
};

/** ====== 渲染 ====== */
function needTimeDivider(createdAt) {
  const t = new Date(createdAt).getTime();
  if (t - lastDividerTime > 5*60*1000) { // 5 分钟分隔
    lastDividerTime = t; return true;
  }
  return false;
}
function addTimeDivider(createdAt) {
  const d = document.createElement("div");
  d.className = "time-divider";
  d.textContent = new Date(createdAt).toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit"});
  log.appendChild(d);
}
function renderOne(m, isHistory=false) {
  if (needTimeDivider(m.created_at)) addTimeDivider(m.created_at);

  const row = document.createElement("div");
  row.className = "row " + (m.author_id===myId? "self":"peer");

  const bubble = document.createElement("div");
  bubble.className = "msg";

  if (m.type === "image") {
    const a = document.createElement("a");
    a.href = m.content; a.onclick = e=>{ e.preventDefault(); viewerImg.src = a.href; viewer.classList.add("show"); };
    const img = document.createElement("img"); img.src = m.content; a.appendChild(img);
    // 放大规则
    const mine = (m.author_id===myId);
    const shouldLarge = imageMode==="all-large" || (imageMode==="only-peer" && !mine);
    if (shouldLarge) bubble.classList.add("enlarge");
    bubble.appendChild(a);
  } else {
    const p = document.createElement("p"); p.textContent = m.content; bubble.appendChild(p);
  }

  row.appendChild(bubble);
  log.appendChild(row);
  if (!isHistory) log.scrollTop = log.scrollHeight;

  if (m.type==="text" && m.author_id!==myId) speak(m.content);
}

/** ====== 历史与实时 ====== */
async function loadHistory() {
  const { data, error } = await supabase.from("messages")
    .select("*").eq("room_id", roomId)
    .order("created_at",{ascending:true}).limit(500);
  if (error) { alert(error.message); return; }
  log.innerHTML = ""; lastDividerTime = 0;
  data.forEach(m=>renderOne(m, true));
}
function subRealtime() {
  if (dbChannel) supabase.removeChannel(dbChannel);
  dbChannel = supabase.channel("room:"+roomId)
    .on("postgres_changes",{
      event:"INSERT", schema:"public", table:"messages", filter:`room_id=eq.${roomId}`
    }, payload => renderOne(payload.new))
    .subscribe();
}

/** ====== 房间 ====== */
$("#join").onclick = async () => {
  roomId = $("#room").value.trim() || crypto.randomUUID().slice(0,8);
  const url = new URL(location.href); url.searchParams.set("room", roomId);
  history.replaceState(null,"",url);
  await loadHistory(); subRealtime();
};
if (roomId) { loadHistory(); subRealtime(); }

/** ====== 发送文字 ====== */
$("#send").onclick = async ()=>{
  const v = $("#text").value.trim(); if(!v) return;
  $("#text").value = "";
  await supabase.from("messages").insert({
    room_id: roomId, author_id: myId, type:"text", content:v
  });
};
$("#text").addEventListener("keydown", e=>{ if(e.key==="Enter") $("#send").click(); });

/** ====== 图片模式切换（只放大对方 / 全缩略 / 全放大） ====== */
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

/** ====== + 面板 ====== */
const sheet = $("#sheet"), mask = $("#sheetMask");
const openSheet = ()=>{ sheet.classList.add("show"); mask.classList.add("show"); }
const closeSheet = ()=>{ sheet.classList.remove("show"); mask.classList.remove("show"); }
$("#plusBtn").onclick = openSheet; mask.onclick = closeSheet;

/** 面板项：模板 */
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
    supabase.from("messages").insert({ room_id:roomId, author_id:myId, type:"text", content:v });
  }
};

/** 面板项：上传图片 */
$("#sheetUpload").onclick = ()=>{
  closeSheet();
  const input = document.createElement("input");
  input.type = "file"; input.accept = "image/*";
  input.onchange = async ()=>{
    const f = input.files[0]; if(!f) return;
    const path = `${roomId}/${Date.now()}-${f.name}`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, f, { upsert:false });
    if(error) return alert(error.message);
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
    await supabase.from("messages").insert({ room_id:roomId, author_id:myId, type:"image", content:data.publicUrl });
  };
  input.click();
};

/** 面板项：打开相机（进入全屏相机） */
$("#sheetCamera").onclick = ()=>{ closeSheet(); openCamFull(); };
$("#sheetMode").onclick = ()=>{ closeSheet(); $("#modeSeg button")[1]?.click(); };

viewer.addEventListener("click", ()=> viewer.classList.remove("show"));

/** ====== 相机全屏模式 ====== */
let stream = null;
async function openCamFull(){
  $("#camPane").classList.add("show");
  try{
    stream = await navigator.mediaDevices.getUserMedia({ video:true, audio:false });
  }catch(e){ $("#camPane").classList.remove("show"); return alert("相机权限失败："+e.message); }
  $("#camView").srcObject = stream; await $("#camView").play();
}
$("#openCam").onclick = openCamFull;

$("#closeCam,#closeCamBtn").onclick = ()=>{
  if(stream){ stream.getTracks().forEach(t=>t.stop()); stream=null; }
  $("#camPane").classList.remove("show");
};

$("#shot,#shootBtn").onclick = async ()=>{
  if(!stream) return alert("请先打开相机");
  const video = $("#camView");
  const c = document.createElement("canvas");
  c.width = video.videoWidth||1280; c.height = video.videoHeight||720;
  c.getContext("2d").drawImage(video,0,0,c.width,c.height);
  const blob = await new Promise(r=> c.toBlob(r,"image/jpeg",0.9));
  const path = `${roomId}/${Date.now()}-${Math.random().toString(16).slice(2)}.jpg`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType:"image/jpeg", upsert:false });
  if(error) return alert(error.message);
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  await supabase.from("messages").insert({ room_id:roomId, author_id:myId, type:"image", content:data.publicUrl });
  showToast("已拍照并发送");
};

/** ====== 预览 ====== */
log.addEventListener("click", e=>{
  const a = e.target.closest(".msg a"); if(!a) return;
  e.preventDefault(); viewerImg.src = a.href; viewer.classList.add("show");
});
