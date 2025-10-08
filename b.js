import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const SUPABASE_URL  = "https://rcytjdvqyqbvuyzfcinu.supabase.co";
const SUPABASE_KEY  = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJjeXRqZHZxeXFidnV5emZjaW51Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk1NDc2MzUsImV4cCI6MjA3NTEyMzYzNX0.RyG8f5IL_Yt0UL_rsrP7UILncM9Ek4TMIYq1dr2Zb-U";
const BUCKET        = "photos";
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

const $ = s=>document.querySelector(s);
const log = $("#log");
const roomId = new URL(location.href).searchParams.get("room") || "vesper1";
$("#rid").textContent = roomId;

const myId = "角色B";

// 模板（显眼）
const TPLS = ["[状态] 我已到达","[状态] 我已离开","[系统] 我已拍照并上传","[表单] 姓名=；数量=；备注="];
const tplList = $("#tplList");
TPLS.forEach(t=>{
  const b = document.createElement("button");
  b.className="chip"; b.textContent=t;
  b.onclick = ()=> sendText(t);
  tplList.appendChild(b);
});

// 渲染
function render(m, isHistory=false){
  const row = document.createElement("div");
  row.className = "row " + (m.author_id===myId ? "self":"peer");
  const b = document.createElement("div"); b.className = "msg";
  if (m.type==="image"){
    const img = document.createElement("img"); img.src=m.content; b.appendChild(img);
  }else{
    b.textContent = m.content;
  }
  row.appendChild(b); log.appendChild(row);
  if(!isHistory) log.scrollTop = log.scrollHeight;
}

// 历史
const hist = await sb.from("messages").select("*").eq("room_id",roomId).order("created_at",{ascending:true});
if(!hist.error) hist.data.forEach(m=>render(m, true));

// 实时
sb.channel("r:"+roomId).on("postgres_changes",{
  event:"INSERT", schema:"public", table:"messages", filter:`room_id=eq.${roomId}`
}, (p)=>render(p.new)).subscribe();

// 文字
async function sendText(v){
  if(!v) return;
  $("#text").value="";
  const { error } = await sb.from("messages").insert({ room_id:roomId, author_id:myId, type:"text", content:v });
  if(error) alert(error.message);
}
$("#send").onclick = ()=> sendText($("#text").value.trim());
$("#text").addEventListener("keydown", e=>{ if(e.key==="Enter") $("#send").click(); });

// 上传文件
$("#up").onclick = ()=> $("#file").click();
$("#file").onchange = async ()=>{
  const f = $("#file").files[0]; if(!f) return;
  const path = `${roomId}/${Date.now()}-${encodeURIComponent(f.name)}`;
  const { error } = await sb.storage.from(BUCKET).upload(path, f, { upsert:false });
  if(error) return alert(error.message);
  const { data } = sb.storage.from(BUCKET).getPublicUrl(path);
  await sb.from("messages").insert({ room_id:roomId, author_id:myId, type:"image", content:data.publicUrl });
};

// 相机（移动端会调起系统相机）
$("#cam").onclick = ()=>{
  const input = document.createElement("input");
  input.type="file"; input.accept="image/*"; input.capture="environment";
  input.onchange = async ()=>{
    const f = input.files[0]; if(!f) return;
    const path = `${roomId}/${Date.now()}-cam.jpg`;
    const { error } = await sb.storage.from(BUCKET).upload(path, f, { upsert:false, contentType:"image/jpeg" });
    if(error) return alert(error.message);
    const { data } = sb.storage.from(BUCKET).getPublicUrl(path);
    await sb.from("messages").insert({ room_id:roomId, author_id:myId, type:"image", content:data.publicUrl });
  };
  input.click();
};
