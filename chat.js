// chat.js —— 即时显示图片 / 画廊左右切换 / iOS式左下角缩略图 / 相机后置优先+切镜头+旋转 / 角色A/B
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY, BUCKET } from "./sb-config.js";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ===== DOM & 状态 ===== */
const $ = s => document.querySelector(s);
const log = $("#log");
const viewer = $("#viewer");
const viewerImg = $("#viewer img");
const toastEl = $("#toast");
const camPane = $("#camPane");
const camVideo = $("#camView");

let roomId = new URL(location.href).searchParams.get("room") || "";
if (roomId) $("#room").value = roomId;

const role = (new URL(location.href)).searchParams.get("role") || "A"; // A/B
const myId = (() => { const k="client_id"; let v=localStorage.getItem(k); if(!v){v=crypto.randomUUID();localStorage.setItem(k,v);} return v; })();

let imageMode = "only-peer";
let dbChannel = null;
let lastDividerTime = 0;

const recentSent = new Set(); // 去重：存 content（url 或 文本）短暂缓存
const gallery = []; // {url, mine}
let currentIndex = -1;

/* ===== 小工具 ===== */
const tts = t => { if (role!=="A") return; const on=$("#ttsToggle"); if(!on||!on.checked) return; try{ const u=new SpeechSynthesisUtterance(t); u.lang="zh-CN"; speechSynthesis.speak(u);}catch{} };
const toast = t => { if(!toastEl) return; toastEl.textContent=t; toastEl.classList.add("show"); setTimeout(()=>toastEl.classList.remove("show"),1200); };
const isImg = s => /^https?:\/\/.+\.(jpg|jpeg|png|webp|gif)(\?.*)?$/i.test(s);

/* 角色 UI：B 隐藏朗读开关 */
(function applyRole(){ if(role==="B"){ const label=document.querySelector('label.chk'); if(label) label.style.display="none"; } })();

/* ===== 渲染 ===== */
function needDivider(at){ const t=new Date(at).getTime(); if(t-lastDividerTime>5*60*1000){ lastDividerTime=t; return true;} return false; }
function addDivider(at){ const d=document.createElement("div"); d.className="time-divider"; d.textContent=new Date(at).toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit"}); log.appendChild(d); }

/* 将图片加入画廊并返回索引 */
function pushToGallery(url, mine){ const idx=gallery.push({url, mine})-1; return idx; }

function renderOne(m, isHistory=false){
  // 去重（我自己刚发过的 content，realtime 回来不再重复渲染）
  if (m.author_id===myId && recentSent.has(m.content)) { recentSent.delete(m.content); return; }

  if (needDivider(m.created_at)) addDivider(m.created_at);

  const row=document.createElement("div");
  row.className="row "+(m.author_id===myId?"self":"peer");

  const bubble=document.createElement("div"); bubble.className="msg";
  const mine=(m.author_id===myId);

  if (m.type==="image" || isImg(m.content)){
    const a=document.createElement("a"); a.href=m.content;
    const idx=pushToGallery(m.content, mine); a.dataset.idx=String(idx);
    a.onclick=e=>{ e.preventDefault(); openViewer(idx); };

    const img=document.createElement("img"); img.src=m.content; a.appendChild(img);

    const shouldLarge=imageMode==="all-large" || (imageMode==="only-peer" && !mine);
    if(shouldLarge) bubble.classList.add("enlarge");
    bubble.appendChild(a);
  }else{
    const p=document.createElement("p"); p.textContent=m.content; bubble.appendChild(p);
  }
  row.appendChild(bubble); log.appendChild(row);
  if (!isHistory) log.scrollTop=log.scrollHeight;

  if (m.type!=="image" && !mine) tts(m.content);
}

/* ===== 历史 & 实时 ===== */
async function loadHistory(){
  const {data,error}=await supabase.from("messages").select("*").eq("room_id",roomId).order("created_at",{ascending:true}).limit(600);
  if(error){ alert(error.message); return; }
  log.innerHTML=""; lastDividerTime=0; gallery.length=0;
  data.forEach(m=>renderOne(m,true));
}
function subRealtime(){
  if (dbChannel) supabase.removeChannel(dbChannel);
  dbChannel=supabase.channel("room:"+roomId).on("postgres_changes",
    {event:"INSERT",schema:"public",table:"messages",filter:`room_id=eq.${roomId}`},
    payload=>renderOne(payload.new)
  ).subscribe();
}

/* ===== 房间 ===== */
$("#join").onclick=async ()=>{
  roomId=$("#room").value.trim() || crypto.randomUUID().slice(0,8);
  const url=new URL(location.href); url.searchParams.set("room",roomId); if(role) url.searchParams.set("role", role);
  history.replaceState(null,"",url);
  await loadHistory(); subRealtime();
};
if (roomId){ loadHistory(); subRealtime(); }

/* ===== 发送文本（乐观渲染） ===== */
$("#send").onclick=async ()=>{
  const v=$("#text").value.trim(); if(!v) return;
  $("#text").value="";
  const pending={room_id:roomId,author_id:myId,type:"text",content:v,created_at:new Date().toISOString()};
  recentSent.add(v); renderOne(pending);
  await supabase.from("messages").insert({room_id:roomId,author_id:myId,type:"text",content:v});
};
$("#text").addEventListener("keydown",e=>{ if(e.key==="Enter") $("#send").click(); });

/* ===== 图片模式切换 ===== */
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
    const shouldLarge=imageMode==="all-large" || (imageMode==="only-peer" && !mine);
    if(shouldLarge) bubble.classList.add("enlarge");
  });
});

