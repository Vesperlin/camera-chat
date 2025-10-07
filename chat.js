// chat.js  — iPhone 8 兼容 + 相机/缩略图/滑动预览/实时渲染优化
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY, BUCKET } from "./sb-config.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* -------------------- DOM -------------------- */
const $ = s => document.querySelector(s);
const log = $("#log");
const viewer = $("#viewer");
const viewerImg = $("#viewer img");
const toastEl = $("#toast");

/* -------------------- 状态 -------------------- */
// 角色 & 房间：由 URL 控制，例如 …/?room=abc123&role=A
const params = new URL(location.href).searchParams;
let roomId = params.get("room") || "";
const role = (params.get("role") || "A").toUpperCase();

const myId = (() => {
  const k = "client_id";
  let v = localStorage.getItem(k);
  if (!v) { v = crypto.randomUUID(); localStorage.setItem(k, v); }
  return v;
})();

let imageMode = "only-peer";           // only-peer | all-small | all-large
let dbChannel = null;
let lastDividerTime = 0;

// 预览用图库（按照消息顺序）
const gallery = [];                    // [{url, msgId}]
let galleryIndex = 0;

// 去重用：避免「乐观渲染 + 实时推送」重复
const seenMsgKeys = new Set();         // `${created_at}|${content}`

/* -------------------- 小工具 -------------------- */
const speak = t => {
  const tts = $("#ttsToggle");
  if (!tts || !tts.checked) return;
  try {
    const u = new SpeechSynthesisUtterance(t);
    u.lang = "zh-CN"; speechSynthesis.speak(u);
  } catch {}
};
const showToast = t => {
  if (!toastEl) return;
  toastEl.textContent = t;
  toastEl.classList.add("show");
  setTimeout(()=>toastEl.classList.remove("show"), 1200);
};
const needDivider = (createdAt) => {
  const t = new Date(createdAt).getTime();
  if (t - lastDividerTime > 5 * 60 * 1000) {
    lastDividerTime = t; return true;
  }
  return false;
};
const addDivider = (createdAt) => {
  const d = document.createElement("div");
  d.className = "time-divider";
  d.textContent = new Date(createdAt).toLocaleTimeString(
    "zh-CN", { hour: "2-digit", minute: "2-digit" }
  );
  log.appendChild(d);
};

/* -------------------- 渲染 -------------------- */
function pushToGalleryIfImage(m) {
  if (m.type === "image" && typeof m.content === "string") {
    gallery.push({ url: m.content, msgId: m.id || `${m.created_at}|${m.content}` });
  }
}
function renderOne(m, isHistory=false) {
  // 去重（避免重复显示）
  const key = `${m.created_at}|${m.content}`;
  if (seenMsgKeys.has(key)) return;
  seenMsgKeys.add(key);

  if (needDivider(m.created_at)) addDivider(m.created_at);

  const row = document.createElement("div");
  row.className = "row " + (m.author_id === myId ? "self" : "peer");

  const bubble = document.createElement("div");
  bubble.className = "msg";

  if (m.type === "image") {
    const a = document.createElement("a");
    a.href = m.content;
    const img = document.createElement("img");
    img.src = m.content; a.appendChild(img);

    a.addEventListener("click", (e)=>{
      e.preventDefault();
      // 打开大图并定位到该图的序号，支持左右滑
      const idx = gallery.findIndex(g => g.url === m.content);
      galleryIndex = idx >= 0 ? idx : 0;
      viewerImg.src = gallery[galleryIndex].url;
      viewer.classList.add("show");
    });

    // 放大规则
    const mine = (m.author_id === myId);
    const shouldLarge = imageMode === "all-large" || (imageMode === "only-peer" && !mine);
    if (shouldLarge) bubble.classList.add("enlarge");

    bubble.appendChild(a);
    pushToGalleryIfImage(m);
  } else {
    const p = document.createElement("p");
    p.textContent = m.content;
    bubble.appendChild(p);
  }

  row.appendChild(bubble);
  log.appendChild(row);
  if (!isHistory) log.scrollTop = log.scrollHeight;

  if (m.type === "text" && m.author_id !== myId) speak(m.content);
}

