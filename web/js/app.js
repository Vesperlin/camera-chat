// ========================================
// 路径: /web/js/app.js
// 说明: B端构建“语文”模板的分节表单；发送到 A 端；C 端轮询展示分页
// ========================================
const $ = s => document.querySelector(s);
const log = (t) => { const p=$('#log'); p.textContent=(p.textContent? p.textContent+'\n':'')+t; };
const a = () => $('#aurl').value.replace(/\/+$/,'');
const roleSel = $('#role');
const bPanel = $('#bPanel'); const cPanel = $('#cPanel');

const SECTIONS = {
  // 依据你的描述固定结构
  A: { name:'㈠ 现代文阅读', items:[
    { type:'choice', label:'1～3（选择题）', count:3 },             // {} {} {}
    { type:'blank',  label:'4.（填空）', count:1 },                  // ___
    { type:'blank',  label:'5.（填空）', count:1 }                   // ___
  ]},
  B: { name:'㈡ 记叙文', items:[
    { type:'choice', label:'6～7（选择题）', count:2 },
    { type:'blank',  label:'8.（填空）', count:1 },
    { type:'blank',  label:'9.（填空）', count:1 }
  ]},
  C: { name:'㈢ 文言文', items:[
    { type:'choice', label:'10～12（选择题）', count:3 },
    { type:'blank',  label:'13（⑴/⑵）', count:2, sublabels:['⑴','⑵'] },
    { type:'blank',  label:'14.（填空）', count:1 }
  ]},
  D: { name:'㈣ 诗词', items:[
    { type:'choice', label:'15（选择题）', count:1 },
    { type:'blank',  label:'16.（填空）', count:1 }
  ]},
  E: { name:'㈤ 默写', items:[
    { type:'blank',  label:'17（⑴/⑵/⑶）', count:3, sublabels:['⑴','⑵','⑶'] }
  ]},
  F: { name:'㈥ 语言文字运用', items:[
    { type:'free',   label:'自由填写（可长文）' }
  ]}
};

// ========== 公共 ==========
$('#btnPing').onclick = async () => {
  try{
    const r = await fetch(a()+'/ping'); log('PING: '+await r.text());
  }catch(e){ log('ERR: '+e.message); }
};

roleSel.onchange = () => {
  const isB = roleSel.value==='B';
  bPanel.style.display = isB? 'block':'none';
  cPanel.style.display = isB? 'none':'block';
};

// ========== B 端：构建分节表单 ==========
let currentSec = 'A';
for (const btn of document.querySelectorAll('.secbtn')){
  btn.onclick = () => { currentSec = btn.dataset.sec; buildForm(currentSec); };
}
function buildForm(secKey){
  const box = $('#formBox'); box.innerHTML='';
  const sec = SECTIONS[secKey];
  const title = document.createElement('div');
  title.className='small'; title.textContent='当前分节：'+sec.name;
  box.appendChild(title);

  sec.items.forEach((it, idx) => {
    const wrap = document.createElement('div'); wrap.className='q';
    const h = document.createElement('h3'); h.textContent = `${sec.name} · ${it.label}`;
    wrap.appendChild(h);

    if (it.type==='choice'){
      const row = document.createElement('div'); row.className='optRow';
      for(let i=0;i<it.count;i++){
        const sel = document.createElement('select'); sel.name=`q_${idx}_${i}`;
        ['','A','B','C','D'].forEach(v=>{
          const o=document.createElement('option'); o.value=v; o.textContent=v===''?'未选':v; sel.appendChild(o);
        });
        row.appendChild(sel);
      }
      wrap.appendChild(row);
    }
    if (it.type==='blank'){
      for(let i=0;i<it.count;i++){
        const lab = document.createElement('div'); lab.className='small';
        const tag = (it.sublabels && it.sublabels[i]) ? it.sublabels[i] : `(${i+1})`;
        lab.textContent=`填写 ${tag}`;
        const inp = document.createElement('textarea'); inp.name=`q_${idx}_${i}`; inp.rows=2;
        wrap.appendChild(lab); wrap.appendChild(inp);

        // 可选图片上传 + OCR
        const fr = document.createElement('div'); fr.className='fileRow';
        const file = document.createElement('input'); file.type='file'; file.accept='image/*';
        const btnOcr = document.createElement('button'); btnOcr.type='button'; btnOcr.textContent='OCR 识别';
        btnOcr.onclick = async ()=>{
          const f = file.files && file.files[0]; if(!f){ alert('先选择图片'); return; }
          // 占位：直接把提示发到 A 端 /ocr，让 A 端返回文本（当前 A 端为占位返回）
          try{
            const fd = new FormData(); fd.append('image', f, f.name);
            const r = await fetch(a()+'/ocr', { method:'POST', body:fd });
            const j = await r.json(); if(j && j.text){ inp.value = (inp.value? (inp.value+'\n'):'') + j.text; }
          }catch(e){ alert('OCR 调用失败: '+e.message); }
        };
        fr.appendChild(file); fr.appendChild(btnOcr); wrap.appendChild(fr);
      }
    }
    if (it.type==='free'){
      const inp = document.createElement('textarea'); inp.name=`q_${idx}_0`; inp.rows=6; wrap.appendChild(inp);
      const fr = document.createElement('div'); fr.className='fileRow';
      const file = document.createElement('input'); file.type='file'; file.accept='image/*';
      fr.appendChild(file); wrap.appendChild(fr);
    }
    box.appendChild(wrap);
  });
}
buildForm(currentSec);

