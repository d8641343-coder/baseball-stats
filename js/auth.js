/* ───────── 身分驗證：Firebase Google 登入 + 成員核准 ─────────
   取代舊的三層共用密碼。所有人都要 Google 登入且經管理者核准才能檢視。
   對外仍提供 role / canEdit / guardEdit / guardAdmin / enterAs / logout / renderPerm，
   App 其餘程式呼叫方式不變。*/
const OWNER_EMAIL = "d8641343@gmail.com";   // 初始管理者（第一次登入即為 admin）
let role = null;            // 'admin' | 'editor' | 'viewer'
let myLevels = "ALL";       // 編輯者可編輯的階級："ALL" | "U12" | "U15" | "其他"（admin 一律 ALL）
let currentUser = null;    // firebase.User
let membersList = [];      // 管理者用：成員清單
let _membersUnsub = null;
const ROLE_TXT = {admin:"管理者", editor:"編輯者", viewer:"唯讀成員"};
const LEVELS = ["U12","U15","其他"];
// canEdit(level)：不帶 level → 是否具備任何編輯身分（供 save() 等通用判斷）；
// 帶 level → 是否可編輯「該階級」的資料（編輯者受 myLevels 限制，admin 一律可）。
function canEdit(level){
  if(role!=="admin" && role!=="editor") return false;
  if(role==="admin") return true;
  if(!level) return true;
  return myLevels==="ALL" || myLevels===level;
}
function guardEdit(level){
  if(canEdit(level)) return true;
  toast(level && role==="editor" && myLevels!=="ALL" ? `唯讀模式：你沒有 ${level} 階級的編輯權限` : "唯讀模式：需要編輯權限");
  return false;
}
function guardAdmin(){ if(role==="admin") return true; toast("僅管理者可執行此操作"); return false; }