/* -------------------- 历史 + 实时 -------------------- */
async function loadHistory() {
  if (!roomId) return;
  const { data, error } = await supabase.from("messages")
    .select("*").eq("room_id", roomId)
    .order("created_at",{ ascending:true }).limit(800);
  if (error) { alert(error.message); return; }
  log.innerHTML = ""; lastDividerTime = 0;
  gallery.length = 0; seenMsgKeys.clear();
  data.forEach(m => { renderOne(m, true); });
}
function subRealtime() {
  if (dbChannel) supabase.removeChannel(dbChannel);
  if (!roomId) return;
  dbChannel = supabase.channel("room:"+roomId)
    .on("postgres_changes", {
      event: "INSERT", schema: "public", table: "messages", filter: `room_id=eq.${roomId}`
    }, payload => renderOne(payload.new))
    .subscribe();
}

/* -------------------- 房间（角色端不显示顶部输入） -------------------- */
// 角色端页面没有“加入/创建”按钮时，这里直接根据 URL 自动进入
if (roomId) { loadHistory(); subRealtime(); }
const joinBtn = $("#join");
if (joinBtn) {
  joinBtn.onclick = async () => {
    roomId = $("#room").value.trim() || crypto.randomUUID().slice(0,8);
    const url = new URL(location.href); url.searchParams.set("room", roomId);
    history.replaceState(null,"",url);
    await loadHistory(); subRealtime();
  };
}

/* -------------------- 发文字 -------------------- */
async function sendTextNow(text){
  if (!roomId || !text) return;
  const created_at = new Date().toISOString();
  // 乐观渲染
  renderOne({ room_id: roomId, author_id: myId, type:"text", content:text, created_at });
  await supabase.from("messages").insert({ room_id: roomId, author_id: myId, type:"text", content:text });
}
const sendBtn = $("#send");
const textIpt = $("#text");
if (sendBtn && textIpt) {
  sendBtn.onclick = ()=> sendTextNow(textIpt.value.trim()).then(()=> textIpt.value="");
  textIpt.addEventListener("keydown", e=>{ if(e.key==="Enter") sendBtn.click(); });
}

/* -------------------- 图片模式切换 -------------------- */
const seg = $("#modeSeg");
if (seg) {
  seg.addEventListener("click", e=>{
    const btn = e.target.closest("button"); if(!btn) return;
    [...seg.children].forEach(b=>b.classList.remove("active"));
    btn.classList.add("active");
    imageMode = btn.dataset.mode;

    // 重新应用
    log.querySelectorAll(".row").forEach(row=>{
      const mine = row.classList.contains("self");
      const bubble = row.querySelector(".msg");
      const hasImg = !!row.querySelector("img");
      bubble?.classList.remove("enlarge");
      if (!hasImg) return;
      const shouldLarge = imageMode==="all-large" || (imageMode==="only-peer" && !mine);
      if (shouldLarge) bubble.classList.add("enlarge");
    });
  });
}

/* -------------------- + 面板 -------------------- */
const sheet = $("#sheet"), mask = $("#sheetMask");
const openSheet = ()=>{ sheet?.classList.add("show"); mask?.classList.add("show"); }
const closeSheet = ()=>{ sheet?.classList.remove("show"); mask?.classList.remove("show"); }
$("#plusBtn")?.addEventListener("click", openSheet);
mask?.addEventListener("click", closeSheet);

// 模板
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
  if (Number.isFinite(idx) && idx>=1 && idx<=templates.length) {
    sendTextNow(templates[idx-1]);
  }
});

