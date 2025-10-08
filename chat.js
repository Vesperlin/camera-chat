// chat.js
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY, BUCKET, ROOM_ID } from "./sb-config.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ===== 角色（B/C），从 URL 取 ?role=，默认 B =====
const params = new URL(location.href).searchParams;
const ROLE = (params.get("role") || "B").toUpperCase();
document.getElementById("roleTag").textContent = ROLE;

// ===== DOM =====
const $ = s => document.querySelector(s);
const log = $("#log");
const viewer = $("#viewer");
const viewerImg = $("#viewer img");
const prevBtn = $("#prev");
const nextBtn = $("#next");

// ===== 状态 =====
const myId = (() => {
  const k = "client_id";
  let v = localStorage.getItem(k);
  if (!v) { v = crypto.randomUUID(); localStorage.setItem(k, v); }
  return v;
})();
let imageMode = "only-peer"; // only-peer | all-small | all-large
let lastDivider = 0;
let realtimeChannel = null;

// 预览相册（用于左右切换）
let gallery = []; // {url, id}
let galleryIdx = -1;

// ===== 工具 =====
function needDivider(ts) {
  const t = new Date(ts).getTime();
  if (t - lastDivider > 5*60*1000) { lastDivider = t; return true; }
  return false;
}
function addDivider(ts) {
  const d = document.createElement("div");
  d.className = "time";
  d.textContent = new Date(ts).toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit"});
  log.appendChild(d);
}
function isMine(m){ return m.author_id === myId; }
function isImg(m){ return m.type === "image"; }
function applyBubbleSize(rowEl, mine, hasImg){
  const bubble = rowEl.querySelector(".msg");
  bubble.classList.remove("enlarge");
  if (!hasImg) return;
  const shouldLarge = imageMode==="all-large" || (imageMode==="only-peer" && !mine);
  if (shouldLarge) bubble.classList.add("enlarge");
}

// ===== 渲染一条 =====
function renderOne(m, fromHistory=false){
  if (needDivider(m.created_at)) addDivider(m.created_at);

  const row = document.createElement("div");
  row.className = "row " + (isMine(m) ? "self" : "peer");

  const bubble = document.createElement("div");
  bubble.className = "msg";

  if (isImg(m)) {
    const a = document.createElement("a");
    a.href = m.content;
    const img = document.createElement("img"); img.src = m.content; a.appendChild(img);
    a.onclick = e => { e.preventDefault(); openViewerByUrl(m.content); };
    bubble.appendChild(a);

    // 放入相册索引（避免重复）
    if (!gallery.find(x=>x.url===m.content)) gallery.push({url:m.content, id:m.id});
    applyBubbleSize(row, isMine(m), true);

  } else {
    const p = document.createElement("p");
    p.textContent = m.content;
    bubble.appendChild(p);
  }

  row.appendChild(bubble);
  log.appendChild(row);
  if (!fromHistory) log.scrollTop = log.scrollHeight;
}

// ===== 历史+实时 =====
async function loadHistory(){
  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("room_id", ROOM_ID)
    .order("created_at", { ascending: true })
    .limit(500);
  if (error) { alert("加载历史失败："+error.message); return; }
  log.innerHTML = ""; lastDivider = 0; gallery = [];
  data.forEach(m => renderOne(m, true));
}
function subRealtime(){
  if (realtimeChannel) supabase.removeChannel(realtimeChannel);
  realtimeChannel = supabase.channel("room:"+ROOM_ID)
    .on("postgres_changes",
      { event:"INSERT", schema:"public", table:"messages", filter:`room_id=eq.${ROOM_ID}` },
      payload => renderOne(payload.new)
    )
    .subscribe();
}

// ===== 发送文字 =====
$("#send").onclick = async ()=>{
  const v = $("#text").value.trim(); if(!v) return;
  $("#text").value = "";
  const { error } = await supabase.from("messages").insert({
    room_id: ROOM_ID, author_id: myId, type:"text", content: v
  });
  if (error) alert("发送失败："+error.message);
};
$("#text").addEventListener("keydown", e=>{ if(e.key==="Enter") $("#send").click(); });