function initAuth(){
  if(typeof firebase==="undefined" || !firebase.apps || !firebase.apps.length){
    showFatal("Firebase 初始化失敗，請確認 firebase-config.js 設定正確、且網路正常。");
    return;
  }
  firebase.auth().onAuthStateChanged(u => handleAuth(u));
}
async function handleAuth(user){
  currentUser = user;
  if(!user){ role = null; document.body.classList.remove("admin","editor","viewer"); showLogin(); return; }
  const memRef = firebase.firestore().doc("teams/warriors/members/"+user.uid);
  try{
    const snap = await memRef.get();
    let mem = snap.exists ? snap.data() : null;
    if(user.email === OWNER_EMAIL && (!mem || mem.role!=="admin" || !mem.approved)){
      // 擁有者一律確保為已核准的管理者（bootstrap，免手動建資料）
      mem = { email:user.email, name:user.displayName||"", role:"admin", approved:true, created:(mem&&mem.created)||Date.now() };
      await memRef.set(mem, {merge:true});
    }else if(!mem){
      // 新登入者：建立待核准的唯讀成員
      mem = { email:user.email||"", name:user.displayName||"", role:"viewer", approved:false, created:Date.now() };
      await memRef.set(mem);
    }
    if(!mem.approved){ showPending(user); return; }
    myLevels = mem.role==="admin" ? "ALL" : (mem.editLevels || "ALL");
    await enterAs(mem.role);
  }catch(e){
    console.error(e);
    showFatal("讀取成員資料失敗："+(e.code||e.message||"未知錯誤")+"。可能是 Firestore 安全規則尚未貼上。");
  }
}
function authBody(html){
  const bg = document.getElementById("authBg");
  bg.style.display = "flex";
  document.getElementById("authBody").innerHTML = html;
}
// 偵測 App 內建瀏覽器（LINE / FB / IG 等）。Google 政策禁止這類 webview 做 OAuth 登入
// （錯誤 403: disallowed_useragent），須改用系統瀏覽器 Chrome / Safari。
function isInAppBrowser(){
  const ua = navigator.userAgent || "";
  if(/FBAN|FBAV|FB_IAB|Instagram|Line\b|MicroMessenger|Twitter|KAKAOTALK|; wv\)|GSA\//i.test(ua)) return true;
  // Android WebView：有 "wv" 標記；iOS App 內嵌 WebView：是 Safari 引擎但沒有 "Safari" 字樣
  if(/Android/.test(ua) && /Version\/[\d.]+/.test(ua)) return true;
  if(/iPhone|iPad|iPod/.test(ua) && !/Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua)) return true;
  return false;
}
function copyLoginUrl(){
  const url = location.href;
  (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject())
    .then(()=>toast("已複製網址，貼到 Chrome / Safari 開啟"))
    .catch(()=>{ if(typeof promptBox==="function") promptBox("複製這串網址，貼到 Chrome / Safari 開啟：", url); else toast(url); });
}
function showLogin(){
  const warn = isInAppBrowser() ? `
    <div style="text-align:left;font-size:14px;background:#fdecea;border:1px solid #f5c2c0;border-radius:8px;padding:12px;margin:0 0 12px">
      <b>⚠️ 目前是 App 內建瀏覽器</b><br><br>
      Google 基於安全政策，禁止在 <b>LINE／Facebook／IG</b> 等 App 的內建瀏覽器登入（會出現錯誤 <b>403: disallowed_useragent</b>）。<br><br>
      請改用系統瀏覽器開啟本頁：<br>
      1. 點畫面右上角的「<b>⋯</b>」選單<br>
      2. 選「<b>用預設瀏覽器開啟</b>」（Chrome / Safari）<br>
      3. 再按下方的 Google 登入
      <div style="margin-top:10px"><button class="btn ghost sm" onclick="copyLoginUrl()">📋 複製本頁網址</button></div>
    </div>` : "";
  authBody(`
    ${warn}
    <p style="font-size:14px;margin:8px 0 14px">請用 Google 帳號登入。首次登入需經管理者核准後才能檢視球隊資料。</p>
    <button class="btn gold" onclick="login()">🔑 使用 Google 登入</button>`);
}
function showPending(user){
  authBody(`
    <div style="text-align:left;font-size:14px;background:#fdf3d7;border:1px solid #ecd48a;border-radius:8px;padding:12px;margin:10px 0">
      你已用 <b>${esc(user.email||"")}</b> 登入。<br><br>
      帳號 <b>尚待管理者核准</b>，核准後重新整理即可檢視。請通知管理者到「權限管理」核准你。
    </div>
    <button class="btn ghost" onclick="logout()">換帳號 / 登出</button>`);
}
function showFatal(msg){
  authBody(`<div style="text-align:left;font-size:14px;background:#fdecea;border:1px solid #f5c2c0;border-radius:8px;padding:12px;margin:10px 0">
      <b>⚠️ 無法載入</b><br><br>${esc(msg)}</div>
    <button class="btn ghost" onclick="location.reload()">重新整理</button>`);
}
function login(){
  const provider = new firebase.auth.GoogleAuthProvider();
  firebase.auth().signInWithPopup(provider).catch(e=>{
    if(e && e.code==="auth/popup-closed-by-user") return;
    toast("登入失敗："+(e.message||e.code||""));
  });
}
function logout(){
  if(_membersUnsub){ _membersUnsub(); _membersUnsub=null; }
  if(typeof _aiConfUnsub !== "undefined" && _aiConfUnsub){ _aiConfUnsub(); _aiConfUnsub=null; }
  firebase.auth().signOut();
}