// 上传图片（相册）
$("#sheetUpload")?.addEventListener("click", ()=>{
  closeSheet();
  const input = document.createElement("input");
  input.type = "file"; input.accept = "image/*";
  input.onchange = async ()=>{
    const f = input.files?.[0]; if(!f || !roomId) return;
    const created_at = new Date().toISOString();

    // 先乐观渲染
    const tmpUrl = URL.createObjectURL(f);
    renderOne({ room_id: roomId, author_id: myId, type:"image", content: tmpUrl, created_at });

    const path = `${roomId}/${Date.now()}-${f.name.replace(/\s+/g,"_")}`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, f, { upsert:false });
    if (error) return alert(error.message);
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
    await supabase.from("messages").insert({ room_id: roomId, author_id: myId, type:"image", content:data.publicUrl });
  };
  input.click();
});
$("#sheetCamera")?.addEventListener("click", ()=>{ closeSheet(); openCamFull(); });
$("#sheetMode")?.addEventListener("click", ()=>{ closeSheet(); $("#modeSeg button")[1]?.click(); });

/* -------------------- 全屏预览：点击关闭 + 左右滑 -------------------- */
viewer?.addEventListener("click", ()=> viewer.classList.remove("show"));
let touchX = 0;
viewer?.addEventListener("touchstart", e=>{ touchX = e.touches[0].clientX; }, {passive:true});
viewer?.addEventListener("touchend", e=>{
  const dx = e.changedTouches[0].clientX - touchX;
  if (Math.abs(dx) < 40) return; // 滑动阈值
  galleryIndex = (dx < 0)
    ? Math.min(gallery.length-1, galleryIndex+1)
    : Math.max(0, galleryIndex-1);
  viewerImg.src = gallery[galleryIndex]?.url || viewerImg.src;
}, {passive:true});

/* -------------------- 相机（全屏） -------------------- */
let stream = null;
let facing = "environment"; // 默认后置
let rotation = 0;           // 0/90/180/270

// 动态在相机面板里插入「翻转」「旋转」按钮 & 左下角缩略图
function ensureCamUI(){
  const pane = $("#camPane"); if(!pane) return;

  // 缩略图
  if (!$("#miniShot")) {
    const mini = document.createElement("div");
    mini.id = "miniShot";
    Object.assign(mini.style, {
      position:"absolute", left:"10px", bottom:"74px", width:"66px", height:"66px",
      border:"1px solid rgba(255,255,255,.25)", borderRadius:"10px", overflow:"hidden",
      background:"#111", display:"none", zIndex:"120"
    });
    const img = document.createElement("img");
    img.style.width="100%"; img.style.height="100%"; img.style.objectFit="cover";
    mini.appendChild(img);
    pane.appendChild(mini);
  }

  // 翻转
  if (!$("#flipBtn")) {
    const btn = document.createElement("button");
    btn.id = "flipBtn";
    btn.textContent = "切换镜头";
    btn.className = "cam-btn";
    btn.style.position="absolute"; btn.style.right="12px"; btn.style.bottom="74px";
    btn.addEventListener("click", async ()=>{
      facing = (facing === "environment" ? "user" : "environment");
      await restartStream();
    });
    pane.appendChild(btn);
  }

  // 旋转
  if (!$("#rotateBtn")) {
    const btn = document.createElement("button");
    btn.id = "rotateBtn";
    btn.textContent = "旋转画面";
    btn.className = "cam-btn";
    btn.style.position="absolute"; btn.style.right="12px"; btn.style.bottom="126px";
    btn.addEventListener("click", ()=>{
      rotation = (rotation + 90) % 360;
      const v = $("#camView"); if (v) v.style.transform = `rotate(${rotation}deg)`;
    });
    pane.appendChild(btn);
  }
}

async function restartStream(){
  // 停止旧流
  if (stream) { stream.getTracks().forEach(t=>t.stop()); stream=null; }
  const video = $("#camView"); if (video) { video.srcObject = null; video.style.transform = `rotate(${rotation}deg)`; }

  // 重新打开
  await openCamWithFacing();
}