// ===== 图片模式切换 =====
$("#modeSeg").addEventListener("click", (e)=>{
  const btn = e.target.closest("button"); if(!btn) return;
  [...$("#modeSeg").children].forEach(b=>b.classList.remove("active"));
  btn.classList.add("active"); imageMode = btn.dataset.mode;
  log.querySelectorAll(".row").forEach(row=>{
    const mine = row.classList.contains("self");
    const hasImg = !!row.querySelector("img");
    applyBubbleSize(row, mine, hasImg);
  });
});

// ===== 大图查看 + 左右滑 =====
function openViewerByUrl(url){
  galleryIdx = gallery.findIndex(x=>x.url===url);
  if (galleryIdx < 0) galleryIdx = 0;
  viewerImg.src = gallery[galleryIdx].url;
  viewer.classList.add("show");
}
function move(step){
  if (!gallery.length) return;
  galleryIdx = (galleryIdx + step + gallery.length) % gallery.length;
  viewerImg.src = gallery[galleryIdx].url;
}
viewer.addEventListener("click", ()=> viewer.classList.remove("show"));
prevBtn.addEventListener("click", e=>{ e.stopPropagation(); move(-1); });
nextBtn.addEventListener("click", e=>{ e.stopPropagation(); move(1); });

// 触摸滑动
let tX = 0, tY = 0;
viewer.addEventListener("touchstart", e=>{ const t = e.touches[0]; tX=t.clientX; tY=t.clientY; }, {passive:true});
viewer.addEventListener("touchend", e=>{
  const t = e.changedTouches[0];
  const dx = t.clientX - tX, dy = t.clientY - tY;
  if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) move(dx<0?1:-1);
}, {passive:true});

// ===== 启动 =====
await loadHistory();
subRealtime();

// ===== 兼容提示：若没开 Realtime，会自动给出提醒 =====
setTimeout(async ()=>{
  // 简单探测：发一条“心跳”再删（只有自己看得到），用来触发错误提示
  const { error } = await supabase.from("messages").insert({
    room_id: ROOM_ID, author_id: myId, type:"text", content:""
  }).select().single();
  if (!error) {
    await supabase.from("messages").delete().eq("content","").eq("author_id", myId);
  }
}, 3000);    Object.assign(img.style,{ width:'100%', height:'100%', objectFit:'cover' });
    mini.appendChild(img); pane.appendChild(mini);
  }

  if(!document.querySelector('#flipBtn')){
    const b=document.createElement('button');
    b.id='flipBtn'; b.textContent='切换镜头'; b.className='cam-btn';
    Object.assign(b.style,{ position:'absolute', right:'12px', bottom:'74px' });
    b.onclick = async ()=>{ facing = (facing==='environment'?'user':'environment'); await restartStream(); };
    pane.appendChild(b);
  }

  if(!document.querySelector('#rotateBtn')){
    const b=document.createElement('button');
    b.id='rotateBtn'; b.textContent='旋转画面'; b.className='cam-btn';
    Object.assign(b.style,{ position:'absolute', right:'12px', bottom:'126px' });
    b.onclick = ()=>{ rotation = (rotation+90)%360; const v=document.querySelector('#camView'); if(v) v.style.transform=`rotate(${rotation}deg)`; };
    pane.appendChild(b);
  }
}

async function openCamFull(){
  const pane=document.querySelector('#camPane');
  if(!pane) return;
  pane.classList.add('show');
  ensureCamUI();

  if(!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)){
    pane.classList.remove('show');
    alert('此环境不支持相机，请改用 Safari 打开。');
    fallbackCapture(roomId, myId, BUCKET);
    return;
  }
  try { await openCamWithFacing(); showToast?.('相机已启动'); }
  catch { /* 已在 openCamWithFacing 里兜底与诊断 */ }
}

function closeCam(){
  if(stream){ stream.getTracks().forEach(t=>t.stop()); stream=null; }
  document.querySelector('#camPane')?.classList.remove('show');
}

