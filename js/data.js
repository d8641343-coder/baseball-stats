/* ───────── 版本(每次發布前更新此處) ───────── */
const APP_VERSION = "v1.1.0 · 2026-07-09";

/* ───────── 狀態與儲存 ───────── */
let state = { teamName:"親子勇士", eraBases:{U12:6,U15:7,"其他":9}, players:[], games:[], honors:[], scouts:[] };
let win = { overview:"all", batting:"all", pitching:"all" };
let lvl = "all";
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,6);

/* ───────── 權限系統 ───────── */
function getP(id){ return state.players.find(p=>p.id===id); }
function playerName(id){ const p = getP(id); return p ? p.name : "（已移除）"; }
/* ── 照片處理（支援 JPG/PNG/HEIC/HEIF，自動壓縮） ── */
const f3 = v => isFinite(v) ? v.toFixed(3).replace(/^0\./,".") : "-";
const f2 = v => isFinite(v) ? v.toFixed(2) : "-";
function ipStr(outs){ return Math.floor(outs/3) + (outs%3 ? "."+outs%3 : ".0"); }
function parseIP(s){
  const m = String(s).trim().match(/^(\d+)(?:\.([012]))?$/);
  if(!m) return null;
  return parseInt(m[1])*3 + (m[2]?parseInt(m[2]):0);
}
function esc(s){ return String(s??"").replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function normDate(s){
  const m = String(s).trim().replace(/\//g,"-").match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if(!m) return null;
  return `${m[1]}-${m[2].padStart(2,"0")}-${m[3].padStart(2,"0")}`;
}
function sortedGames(){ return [...state.games].sort((a,b)=> a.date.localeCompare(b.date) || (a.created||0)-(b.created||0)); }
function lvlGames(){ return sortedGames().filter(g => lvl==="all" || (g.level||"U12")===lvl); }
function windowGames(w){
  const g = lvlGames();
  return w==="all" ? g : g.slice(-Number(w));
}
function gameResult(g){ return g.us>g.them ? "W" : g.us<g.them ? "L" : "T"; }
function mvpCounts(pid){
  let mvp=0, svp=0;
  state.games.forEach(g => { if(g.mvp===pid) mvp++; if(g.svp===pid) svp++; });
  const ai = state.honors.filter(h => (h.pitcher&&h.pitcher.pid===pid)||(h.fielder&&h.fielder.pid===pid));
  return {mvp, svp, ai};
}

/* ───────── 頁首記分板 ───────── */
function loadHeicLib(){
  return new Promise(res=>{
    if(typeof heic2any !== "undefined") return res();
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/heic2any/0.0.4/heic2any.min.js";
    s.onload = res; s.onerror = res;
    document.head.appendChild(s);
  });
}
async function fileToDataURL(file, maxSize, quality){
  let blob = file;
  const isHeic = /\.(heic|heif)$/i.test(file.name) || /heic|heif/i.test(file.type||"");
  if(isHeic){
    await loadHeicLib();
    if(typeof heic2any === "undefined") throw new Error("heic-unsupported");
    blob = await heic2any({blob:file, toType:"image/jpeg", quality:0.85});
    if(Array.isArray(blob)) blob = blob[0];
  }
  const objUrl = URL.createObjectURL(blob);
  try{
    const img = await new Promise((res,rej)=>{
      const i = new Image();
      i.onload = ()=>res(i); i.onerror = ()=>rej(new Error("decode"));
      i.src = objUrl;
    });
    const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.width*scale));
    c.height = Math.max(1, Math.round(img.height*scale));
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", quality);
  }finally{ URL.revokeObjectURL(objUrl); }
}
function photoErrMsg(e){
  return e && e.message==="heic-unsupported"
    ? "此瀏覽器無法轉換 HEIC/HEIF，請改選 JPG/PNG，或先在手機相簿轉存"
    : "照片處理失敗，請改用 JPG/PNG 或較小的檔案";
}
let pendingAvatar = "";
async function pickAvatarFile(input){
  const f = input.files[0]; input.value=""; if(!f) return;
  try{
    pendingAvatar = await fileToDataURL(f, 256, 0.82);
    document.getElementById("pPhotoState").textContent = "✅ 已選擇照片";
    document.getElementById("pPhoto").value = "";
  }catch(e){ pendingAvatar=""; toast(photoErrMsg(e)); }
}
async function uploadAvatarFor(input, pid){
  if(!guardEdit()) return;
  const f = input.files[0]; input.value=""; if(!f) return;
  const p = getP(pid); if(!p) return;
  try{
    p.photo = await fileToDataURL(f, 256, 0.82);
    save(); renderAll(); openProfile(pid); toast("大頭照已更新");
  }catch(e){ toast(photoErrMsg(e)); }
}
async function uploadMediaFile(input, gid){
  if(!guardEdit()) return;
  const f = input.files[0]; input.value=""; if(!f) return;
  const g = state.games.find(x=>x.id===gid); if(!g) return;
  try{
    const d = await fileToDataURL(f, 900, 0.72);
    g.media.push({url:d, cap:document.getElementById("mc-"+gid).value.trim()});
    save(); renderAll(); openCard(gid); toast("照片已加入");
  }catch(e){ toast(photoErrMsg(e)); }
}
async function save(){
  if(!canEdit()) return;
  const json = JSON.stringify(state);
  if(json.length > 4500000) toast("⚠️ 資料量接近儲存上限，建議刪除部分上傳照片、改用相簿連結");
  try{ await window.storage.set("warriors-data", json, true); }
  catch(e){ console.error("儲存失敗", e); toast("儲存失敗，請檢查網路後重試"); }
}
async function load(){
  try{
    const r = await window.storage.get("warriors-data", true);
    if(r && r.value){ state = Object.assign(state, JSON.parse(r.value)); return; }
  }catch(e){}
  // 搬遷舊的個人資料（第一次啟用共用模式）
  for(const key of ["warriors-data","team-data"]){
    try{
      const old = await window.storage.get(key);
      if(old && old.value){
        const d = JSON.parse(old.value);
        state = Object.assign(state, d, {teamName:"親子勇士"});
        state.honors = state.honors||[]; state.scouts = state.scouts||[];
        state.players.forEach(p=>{ p.level = p.level||"U12"; p.photo = p.photo||""; });
        state.games.forEach(g=>{ g.level = g.level||"U12"; });
        if(canEdit()) await window.storage.set("warriors-data", JSON.stringify(state), true);
        return;
      }
    }catch(e){}
  }
}