async function openCamWithFacing(){
  const video = $("#camView"); const pane = $("#camPane");
  if (!video || !pane) return;

  const constraints = {
    video: {
      facingMode: { ideal: facing },
      width: { ideal: 1280 }, height: { ideal: 720 }
    },
    audio: false
  };

  try {
    stream = await navigator.mediaDevices.getUserMedia(constraints)
      .catch(() => navigator.mediaDevices.getUserMedia({ video:true, audio:false }));
    if (!stream) throw new Error("相机流为空");
    video.srcObject = stream;
    await video.play();
  } catch (e) {
    pane.classList.remove("show");
    alert("相机打开失败：" + e.message + "\n请确认：1) 使用 HTTPS 访问；2) Safari 已允许相机权限。");
  }
}

async function openCamFull(){
  const pane = $("#camPane"); if (!pane) return;
  pane.classList.add("show");
  ensureCamUI();

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    pane.classList.remove("show");
    return alert("此浏览器不支持相机访问，请使用 Safari，并在系统设置中允许相机。");
  }
  await openCamWithFacing();
  showToast("相机已启动");
}
$("#openCam")?.addEventListener("click", openCamFull);

// 关闭（工具条 & 全屏里的按钮都可用）
function closeCam(){
  if(stream){ stream.getTracks().forEach(t=>t.stop()); stream = null; }
  const pane = $("#camPane"); if (pane) pane.classList.remove("show");
}
$("#closeCam")?.addEventListener("click", closeCam);
$("#closeCamBtn")?.addEventListener("click", closeCam);

// 拍照并上传（工具条 & 全屏按钮）
async function takeShotAndUpload(){
  if (!stream) return alert("请先打开相机");
  if (!roomId) return alert("房间不存在");

  const video = $("#camView");
  const c = document.createElement("canvas");
  // 旋转下的绘制
  let w = video.videoWidth || 1280, h = video.videoHeight || 720;
  if (rotation % 180 !== 0) [w, h] = [h, w];
  c.width = w; c.height = h;
  const ctx = c.getContext("2d");

  ctx.save();
  // 把画布坐标系旋转到与 video 一致
  if (rotation === 90) { ctx.translate(w, 0); ctx.rotate(Math.PI/2); }
  else if (rotation === 180) { ctx.translate(w, h); ctx.rotate(Math.PI); }
  else if (rotation === 270) { ctx.translate(0, h); ctx.rotate(3*Math.PI/2); }
  ctx.drawImage(video, 0, 0, video.videoWidth || 1280, video.videoHeight || 720);
  ctx.restore();

  const blob = await new Promise(r => c.toBlob(r, "image/jpeg", 0.9));
  const created_at = new Date().toISOString();

  // 小缩略图提示（左下角）
  const mini = $("#miniShot");
  const miniImg = mini?.querySelector("img");
  if (mini && miniImg) {
    miniImg.src = URL.createObjectURL(blob);
    mini.style.display = "block";
    setTimeout(()=> mini.style.display = "none", 1800);
  }

  // 乐观渲染
  const tempUrl = URL.createObjectURL(blob);
  renderOne({ room_id: roomId, author_id: myId, type:"image", content: tempUrl, created_at });

  // 上传
  const fname = `${roomId}/${Date.now()}-${Math.random().toString(16).slice(2)}.jpg`;
  const { error } = await supabase.storage.from(BUCKET)
    .upload(fname, blob, { contentType:"image/jpeg", upsert:false });
  if (error) return alert("上传失败："+error.message);
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(fname);

  await supabase.from("messages").insert({
    room_id: roomId, author_id: myId, type:"image", content: data.publicUrl
  });

  showToast("已拍照并发送");
}
$("#shot")?.addEventListener("click", takeShotAndUpload);
$("#shootBtn")?.addEventListener("click", takeShotAndUpload);

// 监听页面隐藏时自动关闭相机（iOS 省电）
document.addEventListener("visibilitychange", ()=>{
  if (document.hidden) closeCam();
});

/* -------------------- 消息内点图 = 预览 -------------------- */
log?.addEventListener("click", e=>{
  const a = e.target.closest(".msg a"); if(!a) return;
  e.preventDefault();
  const idx = gallery.findIndex(g => g.url === a.href);
  galleryIndex = idx >= 0 ? idx : 0;
  viewerImg.src = gallery[galleryIndex].url;
  viewer.classList.add("show");
});
