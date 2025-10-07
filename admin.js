import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./sb-config.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const $ = s=>document.querySelector(s);
let roomId = "";
let watchChan = null;
const BUCKET = "photos";                                   // ←你的桶

/** 房间&OCR 配置保存在 rooms 表 */
$("#createRoom").onclick = async ()=>{
  roomId = $("#roomId").value.trim() || crypto.randomUUID().slice(0,8);
  const ocr = $("#ocrToggle").checked;
  const { error } = await supabase.from("rooms")
    .upsert({ id:roomId, ocr_enabled:ocr }, { onConflict:"id" });
  if(error) return alert(error.message);
  alert("房间已创建/更新："+roomId);
};

$("#closeRoom").onclick = async ()=>{
  roomId = $("#roomId").value.trim();
  if(!roomId) return alert("先填房间ID");
  const { error } = await supabase.from("rooms").delete().eq("id",roomId);
  if(error) return alert(error.message);
  alert("已关闭房间");
};

/** 分发链接 */
function copy(s){ navigator.clipboard.writeText(s); alert("已复制："+s); }
const base = location.origin + location.pathname.replace(/admin\.html$/,"index.html");
$("#linkA").onclick=()=>{ roomId = $("#roomId").value.trim(); if(!roomId) return alert("先填房间ID"); copy(`${base}?room=${roomId}&role=A`); };
$("#linkB").onclick=()=>{ roomId = $("#roomId").value.trim(); if(!roomId) return alert("先填房间ID"); copy(`${base}?room=${roomId}&role=B`); };
$("#linkC").onclick=()=>{ roomId = $("#roomId").value.trim(); if(!roomId) return alert("先填房间ID"); copy(`${base}?room=${roomId}&role=C`); };

/** 模板：存 templates 表 */
$("#saveTpl").onclick = async ()=>{
  roomId = $("#roomId").value.trim(); if(!roomId) return alert("先填房间ID");
  const lines = $("#tplArea").value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  const { error } = await supabase.from("templates").upsert({ room_id:roomId, body:lines }, { onConflict:"room_id" });
  if(error) alert(error.message); else alert("已保存");
};
$("#loadTpl").onclick = async ()=>{
  roomId = $("#roomId").value.trim(); if(!roomId) return alert("先填房间ID");
  const { data, error } = await supabase.from("templates").select("*").eq("room_id",roomId).single();
  if(error || !data) return alert("尚无模板");
  $("#tplArea").value = (data.body||[]).join("\n");
};

/** 监听房间消息 */
$("#startWatch").onclick = async ()=>{
  roomId = $("#roomId").value.trim(); if(!roomId) return alert("先填房间ID");
  $("#watchList").innerHTML = "";
  if(watchChan) supabase.removeChannel(watchChan);
  const add = (m)=>{
    const d = document.createElement("div"); d.className="msg";
    d.innerHTML = m.type==="image"
      ? `<img src="${m.content}"><span>${m.author_id.slice(0,6)} · 图片</span>`
      : `<span class="mono">${m.author_id.slice(0,6)}</span><span>${m.content}</span>`;
    $("#watchList").appendChild(d);
  };
  // 历史
  const { data } = await supabase.from("messages").select("*").eq("room_id",roomId).order("created_at",{ascending:true}).limit(200);
  data?.forEach(add);
  // 实时
  watchChan = supabase.channel("watch:"+roomId)
    .on("postgres_changes",{event:"INSERT",schema:"public",table:"messages",filter:`room_id=eq.${roomId}`}, p=>add(p.new))
    .subscribe();
};
$("#stopWatch").onclick = ()=>{ if(watchChan) supabase.removeChannel(watchChan); watchChan=null; };

$("#exportJson").onclick = async ()=>{
  roomId = $("#roomId").value.trim(); if(!roomId) return alert("先填房间ID");
  const { data } = await supabase.from("messages").select("*").eq("room_id",roomId).order("created_at",{ascending:true}).limit(1000);
  const blob = new Blob([JSON.stringify(data||[],null,2)],{type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href=url; a.download=`room_${roomId}.json`; a.click(); URL.revokeObjectURL(url);
};
