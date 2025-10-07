import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY, BUCKET } from "./sb-config.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/** ====== DOM ====== */
const $ = s => document.querySelector(s);
const log = $("#log");
const viewer = $("#viewer");
const viewerImg = $("#viewer img");
const toastEl = $("#toast");

/** ====== 读取 URL 参数：room / role ====== */
const url = new URL(location.href);
let roomId = url.searchParams.get("room") || "";
const role = (url.searchParams.get("role") || "").toUpperCase(); // A/B/C 或空

if (roomId) $("#room").value = roomId;

/** ====== 本端标识 ====== */
const myId = (() => {
  const k = "client_id";
  let v = localStorage.getItem(k);
  if (!v) { v = crypto.randomUUID(); localStorage.setItem(k, v); }
  return v;
})();

let imageMode = "only-peer"; // only-peer | all-small | all-large
let dbChannel = null;
let lastDividerTime = 0;

/** ====== 朗读开关（角色端不显示，但保留能力） ====== */
const speak = t => {
  // 如果页面上没有 ttsToggle 或者 role 存在（角色端），默认不读
  const tts = $("#ttsToggle");
  if (!tts || role) return;
  try { const u = new SpeechSynthesisUtterance(t); u.lang = "zh-CN"; speechSynthesis.speak(u); } catch {}
};
const showToast = t => {
  toastEl.textContent = t;
  toastEl.classList.add("show");
  setTimeout(()=>toastEl.classList.remove("show"), 1200);
};

/** ====== 角色端 UI 裁剪 ====== */
(function applyRoleUI(){
  if (!role) return;                    // 非角色链接，保持原样
  $("#joinRow")?.remove();              // 顶部“加入/创建/朗读对方”整行移除
  // 房间输入也不需要可编辑
  $("#room")?.setAttribute("readonly","readonly");

  // 角色能力开关
  const camBtns = ["#openCam","#shot","#closeCam","#sheetCamera","#shootBtn","#closeCamBtn"];
  if (role === "B" || role === "C") {
    camBtns.forEach(sel => $(sel)?.classList.add("hide-by-role"));
  }
  // 你如果想让 C 将来只看/也能发文字，可在这里继续裁剪 composer 等
})();