async function takeShotAndUpload(){
  if(!stream) { alert('请先打开相机'); return; }
  if(!roomId){ alert('房间不存在'); return; }

  const video = document.querySelector('#camView');
  const c = document.createElement('canvas');
  let w = video.videoWidth||1280, h = video.videoHeight||720;
  if(rotation%180!==0) [w,h]=[h,w];
  c.width=w; c.height=h;
  const ctx=c.getContext('2d');

  ctx.save();
  if(rotation===90){ ctx.translate(w,0); ctx.rotate(Math.PI/2); }
  else if(rotation===180){ ctx.translate(w,h); ctx.rotate(Math.PI); }
  else if(rotation===270){ ctx.translate(0,h); ctx.rotate(3*Math.PI/2); }
  ctx.drawImage(video,0,0,video.videoWidth||1280,video.videoHeight||720);
  ctx.restore();

  const blob = await new Promise(r=> c.toBlob(r,'image/jpeg',0.9));
  const created_at = new Date().toISOString();

  const mini=document.querySelector('#miniShot'); const miniImg=mini?.querySelector('img');
  if(mini && miniImg){ miniImg.src = URL.createObjectURL(blob); mini.style.display='block'; setTimeout(()=>mini.style.display='none',1800); }

  // 乐观渲染
  renderOne({ room_id:roomId, author_id:myId, type:'image', content:URL.createObjectURL(blob), created_at });

  const key = `${roomId}/${Date.now()}-${Math.random().toString(16).slice(2)}.jpg`;
  const { error } = await supabase.storage.from(BUCKET).upload(key, blob, { contentType:'image/jpeg', upsert:false });
  if(error) return alert('上传失败：'+error.message);
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(key);
  await supabase.from('messages').insert({ room_id:roomId, author_id:myId, type:'image', content:data.publicUrl });
  showToast?.('已拍照并发送');
}

// 事件绑定
document.querySelector('#openCam')?.addEventListener('click', openCamFull);
document.querySelector('#closeCam')?.addEventListener('click', closeCam);
document.querySelector('#closeCamBtn')?.addEventListener('click', closeCam);
document.querySelector('#shot')?.addEventListener('click', takeShotAndUpload);
document.querySelector('#shootBtn')?.addEventListener('click', takeShotAndUpload);

// 页面隐藏自动关流
document.addEventListener('visibilitychange', ()=>{ if(document.hidden) closeCam(); });


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