/* ───────── 工具 ───────── */
function addPlayer(){
  if(!guardEdit()) return;
  const name = document.getElementById("pName").value.trim();
  if(!name) return toast("請輸入球員姓名");
  state.players.push({id:uid(), name,
    num:document.getElementById("pNum").value.trim(),
    pos:document.getElementById("pPos").value.trim(),
    level:document.getElementById("pLvl").value,
    throws:document.getElementById("pThrows").value,
    bats:document.getElementById("pBats").value,
    photo: pendingAvatar || document.getElementById("pPhoto").value.trim()});
  ["pName","pNum","pPos","pPhoto"].forEach(i=>document.getElementById(i).value="");
  document.getElementById("pThrows").value=""; document.getElementById("pBats").value="";
  pendingAvatar = ""; document.getElementById("pPhotoState").textContent = "";
  save(); renderAll(); toast("已加入 "+name);
}
function delPlayer(id){
  if(!guardEdit()) return;
  const used = state.games.some(g => (g.batting||[]).some(l=>l.pid===id) || (g.pitching||[]).some(l=>l.pid===id));
  if(!confirm(used?"此球員已有比賽數據，移除後數據仍保留但顯示為（已移除）。確定移除？":"確定移除此球員？")) return;
  state.players = state.players.filter(p=>p.id!==id);
  save(); renderAll();
}
function addGame(){
  if(!guardEdit()) return;
  const date = document.getElementById("gDate").value;
  const opp = document.getElementById("gOpp").value.trim();
  if(!date || !opp) return toast("請填日期與對手");
  state.games.push({ id:uid(), created:Date.now(), date, opp,
    level:document.getElementById("gLvl").value,
    tour:document.getElementById("gTour").value.trim(),
    coach:document.getElementById("gCoach").value.trim(),
    us:Number(document.getElementById("gUs").value)||0,
    them:Number(document.getElementById("gThem").value)||0,
    mvp:"", svp:"", batting:[], pitching:[], comments:[], media:[] });
  document.getElementById("gOpp").value="";
  save(); renderAll(); toast("已建立比賽");
}
function delGame(id){
  if(!guardEdit()) return;
  if(!confirm("刪除整場比賽與其所有數據？")) return;
  state.games = state.games.filter(g=>g.id!==id);
  save(); renderAll();
}
function setGameCoach(gid, name){
  if(!guardEdit()) return;
  const g = state.games.find(x=>x.id===gid); if(!g) return;
  g.coach = name.trim(); save(); renderAll(); openCard(gid);
}
function coachNames(){
  return [...new Set(state.games.map(g=>(g.coach||"").trim()).filter(Boolean))];
}
function setGameAward(gid, key, pid){
  if(!guardEdit()) return;
  const g = state.games.find(x=>x.id===gid); if(!g) return;
  g[key] = pid; save(); renderAll(); openCard(gid);
  if(pid) toast((key==="mvp"?"單場 MVP：":"單場 SVP：")+playerName(pid));
}
function addBatLine(gid){
  if(!guardEdit()) return;
  const g = state.games.find(x=>x.id===gid); if(!g) return;
  const pid = document.getElementById("bp-"+gid).value;
  if(!pid) return toast("請先選擇球員（名單可在「球員名單」新增）");
  const line = {pid, vsP: document.getElementById("bvsP-"+gid).value};
  BKEYS.forEach(k => line[k] = Math.max(0, Number(document.getElementById("b"+k+"-"+gid).value)||0));
  if(line.H > line.AB) return toast("安打數不可大於打數");
  if(line.d2+line.d3+line.HR > line.H) return toast("長打數不可大於安打數");
  g.batting.push(line); save(); renderAll(); openCard(gid); toast("已登錄打擊");
}
function addPitLine(gid){
  if(!guardEdit()) return;
  const g = state.games.find(x=>x.id===gid); if(!g) return;
  const pid = document.getElementById("pp-"+gid).value;
  if(!pid) return toast("請先選擇球員");
  const outs = parseIP(document.getElementById("pIP-"+gid).value);
  if(outs===null) return toast("局數格式錯誤，例：2、2.1、2.2");
  const line = {pid, outs, vsB: document.getElementById("pvsB-"+gid).value};
  ["H","R","ER","BB","SO","GO","AO"].forEach(k => line[k] = Math.max(0, Number(document.getElementById("p"+k+"-"+gid).value)||0));
  if(line.ER > line.R) return toast("自責分不可大於失分");
  g.pitching.push(line); save(); renderAll(); openCard(gid); toast("已登錄投球");
}
function delLine(gid,type,i){
  if(!guardEdit()) return;
  const g = state.games.find(x=>x.id===gid); if(!g) return;
  g[type].splice(i,1); save(); renderAll(); openCard(gid);
}
function addComment(gid){
  if(!guardEdit()) return;
  const g = state.games.find(x=>x.id===gid); if(!g) return;
  const text = document.getElementById("cm-"+gid).value.trim();
  if(!text) return;
  g.comments.push({t: new Date().toTimeString().slice(0,5), text});
  save(); renderAll(); openCard(gid);
}
function delComment(gid,i){
  if(!guardEdit()) return; const g=state.games.find(x=>x.id===gid); g.comments.splice(i,1); save(); renderAll(); openCard(gid); }