$('#btnReset').onclick = ()=> buildForm(currentSec);

$('#btnSend').onclick = async (e)=>{
  e.preventDefault();
  const sec = SECTIONS[currentSec];
  // 采集
  const data = { subject:'语文', section: currentSec, sectionName: sec.name, payload:[] };
  const form = $('#formBox');
  sec.items.forEach((it, idx)=>{
    if (it.type==='choice'){
      const arr = Array.from(form.querySelectorAll(`select[name^="q_${idx}_"]`)).map(s=>s.value||'');
      data.payload.push({type:'choice', label:it.label, values:arr});
    }else if (it.type==='blank'){
      const arr = Array.from(form.querySelectorAll(`textarea[name^="q_${idx}_"]`)).map(t=>t.value||'');
      data.payload.push({type:'blank', label:it.label, values:arr});
    }else if (it.type==='free'){
      const v = form.querySelector(`textarea[name="q_${idx}_0"]`).value||'';
      data.payload.push({type:'free', label:it.label, value:v});
    }
  });

  try{
    const r = await fetch(a()+'/template/set',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
    const j = await r.json(); if(j.ok){ log('已发送：'+sec.name); }
    else{ log('发送失败'); }
  }catch(e){ log('ERR: '+e.message); }
};

// ========== C 端：轮询展示 ==========
let pages = []; let idx = 0; let timer = null;

function renderPage(){
  const v = $('#viewer'); const info = $('#pageInfo');
  if (pages.length===0){ v.innerHTML='<div class="small">尚无填写内容</div>'; info.textContent='0/0'; return; }
  const pg = pages[idx];
  info.textContent=`${idx+1}/${pages.length} · ${pg.sectionName}`;
  const html = pg.payload.map(block=>{
    if (block.type==='choice'){
      const show = block.values.map((x,i)=>`(${i+1}) ${x||'未选'}`).join('  ');
      return `<div class="q"><h3>${block.label}</h3><div>${show}</div></div>`;
    }else if (block.type==='blank'){
      const show = block.values.map((x,i)=>`(${i+1}) ${x?escapeHtml(x):'<span class="small">空</span>'}`).join('<br>');
      return `<div class="q"><h3>${block.label}</h3><div>${show}</div></div>`;
    }else{
      return `<div class="q"><h3>${block.label}</h3><div>${escapeHtml(block.value||'')}</div></div>`;
    }
  }).join('');
  v.innerHTML = `<div class="small">${pg.sectionName}</div>${html}`;
}
function escapeHtml(s){ return s.replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

$('#prev').onclick = ()=>{ if(pages.length){ idx=(idx-1+pages.length)%pages.length; renderPage(); } };
$('#next').onclick = ()=>{ if(pages.length){ idx=(idx+1)%pages.length; renderPage(); } };

async function poll(){
  try{
    const r = await fetch(a()+'/template/get?subject='+encodeURIComponent('语文')+'&_='+Date.now());
    const j = await r.json();
    if (j.ok && Array.isArray(j.pages)){
      // 固定按模板顺序排序：A..F
      const order = ['A','B','C','D','E','F'];
      j.pages.sort((x,y)=> order.indexOf(x.section)-order.indexOf(y.section));
      pages = j.pages;
      if (idx>=pages.length) idx = pages.length? pages.length-1:0;
      renderPage();
    }
  }catch(e){ /* 忽略短暂错误 */ }
}

function startPoll(){
  if (timer) clearInterval(timer);
  poll(); timer = setInterval(poll, 2000);
}

roleSel.dispatchEvent(new Event('change')); // 初始化角色显示
startPoll();