async function enterAs(r){
  role = r;
  document.getElementById("authBg").style.display = "none";
  document.body.classList.remove("viewer","editor","admin");
  document.body.classList.add(r==="admin"?"admin":r==="editor"?"editor":"viewer");
  document.getElementById("permTab").style.display = r==="admin" ? "" : "none";
  document.getElementById("roleChip").innerHTML =
    `身分：<b>${ROLE_TXT[r]}</b>${currentUser?`（${esc(currentUser.email||"")}）`:""} · <button onclick="logout()">登出</button>`;
  subscribeAll();                 // 開始監聽 Firestore 資料（data.js）
  if(r==="admin") subscribeMembers();
  if(typeof subscribeAiConf === "function") subscribeAiConf();   // AI 設定（scout.js，admin/editor）
  // 登入紀錄：同一瀏覽器分頁工作階段只記一次，重新整理不重複記
  if(!sessionStorage.getItem("wr-logged")){
    sessionStorage.setItem("wr-logged", "1");
    logEvent("login", `以「${ROLE_TXT[r]}」身分登入`);
  }
  renderPerm();
  probeNet();
}

/* ───────── 成員管理（管理者） ───────── */
function subscribeMembers(){
  if(_membersUnsub) return;
  _membersUnsub = firebase.firestore().collection("teams/warriors/members")
    .onSnapshot(s => { membersList = s.docs.map(d => Object.assign({uid:d.id}, d.data())); renderPerm(); },
                e => console.error("成員清單讀取失敗", e));
}
function renderPerm(){
  const el = document.getElementById("memberList");
  if(!el) return;
  if(role !== "admin"){ el.innerHTML = ""; return; }
  const order = {admin:0, editor:1, viewer:2};
  const rows = membersList.slice().sort((a,b)=>
    (a.approved?1:0)-(b.approved?1:0) || (order[a.role]??9)-(order[b.role]??9) || (a.created||0)-(b.created||0));
  if(!rows.length){ el.innerHTML = `<div class="empty">目前只有你。把網址給隊友、請他用 Google 登入，就會出現在這裡等你核准。</div>`; return; }
  el.innerHTML = `<div class="tblwrap"><table><thead><tr>
      <th class="l">帳號</th><th>身分</th><th>可編輯階級</th><th>狀態</th><th>操作</th></tr></thead><tbody>` +
    rows.map(m=>{
      const isOwner = m.email===OWNER_EMAIL;
      const roleSel = isOwner ? `<b>管理者</b>` :
        `<select onchange="setMemberRole('${m.uid}',this.value)">
           <option value="viewer" ${m.role==="viewer"?"selected":""}>唯讀成員</option>
           <option value="editor" ${m.role==="editor"?"selected":""}>編輯者</option>
           <option value="admin" ${m.role==="admin"?"selected":""}>管理者</option></select>`;
      const lvlSel = (isOwner || m.role==="admin") ? `<span class="hint">全部</span>` :
        m.role==="editor"
          ? `<select onchange="setMemberLevels('${m.uid}',this.value)">
               <option value="ALL" ${((m.editLevels||"ALL")==="ALL")?"selected":""}>全部</option>` +
             LEVELS.map(x=>`<option value="${x}" ${m.editLevels===x?"selected":""}>${x}</option>`).join("") +
             `</select>`
          : `<span class="hint">—</span>`;
      const status = m.approved ? `<span class="res W" style="color:#fff">已核准</span>` : `<span class="res L" style="color:#fff">待核准</span>`;
      const actions = isOwner ? `<span class="hint">擁有者</span>` :
        `${m.approved ? "" : `<button class="btn gold sm" onclick="approveMember('${m.uid}')">核准</button> `}
         <button class="btn warn sm" onclick="removeMember('${m.uid}')">移除</button>`;
      return `<tr><td class="l">${esc(m.email||m.uid)}</td><td>${roleSel}</td><td>${lvlSel}</td><td>${status}</td><td>${actions}</td></tr>`;
    }).join("") + `</tbody></table></div>`;
}
function memberEmail(uid){ const m = membersList.find(x=>x.uid===uid); return m ? (m.email||uid) : uid; }
async function approveMember(uid){
  if(!guardAdmin()) return;
  try{
    await firebase.firestore().doc("teams/warriors/members/"+uid).set({approved:true},{merge:true});
    toast("已核准"); logEvent("edit", `核准成員 ${memberEmail(uid)}`);
  }
  catch(e){ toast("核准失敗："+(e.code||e.message||"")); }
}
async function setMemberRole(uid, r){
  if(!guardAdmin()) return;
  try{
    await firebase.firestore().doc("teams/warriors/members/"+uid).set({role:r, approved:true},{merge:true});
    toast("已更新身分為 "+ROLE_TXT[r]); logEvent("edit", `成員 ${memberEmail(uid)} 身分改為 ${ROLE_TXT[r]}`);
  }
  catch(e){ toast("更新失敗："+(e.code||e.message||"")); }
}
async function setMemberLevels(uid, v){
  if(!guardAdmin()) return;
  try{
    await firebase.firestore().doc("teams/warriors/members/"+uid).set({editLevels:v},{merge:true});
    toast("已更新可編輯階級為 "+(v==="ALL"?"全部":v)); logEvent("edit", `成員 ${memberEmail(uid)} 可編輯階級改為 ${v}`);
  }
  catch(e){ toast("更新失敗："+(e.code||e.message||"")); }
}
async function removeMember(uid){
  if(!guardAdmin()) return;
  if(!await confirmBox("移除此成員？之後他將無法再檢視資料（可重新登入後再由你核准）。")) return;
  const em = memberEmail(uid);
  try{
    await firebase.firestore().doc("teams/warriors/members/"+uid).delete();
    toast("已移除"); logEvent("edit", `移除成員 ${em}`);
  }
  catch(e){ toast("移除失敗："+(e.code||e.message||"")); }
}