// 动态在相机面板里插入「切换镜头」「旋转」按钮 & 左下角缩略图
function ensureCamUI(){
  const pane = document.querySelector("#camPane"); if(!pane) return;

  // 左下角小缩略图
  if (!document.querySelector("#miniShot")) {
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

  // 切换前/后摄
  if (!document.querySelector("#flipBtn")) {
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

  // 旋转画面
  if (!document.querySelector("#rotateBtn")) {
    const btn = document.createElement("button");
    btn.id = "rotateBtn";
    btn.textContent = "旋转画面";
    btn.className = "cam-btn";
    btn.style.position="absolute"; btn.style.right="12px"; btn.style.bottom="126px";
    btn.addEventListener("click", ()=>{
      rotation = (rotation + 90) % 360;
      const v = document.querySelector("#camView");
      if (v) v.style.transform = `rotate(${rotation}deg)`;
    });
    pane.appendChild(btn);
  }
}

// 打开相机（先按 facingMode 试；失败则枚举设备挑后置）
async function openCamWithFacing(){
  const video = document.querySelector("#camView");
  const pane = document.querySelector("#camPane");
  if (!video || !pane) return;

  // 先试「后置/前置」意向约束
  const constraints = {
    video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false
  };

  try {
    stream = await navigator.mediaDevices.getUserMedia(constraints)
      .catch(async () => {
        // 回退：枚举设备，尽量选到后置
        const devices = await navigator.mediaDevices.enumerateDevices();
        const cams = devices.filter(d => d.kind === "videoinput");
        let back = cams.find(d => /back|rear|environment/i.test(d.label)) || cams[1] || cams[0];
        if (!back) throw new Error("未找到摄像头");
        return navigator.mediaDevices.getUserMedia({
          video: { deviceId: { exact: back.deviceId }, width: { ideal:1280 }, height: { ideal:720 } },
          audio: false
        });
      });

    if (!stream) throw new Error("相机流为空");
    video.srcObject = stream;

    // iOS 播放兼容
    try { await video.play(); }
    catch { setTimeout(()=> video.play().catch(()=>{}), 30); }
  } catch (e) {
    pane.classList.remove("show");
    alert("相机打开失败：" + e.message + "\n请确认：1) 使用 HTTPS 访问；2) Safari 已允许相机权限。");
  }
}

// 重新拉流（切镜头后调用）
async function restartStream(){
  if (stream) { stream.getTracks().forEach(t=>t.stop()); stream = null; }
  const video = document.querySelector("#camView");
  if (video) { video.srcObject = null; video.style.transform = `rotate(${rotation}deg)`; }
  await openCamWithFacing();
}

// 进入相机全屏
async function openCamFull(){
  const pane = document.querySelector("#camPane"); if (!pane) return;
  pane.classList.add("show");
  ensureCamUI();

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    pane.classList.remove("show");
    return alert("此浏览器不支持相机访问，请使用 Safari，并在系统设置中允许相机。");
  }
  await openCamWithFacing();
  showToast?.("相机已启动");
}

// 关闭相机（工具条 & 全屏按钮共用）
function closeCam(){
  if (stream) { stream.getTracks().forEach(t=>t.stop()); stream = null; }
  const pane = document.querySelector("#camPane"); if (pane) pane.classList.remove("show");
}

// 拍照 + 上传（含乐观渲染 & 左下角小缩略图提示）
async function takeShotAndUpload(){
  if (!stream) return alert("请先打开相机");
  if (!roomId) return alert("房间不存在");

  const video = document.querySelector("#camView");
  const c = document.createElement("canvas");
  let w = video.videoWidth || 1280, h = video.videoHeight || 720;
  if (rotation % 180 !== 0) [w,h] = [h,w];
  c.width = w; c.height = h;
  const ctx = c.getContext("2d");

  ctx.save();
  if (rotation === 90) { ctx.translate(w, 0); ctx.rotate(Math.PI/2); }
  else if (rotation === 180) { ctx.translate(w, h); ctx.rotate(Math.PI); }
  else if (rotation === 270) { ctx.translate(0, h); ctx.rotate(3*Math.PI/2); }
  ctx.drawImage(video, 0, 0, video.videoWidth || 1280, video.videoHeight || 720);
  ctx.restore();

  const blob = await new Promise(r => c.toBlob(r, "image/jpeg", 0.9));
  const created_at = new Date().toISOString();

  // 左下角小预览提示
  const mini = document.querySelector("#miniShot");
  const miniImg = mini?.querySelector("img");
  if (mini && miniImg) {
    miniImg.src = URL.createObjectURL(blob);
    mini.style.display = "block";
    setTimeout(()=> mini.style.display = "none", 1800);
  }

  // 乐观渲染（不等上传/推送也能立刻看到）
  const tempUrl = URL.createObjectURL(blob);
  renderOne({ room_id: roomId, author_id: myId, type:"image", content: tempUrl, created_at });

  // 真正上传
  const fname = `${roomId}/${Date.now()}-${Math.random().toString(16).slice(2)}.jpg`;
  const { error } = await supabase.storage.from(BUCKET)
    .upload(fname, blob, { contentType:"image/jpeg", upsert:false });
  if (error) return alert("上传失败："+error.message);

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(fname);
  await supabase.from("messages").insert({
    room_id: roomId, author_id: myId, type:"image", content: data.publicUrl
  });

  showToast?.("已拍照并发送");
}

/* 事件绑定（保持你已有按钮 ID 不变即可） */
document.querySelector("#openCam")?.addEventListener("click", openCamFull);
document.querySelector("#closeCam")?.addEventListener("click", closeCam);
document.querySelector("#closeCamBtn")?.addEventListener("click", closeCam);
document.querySelector("#shot")?.addEventListener("click", takeShotAndUpload);
document.querySelector("#shootBtn")?.addEventListener("click", takeShotAndUpload);

// 页面隐藏自动关流（iOS 省电 & 避免僵死）
document.addEventListener("visibilitychange", ()=>{ if (document.hidden) closeCam(); });
/* -------------------- 消息内点图 = 预览 -------------------- */
log?.addEventListener("click", e=>{
  const a = e.target.closest(".msg a"); if(!a) return;
  e.preventDefault();
  const idx = gallery.findIndex(g => g.url === a.href);
  galleryIndex = idx >= 0 ? idx : 0;
  viewerImg.src = gallery[galleryIndex].url;
  viewer.classList.add("show");
});