/* ===== “更多”抽屉 ===== */
const sheet=$("#sheet"), mask=$("#sheetMask");
const openSheet=()=>{sheet.classList.add("show"); mask.classList.add("show");};
const closeSheet=()=>{sheet.classList.remove("show"); mask.classList.remove("show");};
$("#plusBtn").onclick=openSheet; mask.onclick=closeSheet;

const templates=["[状态] 我已到达","[状态] 我已离开","[表单] 姓名=；数量=；备注=","[系统] 我已拍照并上传"];
$("#sheetTemplate").onclick=()=>{
  closeSheet();
  const idx=Number(prompt("选择模板（输入编号）：\n"+templates.map((t,i)=>`${i+1}. ${t}`).join("\n"),"1"));
  if(Number.isFinite(idx)&&idx>=1&&idx<=templates.length){
    const v=templates[idx-1];
    const pending={room_id:roomId,author_id:myId,type:"text",content:v,created_at:new Date().toISOString()};
    recentSent.add(v); renderOne(pending);
    supabase.from("messages").insert({room_id:roomId,author_id:myId,type:"text",content:v});
  }
};

/* 上传图片（乐观渲染） */
$("#sheetUpload").onclick=()=>{
  closeSheet();
  const input=document.createElement("input"); input.type="file"; input.accept="image/*";
  input.onchange=async ()=>{
    const f=input.files?.[0]; if(!f) return;
    const localURL=URL.createObjectURL(f);
    const pending={room_id:roomId,author_id:myId,type:"image",content:localURL,created_at:new Date().toISOString()};
    recentSent.add(localURL); renderOne(pending);

    const path=`${roomId}/${Date.now()}-${f.name}`;
    const {error}=await supabase.storage.from(BUCKET).upload(path,f,{upsert:false});
    if(error){ alert(error.message); return; }
    const {data}=supabase.storage.from(BUCKET).getPublicUrl(path);
    recentSent.add(data.publicUrl);
    await supabase.from("messages").insert({room_id:roomId,author_id:myId,type:"image",content:data.publicUrl});
    toast("已上传");
  };
  input.click();
};
$("#sheetCamera").onclick=()=>{ closeSheet(); openCamFull(); };
$("#sheetMode").onclick=()=>{ closeSheet(); $("#modeSeg button")[1]?.click(); };

/* ===== 相机：后置优先 + 切镜头 + 旋转 + iOS式小缩略图 ===== */
const cam = { stream:null, list:[], idx:-1, rotate:0 };

async function ensureDeviceList(){
  try{ await navigator.mediaDevices.getUserMedia({video:true,audio:false}); }catch{}
  const devs=await navigator.mediaDevices.enumerateDevices().catch(()=>[]);
  cam.list=devs.filter(d=>d.kind==="videoinput");
}
function guessRearIndex(){ const rx=/(back|rear|environment|后置|背面)/i; const i=cam.list.findIndex(d=>rx.test(d.label||"")); return i>=0?i:0; }

