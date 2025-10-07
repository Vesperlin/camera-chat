import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./sb-config.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ---------- DOM ---------- */
const $ = s => document.querySelector(s);
const toast = (t) => {
  const el = $("#toast");
  el.textContent = t;
  el.classList.add("show");
  setTimeout(()=>el.classList.remove("show"), 1200);
};

let currentRoom = null;
let sub = null;

/* ---------- 生成角色链接 ---------- */
function buildRoleLinks(roomId){
  const base = location.origin + location.pathname.replace(/admin\.html$/,"index.html");
  const A = `${base}?room=${encodeURIComponent(roomId)}&role=A`;
  const B = `${base}?room=${encodeURIComponent(roomId)}&role=B`;
  const C = `${base}?room=${encodeURIComponent(roomId)}&role=C`;
  $("#links").innerHTML = `
    <div>当前房间：<span class="badge">${roomId}</span></div>
    <div style="margin-top:6px">
      <a href="${A}" target="_blank">A 链接</a>
      <a href="${B}" target="_blank">B 链接</a>
      <a href="${C}" target="_blank">C 链接</a>
    </div>`;
  $("#copyA").onclick = ()=>{ navigator.clipboard.writeText(A); toast("已复制 A 链接"); };
  $("#copyB").onclick = ()=>{ navigator.clipboard.writeText(B); toast("已复制 B 链接"); };
  $("#copyC").onclick = ()=>{ navigator.clipboard.writeText(C); toast("已复制 C 链接"); };
}

/* ---------- 创建/加载 房间 ---------- */
async function createOrLoadRoom(){
  let rid = $("#roomId").value.trim();
  if(!rid) rid = crypto.randomUUID().slice(0,8);
  const ocrEnabled = $("#ocrSel").value === "true";

  // upsert rooms
  const { error } = await supabase.from("rooms")
    .upsert({ id: rid, ocr_enabled: ocrEnabled })
    .select().single();
  if(error){ alert("创建/加载房间失败："+error.message); return; }

  currentRoom = rid;
  $("#roomId").value = rid;
  buildRoleLinks(rid);
  toast("房间就绪");

  // 载入模板
  loadTemplates();
  // 订阅
  subLive();
}

/* ---------- 模板 ---------- */
async function loadTemplates(){
  if(!currentRoom) return;
  const { data, error } = await supabase.from("templates")
    .select("body").eq("room_id", currentRoom).maybeSingle();
  if(error){ console.warn(error.message); return; }
  const arr = data?.body || [];
  $("#tplBox").value = arr.join("\n");
}
async function saveTemplates(){
  if(!currentRoom) return alert("请先创建/加载房间");
  const lines = $("#tplBox").value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  const { error } = await supabase.from("templates")
    .upsert({ room_id: currentRoom, body: lines });
  if(error){ alert("保存失败："+error.message); return; }
  toast("模板已保存");
}

/* ---------- 实时监控 ---------- */
function renderOne(m){
  const li = document.createElement("div");
  li.textContent = `[${m.created_at?.slice(11,19)||"--:--:--"}] ${m.author_id?.slice(0,8)||"anon"} | ${m.type} | ${m.content}`;
  $("#liveList").prepend(li);
}
async function loadRecent(){
  if(!currentRoom) return;
  const { data, error } = await supabase.from("messages")
    .select("*").eq("room_id", currentRoom).order("created_at",{ascending:false}).limit(50);
  if(error){ console.warn(error.message); return; }
  $("#liveList").innerHTML = "";
  data.reverse().forEach(renderOne);
}
function subLive(){
  if(sub) supabase.removeChannel(sub);
  if(!currentRoom) return;
  loadRecent();
  sub = supabase.channel("admin:"+currentRoom)
    .on("postgres_changes",
      { event:"INSERT", schema:"public", table:"messages", filter:`room_id=eq.${currentRoom}` },
      payload => renderOne(payload.new)
    ).subscribe();
}

/* ---------- 导出/清空/删除 ---------- */
async function fetchAll(){
  const { data, error } = await supabase.from("messages")
    .select("*").eq("room_id", currentRoom).order("created_at",{ascending:true});
  if(error) throw new Error(error.message);
  return data || [];
}
function download(filename, text, type="application/json"){
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text],{type}));
  a.download = filename; a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href), 1000);
}

$("#exportJson").onclick = async ()=>{
  if(!currentRoom) return;
  const rows = await fetchAll();
  download(`room-${currentRoom}.json`, JSON.stringify(rows,null,2));
};
$("#exportCsv").onclick = async ()=>{
  if(!currentRoom) return;
  const rows = await fetchAll();
  const head = ["id","room_id","author_id","type","content","created_at"];
  const csv = [head.join(",")].concat(
    rows.map(r=> head.map(k=>{
      const v = r[k] ?? "";
      return `"${String(v).replace(/"/g,'""')}"`;
    }).join(","))
  ).join("\n");
  download(`room-${currentRoom}.csv`, csv, "text/csv");
};
$("#clearMsg").onclick = async ()=>{
  if(!currentRoom) return;
  if(!confirm("确定清空该房间的消息？此操作不可撤销。")) return;
  const { error } = await supabase.from("messages").delete().eq("room_id", currentRoom);
  if(error){ alert(error.message); return; }
  $("#liveList").innerHTML = "";
  toast("已清空消息");
};
$("#deleteRoom").onclick = async ()=>{
  if(!currentRoom) return;
  if(!confirm("确定删除房间（含模板与消息）？不可撤销。")) return;
  await supabase.from("messages").delete().eq("room_id", currentRoom);
  await supabase.from("templates").delete().eq("room_id", currentRoom);
  const { error } = await supabase.from("rooms").delete().eq("id", currentRoom);
  if(error){ alert(error.message); return; }
  currentRoom=null; if(sub) supabase.removeChannel(sub);
  $("#links").textContent = "未选择房间"; $("#tplBox").value = ""; $("#liveList").innerHTML = "";
  toast("已删除房间");
};

/* ---------- 事件绑定 ---------- */
$("#createRoom").onclick = createOrLoadRoom;
$("#saveTpl").onclick = saveTemplates;
$("#loadTpl").onclick = loadTemplates;

/* 支持从 URL 中 ?room=xxx 直接打开房间 */
{
  const rid = new URL(location.href).searchParams.get("room");
  if(rid){
    $("#roomId").value = rid;
    createOrLoadRoom();
  }
}