/* ───────── AI 功能設定（管理者） ─────────
   設定存 teams/warriors/config/ai：{ apiKey, model, editorDaily, updated }。
   editorDaily = 編輯者「每個 AI 功能」的每日可呼叫次數（0 = 不開放）；管理者不受限。*/
function renderAiConf(){
  const st = document.getElementById("aiKeyState");
  if(!st || role !== "admin") return;
  if(aiConf && aiConf.apiKey){
    st.innerHTML = `✅ 已設定（sk-ant-…${esc(String(aiConf.apiKey).slice(-4))}）`;
  }else{
    st.innerHTML = `⚠️ 尚未設定，AI 功能停用中`;
  }
  const sel = document.getElementById("aiModelSel");
  if(sel && document.activeElement !== sel){
    sel.innerHTML = AI_MODELS.map(m=>`<option value="${m.id}">${m.label}</option>`).join("");
    sel.value = (aiConf && aiConf.model) || "claude-sonnet-4-6";
    if(!sel.value) sel.value = "claude-sonnet-4-6";
  }
  const daily = document.getElementById("aiDailyInput");
  if(daily && document.activeElement !== daily){
    daily.value = (aiConf && aiConf.editorDaily !== undefined) ? aiConf.editorDaily : 1;
  }
  const priceBox = document.getElementById("aiPriceRows");
  if(priceBox && document.activeElement.tagName !== "INPUT"){
    const pricing = (aiConf && aiConf.pricing) || {};
    priceBox.innerHTML = AI_MODELS.map(m=>{
      const p = pricing[m.id] || {};
      return `<div class="frow" style="gap:6px;align-items:flex-end">
        <div class="fld" style="min-width:170px"><label>${esc(m.label)}</label></div>
        <div class="fld w60"><label>輸入 $/M</label><input type="number" min="0" step="0.01" value="${p.in ?? ""}" id="price-in-${m.id}"></div>
        <div class="fld w60"><label>輸出 $/M</label><input type="number" min="0" step="0.01" value="${p.out ?? ""}" id="price-out-${m.id}"></div>
      </div>`;
    }).join("");
  }
}
async function saveAiConf(){
  if(!guardAdmin()) return;
  const keyInput = document.getElementById("aiKeyInput").value.trim();
  if(keyInput && !/^sk-ant-/.test(keyInput) && !await confirmBox("這串文字看起來不像 Anthropic API Key（通常以 sk-ant- 開頭），仍要儲存嗎？")) return;
  const pricing = {};
  AI_MODELS.forEach(m=>{
    const inV = Number(document.getElementById(`price-in-${m.id}`).value)||0;
    const outV = Number(document.getElementById(`price-out-${m.id}`).value)||0;
    if(inV || outV) pricing[m.id] = { in: inV, out: outV };
  });
  const data = {
    model: document.getElementById("aiModelSel").value || "claude-sonnet-4-6",
    editorDaily: Math.max(0, Math.min(99, Number(document.getElementById("aiDailyInput").value)||0)),
    pricing, updated: Date.now()
  };
  if(keyInput) data.apiKey = keyInput;
  try{
    await firebase.firestore().doc("teams/warriors/config/ai").set(data, {merge:true});
    document.getElementById("aiKeyInput").value = "";
    toast("AI 設定已儲存");
    logEvent("edit", `更新 AI 設定：模型 ${data.model}、編輯者每日 ${data.editorDaily} 次${keyInput?"、更換 API Key":""}`);
  }catch(e){ toast("儲存失敗："+(e.code||e.message||"")); }
}