async function openByIndex(i){
  if (cam.stream){ cam.stream.getTracks().forEach(t=>t.stop()); cam.stream=null; }
  let constraints;
  if (cam.list[i]) constraints={video:{deviceId:{exact:cam.list[i].deviceId}, width:{ideal:1280}, height:{ideal:720}},audio:false};
  else constraints={video:{facingMode:{ideal:"environment"}, width:{ideal:1280}, height:{ideal:720}},audio:false};
  const s=await navigator.mediaDevices.getUserMedia(constraints).catch(()=>null);
  if(!s){ toast("相机打开失败"); return false; }
  cam.stream=s; cam.idx=i;
  camVideo.srcObject=s; camVideo.style.transform="none";
  try{ await camVideo.play(); }catch{}
  return true;
}

/* 左下角小缩略图（iOS 截屏样式） */
function showShotThumb(url){
  let box=$("#shotThumb");
  if(!box){
    box=document.createElement("div"); box.id="shotThumb";
    Object.assign(box.style,{
      position:"fixed",left:"12px",bottom:"calc(18px + env(safe-area-inset-bottom))",
      width:"88px",height:"88px",borderRadius:"12px",overflow:"hidden",
      border:"1px solid rgba(255,255,255,.25)",boxShadow:"0 6px 18px rgba(0,0,0,.35)",
      zIndex:300,background:"#000"
    });
    const img=document.createElement("img"); img.style.width="100%"; img.style.height="100%"; img.style.objectFit="cover";
    box.appendChild(img);
    document.body.appendChild(box);
    box.addEventListener("click",()=>{ viewerImg.src=url; viewer.classList.add("show"); });
  }
  box.querySelector("img").src=url;
  box.style.opacity="0"; box.style.transform="scale(.9)";
  requestAnimationFrame(()=>{
    box.style.transition="all .18s ease"; box.style.opacity="1"; box.style.transform="scale(1)";
  });
  setTimeout(()=>{ box.style.opacity="0"; box.style.transform="scale(.9)"; }, 2200);
}

async function openCamFull(){
  camPane.classList.add("show");
  if (!cam.list.length) await ensureDeviceList();
  const rear = cam.list.length ? guessRearIndex() : -1;
  const ok = await openByIndex(rear);
  if (ok) toast("已开启相机");
}
function closeCam(){
  if (cam.stream){ cam.stream.getTracks().forEach(t=>t.stop()); cam.stream=null; }
  try{ camVideo.pause(); }catch{}
  camVideo.srcObject=null; camPane.classList.remove("show"); toast("已关闭相机");
}
async function switchCamera(){
  if (!cam.list.length) await ensureDeviceList();
  if (!cam.list.length) return toast("无可切换的摄像头");
  const next = (cam.idx>=0 ? cam.idx+1 : 1) % cam.list.length;
  const ok = await openByIndex(next); if (ok) toast(cam.list[next]?.label || "已切换镜头");
}
function rotateCamera(){
  cam.rotate = (cam.rotate + 90) % 360;
  camVideo.style.transform = `rotate(${cam.rotate}deg)`;
}

async function shootAndUpload(){
  if (!cam.stream) return toast("请先开启相机");

  // canvas 抓帧 + 旋转
  const v = camVideo;
  if (v.readyState < 2) { try{ await v.play(); }catch{} }
  const w = v.videoWidth || 1280, h = v.videoHeight || 720;
  const c = document.createElement("canvas");
  const r = cam.rotate;
  if (r===90 || r===270){ c.width=h; c.height=w; } else { c.width=w; c.height=h; }
  const ctx = c.getContext("2d");
  ctx.save();
  if (r===90){ ctx.translate(h,0); ctx.rotate(Math.PI/2); }
  else if (r===180){ ctx.translate(w,h); ctx.rotate(Math.PI); }
  else if (r===270){ ctx.translate(0,w); ctx.rotate(Math.PI*1.5); }
  ctx.drawImage(v,0,0,w,h); ctx.restore();

  const blob = await new Promise(res=> c.toBlob(res, "image/jpeg", 0.9));
  if (!blob) return toast("拍照失败");

  // 本地乐观：先出现一张
  const localURL = URL.createObjectURL(blob);
  const pending={room_id:roomId,author_id:myId,type:"image",content:localURL,created_at:new Date().toISOString()};
  recentSent.add(localURL); renderOne(pending);
  showShotThumb(localURL);

  // 上传 + 发消息
  const path=`${roomId}/${Date.now()}-${Math.random().toString(16).slice(2)}.jpg`;
  const {error}=await supabase.storage.from(BUCKET).upload(path,blob,{contentType:"image/jpeg",upsert:false});
  if(error){ alert("上传失败："+error.message); return; }
  const {data}=supabase.storage.from(BUCKET).getPublicUrl(path);
  recentSent.add(data.publicUrl);
  await supabase.from("messages").insert({room_id:roomId,author_id:myId,type:"image",content:data.publicUrl});
  toast("已拍照并上传");
}

