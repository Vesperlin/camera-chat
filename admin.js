// === Supabase 项目配置（已替你填好） ===
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const SUPABASE_URL  = "https://rcytjdvqyqbvuyzfcinu.supabase.co";
const SUPABASE_KEY  = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJjeXRqZHZxeXFidnV5emZjaW51Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk1NDc2MzUsImV4cCI6MjA3NTEyMzYzNX0.RyG8f5IL_Yt0UL_rsrP7UILncM9Ek4TMIYq1dr2Zb-U";
const BUCKET        = "photos";

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

// === DOM ===
const $ = s => document.querySelector(s);
const feed = $("#feed");
let roomId = new URL(location.href).searchParams.get("room") || "vesper1";
$("#room").value = roomId;

let ch = null;

// === 工具 ===
const toast = (t)=>{ console.log(t); };
const fmt = (iso)=> new Date(iso).toLocaleString();

// === 房间持久化 (rooms 表) ===
async function ensureRoom() {
  // upsert rooms(id, ocr_enabled)
  const { error } = await sb.from("rooms").upsert({ id: roomId, ocr_enabled: $("#ocr").checked }, { onConflict:"id" });
  if (error) alert("保存房间失败："+error.message);
}

// === 构造 角色B 链接 ===
function buildBLink() {
  // 假设你的 GitHub Pages 根目录里放了 b.html
  const base = location.origin + location.pathname.replace(/admin\.html$/,"");
  const url  = `${base}b.html?room=${encodeURIComponent(roomId)}`;
  $("#bLink").value = url;
}
buildBLink();

// === 历史 + 订阅 ===
async function loadHistory() {
  const { data, error } = await sb.from("messages")
    .select("*").eq("room_id", roomId).order("created_at",{ascending:true}).limit(500);
  if (error) { alert(error.message); return; }
  feed.innerHTML = "";
  for (const m of data) render(m);
}
function sub() {
  if (ch) sb.removeChannel(ch);
  ch = sb.channel("r:"+roomId).on("postgres_changes", {
    event:"INSERT", schema:"public", table:"messages", filter:`room_id=eq.${roomId}`
  }, (p)=>render(p.new)).subscribe();
}
function render(m) {
  const box = document.createElement("div");
  box.className = "msg";
  const who = m.author_id || "未知";
  box.innerHTML = `<small>${fmt(m.created_at)} · ${who} · ${m.type}</small>`;
  if (m.type === "image") {
    const img = document.createElement("img"); img.src = m.content; box.appendChild(img);
  } else {
    const p = document.createElement("div"); p.textContent = m.content; box.appendChild(p);
  }
  // 点击复用
  box.onclick = async ()=>{
    if (m.type === "text") {
      await sb.from("messages").insert({ room_id:roomId, author_id:"控制台", type:"text", content:m.content });
    } else if (m.type === "image") {
      await sb.from("messages").insert({ room_id:roomId, author_id:"控制台", type:"image", content:m.content });
    }
  };
  feed.appendChild(box);
  feed.scrollTop = feed.scrollHeight;
}

// === 事件 ===
$("#create").onclick = async ()=>{
  roomId = $("#room").value.trim() || roomId;
  buildBLink();
  await loadHistory(); sub();
};
$("#saveRoom").onclick = async ()=>{
  await ensureRoom();
  alert("房间参数已保存");
};
$("#copyB").onclick = ()=> { navigator.clipboard.writeText($("#bLink").value); alert("已复制角色B链接"); };
$("#openB").onclick = ()=> window.open($("#bLink").value, "_blank");

$("#tpl").value = ["[状态] 我已到达","[系统] 已拍照并上传","[表单] 姓名=；数量=；备注="].join("\n");
$("#sendTpl").onclick = async ()=>{
  const lines = $("#tpl").value.split("\n").map(s=>s.trim()).filter(Boolean);
  for (const t of lines) {
    await sb.from("messages").insert({ room_id:roomId, author_id:"控制台", type:"text", content:t });
  }
};

// 初始加载
loadHistory(); sub();