/* ───────── AI 用量花費估算（管理者） ─────────
   Anthropic 沒有提供查詢帳戶餘額的 API，只能從既有的 AI 呼叫紀錄（logs，type=ai）
   反解析出每次呼叫的 model + token 數，乘上管理者填的價格（上方 aiPriceRows）估算花費。
   僅供參考，正確金額以 Anthropic Console 帳單為準。*/
let _aiUsageRows = null;
async function loadAiUsage(){
  if(role !== "admin") return;
  const el = document.getElementById("aiUsageBox");
  if(!el) return;
  el.innerHTML = "載入中…";
  try{
    // 不加 .where("type","==","ai") 避免需要另外在 Firestore Console 手動建立複合索引，
    // 跟 loadLogs() 一樣：抓最新一批紀錄後在前端過濾出 type==="ai" 的部分即可。
    const s = await firebase.firestore().collection("teams/warriors/logs")
      .orderBy("t","desc").limit(5000).get();
    _aiUsageRows = s.docs.map(d=>d.data()).filter(r=>r.type==="ai");
    renderAiUsage();
  }catch(e){
    console.error(e);
    el.innerHTML = `<div class="empty">讀取失敗：${esc(e.code||e.message||"")}。請確認 Firestore 安全規則已更新為最新版。</div>`;
  }
}
function renderAiUsage(){
  const el = document.getElementById("aiUsageBox");
  if(!el || !_aiUsageRows) return;
  const sel = document.getElementById("aiUsagePeriodSel");
  const period = sel ? sel.value : "month";
  const now = new Date();
  let since = 0;
  if(period === "month") since = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  else if(period === "7d") since = now.getTime() - 7*86400000;
  else if(period === "30d") since = now.getTime() - 30*86400000;
  const pricing = (aiConf && aiConf.pricing) || {};
  const byModel = {};
  let parsedCalls = 0;
  _aiUsageRows.filter(r=>r.t >= since).forEach(r=>{
    const p = parseAiLogMsg(r.msg);
    if(!p) return;   // 判定失敗等紀錄沒有 token 數，略過
    parsedCalls++;
    const b = byModel[p.model] || (byModel[p.model] = {calls:0, inTok:0, outTok:0});
    b.calls++; b.inTok += p.inTok; b.outTok += p.outTok;
  });
  const models = Object.keys(byModel);
  if(!models.length){
    el.innerHTML = `<div class="empty">此區間沒有 AI 呼叫紀錄（已讀取最近 5000 筆系統紀錄中屬於 AI 呼叫的部分）。</div>`;
    return;
  }
  let totalCost = 0, hasUnpriced = false;
  const rows = models.map(model=>{
    const b = byModel[model];
    const price = pricing[model];
    let cost = null;
    if(price){ cost = b.inTok/1e6*(price.in||0) + b.outTok/1e6*(price.out||0); totalCost += cost; }
    else hasUnpriced = true;
    const label = (AI_MODELS.find(m=>m.id===model)||{}).label || model;
    return `<tr><td class="l">${esc(label)}</td><td class="num">${b.calls}</td><td class="num">${b.inTok.toLocaleString()}</td>
      <td class="num">${b.outTok.toLocaleString()}</td><td class="num">${cost===null?"（未設價格）":"$"+cost.toFixed(3)}</td></tr>`;
  }).join("");
  el.innerHTML = `<div class="tblwrap"><table><thead><tr>
      <th class="l">模型</th><th>呼叫次數</th><th>輸入 tokens</th><th>輸出 tokens</th><th>估算花費</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td class="l"><b>合計</b></td><td class="num">${parsedCalls}</td><td colspan="2"></td>
        <td class="num"><b>$${totalCost.toFixed(3)}</b>${hasUnpriced?"＋未設價格模型":""}</td></tr></tfoot>
    </table></div>
    <div class="hint" style="margin-top:6px">依「AI 功能設定」填的價格估算，僅供參考，正確金額請以 Anthropic Console 帳單為準；價格留空的模型無法估算。統計範圍為最近 5000 筆系統紀錄中的 AI 呼叫。</div>`;
}
async function clearAiKey(){
  if(!guardAdmin()) return;
  if(!await confirmBox("移除 API Key？所有 AI 功能將停用，直到重新填入。")) return;
  try{
    await firebase.firestore().doc("teams/warriors/config/ai")
      .set({apiKey: firebase.firestore.FieldValue.delete()}, {merge:true});
    toast("已移除 API Key"); logEvent("edit", "移除 AI API Key");
  }catch(e){ toast("移除失敗："+(e.code||e.message||"")); }
}