/* 绑定（工具栏 & 面板按钮） */
$("#openCam")?.addEventListener("click", openCamFull);
$("#shot")?.addEventListener("click", shootAndUpload);
$("#closeCam")?.addEventListener("click", closeCam);
$("#shootBtn")?.addEventListener("click", shootAndUpload);
$("#closeCamBtn")?.addEventListener("click", closeCam);

/* 注入“切换镜头/旋转”按钮（不改 HTML） */
(function ensureCamOps(){
  const bar = document.querySelector(".cam-controls");
  if (!bar) return;
  if (!$("#switchCamBtn")) {
    const btn = document.createElement("button");
    btn.id="switchCamBtn"; btn.className="cam-btn"; btn.textContent="切换镜头";
    bar.insertBefore(btn, $("#closeCamBtn")); btn.addEventListener("click", switchCamera);
  }
  if (!$("#rotateCamBtn")) {
    const btn = document.createElement("button");
    btn.id="rotateCamBtn"; btn.className="cam-btn"; btn.textContent="旋转90°";
    bar.insertBefore(btn, $("#closeCamBtn")); btn.addEventListener("click", rotateCamera);
  }
})();

/* 页面隐藏时释放摄像头 */
document.addEventListener("visibilitychange", ()=>{ if (document.hidden) closeCam(); });

/* ===== 全屏查看：左右切换 / 滑动 ===== */
function openViewer(idx){ currentIndex=idx; viewerImg.src=gallery[idx].url; viewer.classList.add("show"); }

viewer.addEventListener("click", e=>{
  // 只点“幕布”才关闭；点图片不关闭
  if (e.target === viewer) viewer.classList.remove("show");
});
// 左右按钮（注入）
(function ensureViewerNav(){
  if (!$("#viewerPrev")){
    const prev=document.createElement("div"); prev.id="viewerPrev";
    Object.assign(prev.style,{position:"fixed",left:"8px",top:"50%",transform:"translateY(-50%)",fontSize:"26px",color:"#fff",padding:"8px",userSelect:"none",zIndex:1000});
    prev.textContent="‹"; viewer.appendChild(prev);
    prev.addEventListener("click", e=>{ e.stopPropagation(); nav(-1); });
  }
  if (!$("#viewerNext")){
    const next=document.createElement("div"); next.id="viewerNext";
    Object.assign(next.style,{position:"fixed",right:"8px",top:"50%",transform:"translateY(-50%)",fontSize:"26px",color:"#fff",padding:"8px",userSelect:"none",zIndex:1000});
    next.textContent="›"; viewer.appendChild(next);
    next.addEventListener("click", e=>{ e.stopPropagation(); nav(1); });
  }
})();
function nav(delta){
  if (currentIndex<0) return; const N=gallery.length; if(!N) return;
  currentIndex=(currentIndex+delta+N)%N; viewerImg.src=gallery[currentIndex].url;
}
// 触摸滑动
let sx=0, sy=0;
viewer.addEventListener("touchstart", e=>{ const t=e.touches[0]; sx=t.clientX; sy=t.clientY; }, {passive:true});
viewer.addEventListener("touchend", e=>{
  const t=e.changedTouches[0]; const dx=t.clientX-sx, dy=t.clientY-sy;
  if (Math.abs(dx)>50 && Math.abs(dy)<80){ nav(dx<0?1:-1); }
}, {passive:true});

/* 点击消息里的图片 → 打开画廊 */
log.addEventListener("click", e=>{
  const a=e.target.closest(".msg a"); if(!a) return;
  e.preventDefault();
  const idx=Number(a.dataset.idx||-1);
  openViewer(idx>=0?idx:0);
});