function addMedia(gid){
  if(!guardEdit()) return;
  const g = state.games.find(x=>x.id===gid); if(!g) return;
  const url = document.getElementById("mu-"+gid).value.trim();
  if(!/^https?:\/\//i.test(url)) return toast("請輸入 http/https 開頭的網址");
  g.media.push({url, cap:document.getElementById("mc-"+gid).value.trim()});
  save(); renderAll(); openCard(gid); toast("已加入媒體連結");
}
function delMedia(gid,i){
  if(!guardEdit()) return; const g=state.games.find(x=>x.id===gid); g.media.splice(i,1); save(); renderAll(); openCard(gid); }
function editPhoto(pid){
  if(!guardEdit()) return;
  const p = getP(pid); if(!p) return;
  const url = prompt("貼上大頭照網址（清空可移除）：", p.photo||"");
  if(url===null) return;
  p.photo = url.trim(); save(); renderAll(); openProfile(pid);
}
function editPlayer(pid){
  if(!guardEdit()) return;
  const p = getP(pid); if(!p) return;
  const name = prompt("姓名：", p.name); if(name===null) return;
  const num = prompt("背號：", p.num||""); if(num===null) return;
  const pos = prompt("守位：", p.pos||""); if(pos===null) return;
  const level = prompt("階級（U12 / U15 / 其他）：", p.level||"U12"); if(level===null) return;
  const throws = prompt("投（右 / 左，留空為不明）：", p.throws||""); if(throws===null) return;
  const bats = prompt("打（右 / 左 / 兩，留空為不明）：", p.bats||""); if(bats===null) return;
  if(name.trim()) p.name = name.trim();
  p.num = num.trim(); p.pos = pos.trim();
  p.level = ["U12","U15","其他"].includes(level.trim()) ? level.trim() : p.level;
  p.throws = ["右","左"].includes(throws.trim()) ? throws.trim() : "";
  p.bats = ["右","左","兩"].includes(bats.trim()) ? bats.trim() : "";
  save(); renderAll(); openProfile(pid);
}

/* ───────── AI 功能 ───────── */
function setEraBaseLvl(level, v){
  if(!guardEdit()) return;
  state.eraBases = state.eraBases || {U12:6,U15:7,"其他":9};
  state.eraBases[level] = Number(v); save(); renderAll();
}
const IMP_FORMATS = {
  roster: "欄位順序：姓名, 背號, 守位, 階級(U12/U15/其他), 投(右/左), 打(右/左/兩), 大頭照網址\n範例：王小明, 12, SS, U12, 右, 左, https://.../photo.jpg（投打與照片可留空）",
  batting: "欄位順序：日期, 對手, 姓名, 打數, 安打, 二安, 三安, 全壘打, 四死, 犧飛, 得分, 打點, 三振, 盜壘, 面對投手(右/左/混)\n範例：2026-07-05, 向上, 王小明, 4, 2, 1, 0, 0, 1, 0, 1, 2, 0, 1, 右（日期後欄位可留空，視為 0 或不明）",
  pitching: "欄位順序：日期, 對手, 姓名, 局數(2.1=2又1/3), 被安打, 失分, 自責分, 四死, 三振, 面對打線(右/左/混), 滾地出局, 飛球出局\n範例：2026-07-05, 向上, 王小明, 3.2, 4, 2, 1, 3, 5, 右, 6, 3（後面欄位可留空）"
};
const HAND_MAP = {"右":"R","左":"L","混":"M","混合":"M"};
function findOrCreatePlayer(name, level){
  let p = state.players.find(p=>p.name===name);
  if(!p){ p = {id:uid(), name, num:"", pos:"", level:level||"U12", throws:"", bats:"", photo:""}; state.players.push(p); }
  return p;
}
function findOrCreateGame(date, opp, level){
  let g = state.games.find(g=>g.date===date && g.opp===opp);
  if(!g){ g = {id:uid(), created:Date.now(), date, opp, level:level||"U12", tour:"", coach:"", us:0, them:0, mvp:"", svp:"", batting:[], pitching:[], comments:[], media:[]}; state.games.push(g); }
  return g;
}
function runImport(){
  if(!guardEdit()) return;
  const type = document.getElementById("impType").value;
  const level = document.getElementById("impLvl").value;
  const raw = document.getElementById("impText").value.trim();
  const out = document.getElementById("impResult");
  if(!raw){ out.innerHTML = "請先貼上資料。"; return; }
  const lines = raw.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  let ok=0, skip=[], newP=0, newG=0;
  const pBefore = state.players.length, gBefore = state.games.length;
  lines.forEach((line, idx)=>{
    const cols = line.split(line.includes("\t")?"\t":",").map(c=>c.trim());
    // 略過標題列
    if(idx===0 && /姓名|日期|球員/.test(cols[0]+cols[1])) return;
    try{
      if(type==="roster"){
        const [name,num,pos,plvl,thr,bt,photo] = cols;
        if(!name) throw "缺姓名";
        if(state.players.find(p=>p.name===name)) throw "已存在，略過";
        state.players.push({id:uid(), name, num:num||"", pos:pos||"",
          level:["U12","U15","其他"].includes(plvl)?plvl:level,
          throws:["右","左"].includes(thr)?thr:"", bats:["右","左","兩"].includes(bt)?bt:"",
          photo:photo||""});
        ok++;
      }else if(type==="batting"){
        const [d,opp,name,...n] = cols;
        const date = normDate(d);
        if(!date||!opp||!name) throw "日期/對手/姓名不完整";
        const p = findOrCreatePlayer(name, level);
        const g = findOrCreateGame(date, opp, level);
        const v = k => Math.max(0, parseInt(n[k])||0);
        const line2 = {pid:p.id, AB:v(0),H:v(1),d2:v(2),d3:v(3),HR:v(4),BB:v(5),SF:v(6),R:v(7),RBI:v(8),SO:v(9),SB:v(10),
          vsP: HAND_MAP[(n[11]||"").trim()]||""};
        if(line2.H>line2.AB) throw "安打>打數";
        g.batting.push(line2); ok++;
      }else{
        const [d,opp,name,ip,...n] = cols;
        const date = normDate(d);
        if(!date||!opp||!name) throw "日期/對手/姓名不完整";
        const outs = parseIP(ip);
        if(outs===null) throw "局數格式錯誤";
        const p = findOrCreatePlayer(name, level);
        const g = findOrCreateGame(date, opp, level);
        const v = k => Math.max(0, parseInt(n[k])||0);
        g.pitching.push({pid:p.id, outs, H:v(0),R:v(1),ER:v(2),BB:v(3),SO:v(4),
          vsB: HAND_MAP[(n[5]||"").trim()]||"", GO:v(6), AO:v(7)}); ok++;
      }
    }catch(err){ skip.push(`第 ${idx+1} 行：${err}`); }
  });
  newP = state.players.length - pBefore; newG = state.games.length - gBefore;
  save(); renderAll();
  out.innerHTML = `✅ 匯入 ${ok} 筆${newP?`，自動新增球員 ${newP} 位`:""}${newG?`，自動建立比賽 ${newG} 場（比分為 0:0，請到比賽卡片補上）`:""}。`
    + (skip.length?`<br>⚠️ 略過 ${skip.length} 筆：<br>${skip.slice(0,8).map(esc).join("<br>")}${skip.length>8?"<br>…":""}`:"");
  if(ok) toast("匯入完成");
}

/* ───────── 分享 ───────── */
function exportJSON(){
  const blob = new Blob([JSON.stringify(state,null,2)],{type:"application/json"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `親子勇士-數據備份-${new Date().toISOString().slice(0,10)}.json`;
  a.click(); URL.revokeObjectURL(a.href);
  toast("已下載備份檔");
}
function importJSON(input){
  if(!guardEdit()) return;
  const file = input.files[0]; if(!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try{
      const data = JSON.parse(reader.result);
      if(!Array.isArray(data.players) || !Array.isArray(data.games)) throw new Error("格式不符");
      if(!confirm("匯入將覆蓋目前的資料，確定繼續？")) return;
      data.honors = data.honors||[]; data.scouts = data.scouts||[];
      state = data; save(); renderAll(); toast("匯入完成");
    }catch(e){ toast("匯入失敗：檔案格式不正確"); }
    input.value = "";
  };
  reader.readAsText(file);
}
async function resetAll(){
  if(!guardAdmin()) return;
  if(!confirm("將清除全部球員、比賽、榮譽與數據，且無法復原。確定？")) return;
  if(!confirm("再次確認：真的要清除全部資料嗎？")) return;
  state = { teamName:"親子勇士", eraBases:{U12:6,U15:7,"其他":9}, players:[], games:[], honors:[], scouts:[] };
  try{ await window.storage.delete("warriors-data", true); }catch(e){}
  try{ await window.storage.delete("warriors-data"); }catch(e){}
  try{ await window.storage.delete("team-data"); }catch(e){}
  renderAll(); toast("已清除");
}

/* ───────── 圖表 / 分頁 / 篩選 ───────── */
function saveScout(json){
  if(!guardEdit()) return;
  const sc = JSON.parse(json);
  state.scouts.push(sc); save(); renderAll();
  toast("已存成情蒐報告");
  document.getElementById("scOut").innerHTML = "";
  document.getElementById("scUrlOut").innerHTML = "";
  gotoScout(sc.id);
}
function addManualScout(){
  if(!guardEdit()) return;
  const opp = document.getElementById("scMOpp").value.trim();
  if(!opp) return toast("請輸入對手隊名");
  const sc = { id:uid(), opp, source:"manual", created:Date.now(),
    summary:document.getElementById("scMSum").value.trim(), keyPlayers:[], strategy:"", sources:"" };
  state.scouts.push(sc);
  document.getElementById("scMOpp").value=""; document.getElementById("scMSum").value="";
  save(); renderAll(); toast("已建立情蒐報告"); gotoScout(sc.id);
}
function addKeyPlayer(sid){
  if(!guardEdit()) return;
  const sc = state.scouts.find(s=>s.id===sid); if(!sc) return;
  const name = document.getElementById("kn-"+sid).value.trim();
  if(!name) return toast("請輸入姓名或背號");
  sc.keyPlayers.push({name, role:document.getElementById("kr-"+sid).value,
    hand:document.getElementById("kh-"+sid).value,
    note:document.getElementById("kt-"+sid).value.trim()});
  save(); renderAll(); gotoScout(sid);
}
function delKeyPlayer(sid,i){
  if(!guardEdit()) return;
  const sc = state.scouts.find(s=>s.id===sid); if(!sc) return;
  sc.keyPlayers.splice(i,1); save(); renderAll(); gotoScout(sid);
}
function editScout(sid){
  if(!guardEdit()) return;
  const sc = state.scouts.find(s=>s.id===sid); if(!sc) return;
  const summary = prompt("整體觀察：", sc.summary||""); if(summary===null) return;
  const strategy = prompt("應對建議：", sc.strategy||""); if(strategy===null) return;
  sc.summary = summary.trim(); sc.strategy = strategy.trim();
  save(); renderAll(); gotoScout(sid);
}
function delScout(sid){
  if(!guardEdit()) return;
  if(!confirm("刪除此份情蒐報告？")) return;
  state.scouts = state.scouts.filter(s=>s.id!==sid);
  save(); renderAll();
}
function saveHonor(json){
  if(!guardEdit()) return;
  const h = JSON.parse(json);
  const dup = state.honors.find(x=>x.type===h.type && x.period===h.period && x.level===h.level);
  if(dup && !confirm("此期間已有評選紀錄，要再新增一筆嗎？")) return;
  state.honors.push(h); save(); renderAll(); toast("已存入榮譽榜");
}
function delHonor(id){
  if(!guardEdit()) return;
  if(!confirm("刪除此筆榮譽紀錄？")) return;
  state.honors = state.honors.filter(h=>h.id!==id);
  save(); renderAll();
}
function seasonReportText(){
  const g = lvlGames();
  const w=g.filter(x=>gameResult(x)==="W").length, l=g.filter(x=>gameResult(x)==="L").length, t=g.length-w-l;
  const bat = sumBat(battingAgg(g)), pit = sumPit(pitchingAgg(g));
  const last5 = g.slice(-5);
  const form = last5.map(x=>gameResult(x)==="W"?"勝":gameResult(x)==="L"?"敗":"和").join("");
  const bAgg = battingAgg(g);
  const top = Object.entries(bAgg).filter(([,m])=>m.AB>0).sort((a,b)=>(b[1].OPS||0)-(a[1].OPS||0)).slice(0,3)
    .map(([pid,m],i)=>`${i+1}. ${playerName(pid)}  AVG ${f3(m.AVG)} / OPS ${f3(m.OPS)}`).join("\n");
  let s = `⚾ ${state.teamName}${lvl!=="all"?` ${lvl}`:""} 戰報（${new Date().toLocaleDateString("zh-TW")}）\n`;
  s += `━━━━━━━━━━━━\n`;
  s += `戰績：${w} 勝 ${l} 敗 ${t} 和（${g.length} 場）\n`;
  if(form) s += `近況：${form}（左舊右新）\n`;
  s += `得失分：${g.reduce((a,x)=>a+x.us,0)} : ${g.reduce((a,x)=>a+x.them,0)}\n`;
  s += `團隊打擊：AVG ${f3(bat.AVG)}｜OPS ${f3(bat.OPS)}\n`;
  s += `團隊投手：ERA ${f2(pit.ERA)}｜WHIP ${f2(pit.WHIP)}\n`;
  if(top) s += `\n🔥 打擊前三（OPS）\n${top}\n`;
  const lastGame = g[g.length-1];
  if(lastGame){
    s += `\n📋 最近一戰 ${lastGame.date} vs ${lastGame.opp}：${lastGame.us}:${lastGame.them}（${gameResult(lastGame)==="W"?"勝":gameResult(lastGame)==="L"?"敗":"和"}）\n`;
    if(lastGame.mvp) s += `⭐ 單場 MVP：${playerName(lastGame.mvp)}\n`;
    if((lastGame.comments||[]).length) s += `講評：${lastGame.comments[lastGame.comments.length-1].text}\n`;
  }
  const h = state.honors[state.honors.length-1];
  if(h) s += `\n🏆 最新榮譽（${h.period}）投手MVP ${h.pitcher?h.pitcher.name:"從缺"}／野手MVP ${h.fielder?h.fielder.name:"從缺"}\n`;
  return s;
}
function gameReportText(gid){
  const g = state.games.find(x=>x.id===gid); if(!g) return "";
  let s = `⚾ ${state.teamName} ${g.level||""} 單場戰報\n${g.date}${g.tour?`【${g.tour}】`:""} vs ${g.opp}\n比分 ${g.us}:${g.them}（${gameResult(g)==="W"?"勝":gameResult(g)==="L"?"敗":"和"}）\n`;
  if(g.coach) s += `👔 帶隊教練：${g.coach}\n`;
  if(g.mvp) s += `⭐ MVP：${playerName(g.mvp)}${g.svp?`　🥈 SVP：${playerName(g.svp)}`:""}\n`;
  if((g.batting||[]).length){
    s += `\n— 打擊 —\n`;
    g.batting.forEach(l=>{ s += `${playerName(l.pid)}：${l.AB} 打數 ${l.H} 安${l.HR?`（${l.HR} 轟）`:""}${l.RBI?`，${l.RBI} 打點`:""}${l.BB?`，${l.BB} 四死`:""}\n`; });
  }
  if((g.pitching||[]).length){
    s += `\n— 投球 —\n`;
    g.pitching.forEach(l=>{ s += `${playerName(l.pid)}：${ipStr(l.outs)} 局，${l.SO} K，失 ${l.R}（責失 ${l.ER}）\n`; });
  }
  if((g.comments||[]).length){
    s += `\n— 講評 —\n`;
    g.comments.forEach(c=>{ s += `[${c.t}] ${c.text}\n`; });
  }
  if((g.media||[]).length){
    s += `\n— 精彩照片/影片 —\n`;
    g.media.forEach(m=>{ s += `${m.cap?m.cap+"：":""}${m.url}\n`; });
  }
  return s;
}
function copySeasonReport(){ copyText(seasonReportText(), "球隊戰報已複製，可直接貼上分享"); }
function copyGameReport(gid){ copyText(gameReportText(gid), "單場戰報已複製"); }
async function copyText(text, okMsg){
  try{ await navigator.clipboard.writeText(text); toast(okMsg); }
  catch(e){
    const p = document.getElementById("reportPreview");
    p.style.display="block"; p.textContent = text;
    document.querySelector('[data-tab="share"]').click();
    toast("無法自動複製，已顯示內容供手動複製");
  }
}
