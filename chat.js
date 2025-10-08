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

// ===== B 端拍照/上传 =====
const filePicker = document.getElementById('filePicker');
const fileCamera = document.getElementById('fileCamera');
const btnPhoto   = document.getElementById('btnPhoto');
const btnCamera  = document.getElementById('btnCamera');

async function uploadAndSend(fileBlob, filenameHint='cam.jpg') {
  try {
    const path = `${ROOM_ID}/${Date.now()}-${encodeURIComponent(filenameHint)}`;
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, fileBlob, { upsert:false });
    if (upErr) { alert('上传失败：' + upErr.message); return; }
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
    const { error: msgErr } = await supabase.from('messages').insert({
      room_id: ROOM_ID, author_id: myId, type: 'image', content: data.publicUrl
    });
    if (msgErr) { alert('写入消息失败：' + msgErr.message); return; }
    renderOne({id:null, room_id:ROOM_ID, author_id:myId, type:'image', content:data.publicUrl, created_at:new Date().toISOString()});
  } catch (e) {
    alert('上传异常：' + e.message);
  }
}

btnPhoto?.addEventListener('click', () => filePicker.click());
filePicker?.addEventListener('change', async () => {
  const f = filePicker.files?.[0]; if (!f) return;
  await uploadAndSend(f, f.name || 'photo.jpg');
  filePicker.value = '';
});
btnCamera?.addEventListener('click', () => fileCamera.click());
fileCamera?.addEventListener('change', async () => {
  const f = fileCamera.files?.[0]; if (!f) return;
  await uploadAndSend(f, 'camera.jpg');
  fileCamera.value = '';
});

// ===== 启动 =====
await loadHistory();
subRealtime();