/* ───────── 系統紀錄（管理者） ───────── */
const LOG_TYPE_TXT = { login:"登入", ai:"AI 呼叫", edit:"資料編輯" };
async function loadLogs(){
  if(role !== "admin") return;
  const el = document.getElementById("logList");
  if(!el) return;
  el.innerHTML = "載入中…";
  try{
    const s = await firebase.firestore().collection("teams/warriors/logs")
      .orderBy("t","desc").limit(300).get();
    const type = document.getElementById("logTypeSel").value;
    let rows = s.docs.map(d=>d.data());
    if(type) rows = rows.filter(r=>r.type===type);
    if(!rows.length){ el.innerHTML = `<div class="empty">尚無紀錄。</div>`; return; }
    el.innerHTML = `<div class="tblwrap"><table><thead><tr>
        <th class="l">時間</th><th>類型</th><th class="l">成員</th><th class="l">內容</th></tr></thead><tbody>` +
      rows.map(r=>`<tr>
        <td class="l" style="white-space:nowrap">${new Date(r.t||0).toLocaleString("zh-TW",{hour12:false})}</td>
        <td style="white-space:nowrap">${LOG_TYPE_TXT[r.type]||esc(r.type||"")}</td>
        <td class="l">${esc(r.email||r.uid||"")}</td>
        <td class="l">${esc(r.msg||"")}</td></tr>`).join("") +
      `</tbody></table></div>
      <div class="hint" style="margin-top:6px">顯示最近 300 筆（先取最新 300 筆再依類型過濾）。</div>`;
  }catch(e){
    console.error(e);
    el.innerHTML = `<div class="empty">讀取失敗：${esc(e.code||e.message||"")}。請確認 Firestore 安全規則已更新為最新版。</div>`;
  }
}
