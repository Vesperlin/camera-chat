import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://YOUR-PROJECT.supabase.co";
const SUPABASE_ANON_KEY = "YOUR-ANON-KEY";
const BUCKET = "photos";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// 本地 ID 用于左右区分
const myId = (() => {
  const k = "clientId";
  let v = localStorage.getItem(k);
  if (!v) {
    v = crypto.randomUUID();
    localStorage.setItem(k, v);
  }
  return v;
})();

const $ = s => document.querySelector(s);
let roomId = new URL(location.href).searchParams.get("room") || "";
if (roomId) $("#room").value = roomId;

let dbChannel = null;
let lastTime = 0;

// 加入房间
$("#join").onclick = async () => {
  roomId = $("#room").value.trim() || crypto.randomUUID().slice(0, 8);
  const url = new URL(location.href);
  url.searchParams.set("room", roomId);
  history.replaceState(null, "", url);
  await loadHistory();
  subscribeRealtime();
};

// 加载历史消息
async function loadHistory() {
  const { data } = await supabase.from("messages")
    .select("*").eq("room_id", roomId)
    .order("created_at", { ascending: true }).limit(300);
  $("#log").innerHTML = "";
  data.forEach(renderMessage);
}

// 订阅实时消息
function subscribeRealtime() {
  if (dbChannel) supabase.removeChannel(dbChannel);
  dbChannel = supabase.channel("room:" + roomId)
    .on("postgres_changes", {
      event: "INSERT",
      schema: "public",
      table: "messages",
      filter: `room_id=eq.${roomId}`,
    }, payload => renderMessage(payload.new))
    .subscribe();
}

// 渲染消息
function renderMessage(m) {
  const log = $("#log");

  // 插入时间分隔
  const t = new Date(m.created_at).getTime();
  if (t - lastTime > 5 * 60 * 1000) {
    const divider = document.createElement("div");
    divider.className = "time-divider";
    divider.textContent = new Date(m.created_at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
    log.appendChild(divider);
    lastTime = t;
  }

  const msg = document.createElement("div");
  msg.className = "msg " + (m.author_id === myId ? "self" : "peer");

  if (m.type === "image") {
    const img = document.createElement("img");
    img.src = m.content;
    img.className = "thumb";
    img.onclick = () => showImage(m.content);
    msg.appendChild(img);
  } else {
    const p = document.createElement("p");
    p.textContent = m.content;
    msg.appendChild(p);
  }

  log.appendChild(msg);
  log.scrollTop = log.scrollHeight;

  // 蓝牙朗读
  if ($("#ttsToggle").checked && m.author_id !== myId && m.type === "text") {
    const u = new SpeechSynthesisUtterance(m.content);
    u.lang = "zh-CN";
    speechSynthesis.speak(u);
  }
}

// 发送文字
$("#send").onclick = async () => {
  const text = $("#text").value.trim();
  if (!text) return;
  $("#text").value = "";
  await supabase.from("messages").insert({
    room_id: roomId,
    author_id: myId,
    type: "text",
    content: text,
  });
};

// 上传图片
$("#sheetPhoto").onclick = async () => {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.onchange = async () => {
    const file = input.files[0];
    const fname = `${roomId}/${Date.now()}-${file.name}`;
    await supabase.storage.from(BUCKET).upload(fname, file, { upsert: false });
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(fname);
    await supabase.from("messages").insert({
      room_id: roomId,
      author_id: myId,
      type: "image",
      content: data.publicUrl,
    });
  };
  input.click();
};

// 相机模式
let stream = null;
$("#sheetCamera").onclick = async () => {
  $("#camPane").classList.add("show");
  stream = await navigator.mediaDevices.getUserMedia({ video: true });
  $("#camView").srcObject = stream;
  $("#camView").play();
};

$("#closeCamBtn").onclick = () => {
  stream?.getTracks().forEach(t => t.stop());
  $("#camPane").classList.remove("show");
};

$("#shootBtn").onclick = async () => {
  const video = $("#camView");
  const c = document.createElement("canvas");
  c.width = video.videoWidth;
  c.height = video.videoHeight;
  c.getContext("2d").drawImage(video, 0, 0);
  const blob = await new Promise(r => c.toBlob(r, "image/jpeg", 0.9));
  const fname = `${roomId}/${Date.now()}.jpg`;
  await supabase.storage.from(BUCKET).upload(fname, blob);
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(fname);
  await supabase.from("messages").insert({
    room_id: roomId,
    author_id: myId,
    type: "image",
    content: data.publicUrl,
  });
  toast("已拍照并发送");
};

// 小功能
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 1500);
}

function showImage(url) {
  $("#viewer img").src = url;
  $("#viewer").classList.add("show");
}
$("#viewer").onclick = () => $("#viewer").classList.remove("show");