/** ====== 渲染 ====== */
function needTimeDivider(createdAt) {
  const t = new Date(createdAt).getTime();
  if (t - lastDividerTime > 5*60*1000) { lastDividerTime = t; return true; }
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
    a.href = m.content;
    a.onclick = e=>{ e.preventDefault(); viewerImg.src = a.href; viewer.classList.add("show"); };
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

/** ====== 历史 + 实时 ====== */
async function loadHistory() {
  if (!roomId) return;
  const { data, error } = await supabase.from("messages")
    .select("*").eq("room_id", roomId)
    .order("created_at",{ascending:true}).limit(500);
  if (error) { alert(error.message); return; }
  log.innerHTML = ""; lastDividerTime = 0;
  data.forEach(m=>renderOne(m, true));
}
function subRealtime() {
  if (dbChannel) supabase.removeChannel(dbChannel);
  if (!roomId) return;
  dbChannel = supabase.channel("room:"+roomId)
    .on("postgres_changes",{
      event:"INSERT", schema:"public", table:"messages", filter:`room_id=eq.${roomId}`
    }, payload => renderOne(payload.new))
    .subscribe();
}

/** ====== 加入房间（普通模式按钮 / 角色模式自动） ====== */
$("#join")?.addEventListener("click", async ()=>{
  roomId = $("#room").value.trim() || crypto.randomUUID().slice(0,8);
  const u = new URL(location.href); u.searchParams.set("room", roomId); history.replaceState(null,"",u);
  await loadHistory(); subRealtime();
});

// 如果是角色端（有 role），直接自动进房
(async function autoJoinIfRole(){
  if (!role) return;
  if (!roomId) { roomId = crypto.randomUUID().slice(0,8); const u = new URL(location.href); u.searchParams.set("room", roomId); history.replaceState(null,"",u); }
  await loadHistory(); subRealtime();
})();

/** ====== 发文字 ====== */
$("#send")?.addEventListener("click", async ()=>{
  const v = $("#text").value.trim(); if(!v || !roomId) return;
  $("#text").value = "";
  await supabase.from("messages").insert({ room_id: roomId, author_id: myId, type:"text", content:v });
});
$("#text")?.addEventListener("keydown", e=>{ if(e.key==="Enter") $("#send")?.click(); });

/** ====== 模式切换 ====== */
$("#modeSeg")?.addEventListener("click", e=>{
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
const openSheet = ()=>{ sheet?.classList.add("show"); mask?.classList.add("show"); }
const closeSheet = ()=>{ sheet?.classList.remove("show"); mask?.classList.remove("show"); }
$("#plusBtn")?.addEventListener("click", openSheet);
mask?.addEventListener("click", closeSheet);

const templates = [
  "[状态] 我已到达",
  "[状态] 我已离开",
  "[表单] 姓名=；数量=；备注=",
  "[系统] 我已拍照并上传"
];
$("#sheetTemplate")?.addEventListener("click", ()=>{
  closeSheet();
  const label = "选择模板（输入编号）：\n" + templates.map((t,i)=>`${i+1}. ${t}`).join("\n");
  const idx = Number(prompt(label,"1"));
  if(Number.isFinite(idx) && idx>=1 && idx<=templates.length){
    const v = templates[idx-1];
    supabase.from("messages").insert({ room_id:roomId, author_id:myId, type:"text", content:v });
  }
});

/** 文件上传（不依赖相机） */
$("#sheetUpload")?.addEventListener("click", ()=>{
  closeSheet();
  const input = document.createElement("input");
  input.type = "file"; input.accept = "image/*";
  input.onchange = async ()=>{
    const f = input.files[0]; if(!f || !roomId) return;
    const path = `${roomId}/${Date.now()}-${f.name}`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, f, { upsert:false });
    if(error) return alert(error.message);
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
    await supabase.from("messages").insert({ room_id:roomId, author_id:myId, type:"image", content:data.publicUrl });
  };
  input.click();
});

/** ====== 相机（A 才可见） ====== */
$("#sheetCamera")?.addEventListener("click", ()=>{ closeSheet(); openCamFull(); });
$("#sheetMode")?.addEventListener("click", ()=>{ closeSheet(); $("#modeSeg button")[1]?.click(); });

viewer?.addEventListener("click", ()=> viewer.classList.remove("show"));

let stream = null;
async function openCamFull(){
  $("#camPane")?.classList.add("show");
  try{
    // 默认后置；若失败再回退任意摄像头
    stream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode:{ exact:"environment" } }, audio:false })
      .catch(()=> navigator.mediaDevices.getUserMedia({ video:true, audio:false }));
  }catch(e){ $("#camPane")?.classList.remove("show"); return alert("相机权限失败："+e.message); }
  const v = $("#camView"); if(!v) return;
  v.srcObject = stream; await v.play();
}
$("#openCam")?.addEventListener("click", openCamFull);

function stopCam(){
  if(stream){ stream.getTracks().forEach(t=>t.stop()); stream=null; }
  $("#camPane")?.classList.remove("show");
}
$("#closeCam")?.addEventListener("click", stopCam);
$("#closeCamBtn")?.addEventListener("click", stopCam);

$("#shot")?.addEventListener("click", doShootAndSend);
$("#shootBtn")?.addEventListener("click", doShootAndSend);

async function doShootAndSend(){
  if(!stream || !roomId) return alert("请先打开相机");
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
}

/** ====== 点击图片全屏 ====== */
log?.addEventListener("click", e=>{
  const a = e.target.closest(".msg a"); if(!a) return;
  e.preventDefault(); viewerImg.src = a.href; viewer.classList.add("show");
});
