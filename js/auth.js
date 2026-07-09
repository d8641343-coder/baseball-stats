let auth = null;       // 共用權限設定 {adminHash, editHash, viewHash}
let role = null;       // 'admin' | 'editor' | 'viewer'
const ROLE_TXT = {admin:"管理者", editor:"編輯者", viewer:"唯讀成員"};
function canEdit(){ return role==="admin" || role==="editor"; }
function guardEdit(){ if(canEdit()) return true; toast("唯讀模式：需要編輯權限"); return false; }
function guardAdmin(){ if(role==="admin") return true; toast("僅管理者可執行此操作"); return false; }
async function sha256(s){
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("warriors::"+s));
  return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,"0")).join("");
}
async function loadAuth(){
  try{
    const r = await window.storage.get("warriors-auth", true);
    if(r && r.value) auth = JSON.parse(r.value);
  }catch(e){ auth = null; }
}
async function saveAuth(){
  try{ await window.storage.set("warriors-auth", JSON.stringify(auth), true); return true; }
  catch(e){ toast("權限設定儲存失敗"); return false; }
}
let storageOK = false;
let demoMode = false;
async function checkStorage(){
  try{
    if(!window.storage) return false;
    await window.storage.set("warriors-probe", String(Date.now()));
    try{ await window.storage.delete("warriors-probe"); }catch(e){}
    return true;
  }catch(e){ return false; }
}
function showNoStorage(){
  const bg = document.getElementById("authBg");
  const body = document.getElementById("authBody");
  bg.style.display = "flex";
  body.innerHTML = `
    <div style="text-align:left;font-size:14px;background:#fdf3d7;border:1px solid #ecd48a;border-radius:8px;padding:12px;margin:10px 0">
      <b>⚠️ 偵測不到雲端儲存服務</b><br><br>
      這通常代表你目前是在<b>對話中的預覽視窗</b>或<b>下載到本機的檔案</b>開啟本工具。在這個環境下，密碼與比賽資料都無法儲存。<br><br>
      <b>正確使用方式：</b><br>
      1. 在 Claude 中按此工具右上角的「發佈」<br>
      2. 從<b>發佈後的連結</b>重新開啟<br>
      3. 再進行首次密碼設定與資料登錄<br><br>
      之後把發佈連結＋觀看密碼公布在 LINE 群組即可。
    </div>
    <button class="btn ghost" onclick="enterDemo()">先以試用模式看看介面（資料不會儲存）</button>`;
}
async function enterDemo(){
  demoMode = true;
  auth = auth || {adminHash:"demo", editHash:"", viewHash:""};
  await enterAs("admin");
  document.getElementById("roleChip").innerHTML = `⚠️ <b>試用模式</b>：資料不會儲存，請從發佈後的連結開啟正式使用`;
}
function showAuth(mode){
  const bg = document.getElementById("authBg");
  const body = document.getElementById("authBody");
  bg.style.display = "flex";
  if(mode==="setup"){
    body.innerHTML = `
      <p style="font-size:14px;margin:8px 0">首次啟用，請由<b>管理者</b>設定管理密碼。編輯與觀看密碼可稍後在「權限管理」設定。</p>
      <input type="password" id="auP1" placeholder="設定管理密碼（至少 4 碼）">
      <input type="password" id="auP2" placeholder="再輸入一次確認">
      <div class="auth-msg" id="auMsg"></div>
      <button class="btn gold" onclick="doSetup()">建立並進入</button>`;
  }else{
    body.innerHTML = `
      <p style="font-size:14px;margin:8px 0">請輸入密碼進入（管理／編輯／觀看密碼皆可）。</p>
      <input type="password" id="auPw" placeholder="密碼" onkeydown="if(event.key==='Enter')doLogin()">
      <div class="auth-msg" id="auMsg"></div>
      <button class="btn gold" onclick="doLogin()">登入</button>
      ${!auth.viewHash?`<button class="btn ghost" onclick="enterAs('viewer')" style="margin-top:8px">以唯讀模式瀏覽</button>`:""}`;
  }
  setTimeout(()=>{ const el = document.getElementById(mode==="setup"?"auP1":"auPw"); if(el) el.focus(); }, 50);
}
async function doSetup(){
  const p1 = document.getElementById("auP1").value, p2 = document.getElementById("auP2").value;
  const msg = document.getElementById("auMsg");
  if(p1.length < 4){ msg.textContent = "密碼至少 4 碼"; return; }
  if(p1 !== p2){ msg.textContent = "兩次輸入不一致"; return; }
  auth = { adminHash: await sha256(p1), editHash:"", viewHash:"", updated: Date.now() };
  const ok = await saveAuth();
  if(!ok){ msg.textContent = "儲存失敗：請確認是從「發佈後」的連結開啟本工具"; return; }
  await setSession(auth.adminHash);
  enterAs("admin");
}
async function doLogin(){
  const pw = document.getElementById("auPw").value;
  const msg = document.getElementById("auMsg");
  if(!pw){ msg.textContent = "請輸入密碼"; return; }
  const h = await sha256(pw);
  let r = null;
  if(h === auth.adminHash) r = "admin";
  else if(auth.editHash && h === auth.editHash) r = "editor";
  else if(auth.viewHash && h === auth.viewHash) r = "viewer";
  if(!r){ msg.textContent = "密碼錯誤"; return; }
  await setSession(h);
  enterAs(r);
}
async function setSession(hash){
  try{ await window.storage.set("warriors-session", JSON.stringify({h:hash})); }catch(e){}
}
async function trySession(){
  try{
    const r = await window.storage.get("warriors-session");
    if(!r || !r.value) return null;
    const h = JSON.parse(r.value).h;
    if(h === auth.adminHash) return "admin";
    if(auth.editHash && h === auth.editHash) return "editor";
    if(auth.viewHash && h === auth.viewHash) return "viewer";
  }catch(e){}
  return null;
}
async function enterAs(r){
  role = r;
  document.getElementById("authBg").style.display = "none";
  document.body.classList.remove("viewer","editor","admin");
  document.body.classList.add(r==="admin"?"admin":r==="editor"?"editor":"viewer");
  document.getElementById("permTab").style.display = r==="admin" ? "" : "none";
  document.getElementById("roleChip").innerHTML =
    `身分：<b>${ROLE_TXT[r]}</b> · <button onclick="reloadData()" title="讀取其他人最新登錄的資料">🔄 更新資料</button> · <button onclick="logout()">登出</button>`;
  await load();
  state.scouts = state.scouts||[]; state.honors = state.honors||[];
  renderAll(); renderPerm();
  probeNet();
}
async function logout(){
  try{ await window.storage.delete("warriors-session"); }catch(e){}
  location.reload();
}
async function reloadData(){
  await load();
  state.scouts = state.scouts||[]; state.honors = state.honors||[];
  renderAll(); toast("已載入最新資料");
}
async function setPw(kind){
  if(!guardAdmin()) return;
  const map = {edit:"pwEdit", view:"pwView", admin:"pwAdmin"};
  const el = document.getElementById(map[kind]);
  const pw = el.value;
  if(pw.length < 4) return toast("密碼至少 4 碼");
  const h = await sha256(pw);
  if(kind==="admin") auth.adminHash = h;
  if(kind==="edit") auth.editHash = h;
  if(kind==="view") auth.viewHash = h;
  auth.updated = Date.now();
  await saveAuth();
  if(kind==="admin") await setSession(h);
  el.value = "";
  renderPerm();
  toast(kind==="admin"?"管理密碼已更換":kind==="edit"?"編輯密碼已設定，可私訊給指定人員":"觀看密碼已設定，可公布在群組記事本");
}
async function clearPw(kind){
  if(!guardAdmin()) return;
  if(!confirm(kind==="edit"?"停用編輯密碼？現有編輯者將無法再登入編輯。":"停用觀看密碼？任何拿到連結的人都能唯讀瀏覽。")) return;
  if(kind==="edit") auth.editHash = "";
  if(kind==="view") auth.viewHash = "";
  auth.updated = Date.now();
  await saveAuth(); renderPerm(); toast("已停用");
}
function renderPerm(){
  const el = document.getElementById("pwStatus");
  if(!el || role!=="admin" || !auth) return;
  el.innerHTML = `目前狀態：管理密碼 ✅ ｜ 編輯密碼 ${auth.editHash?"✅ 已設定":"⛔ 未設定（僅管理者可編輯）"} ｜ 觀看密碼 ${auth.viewHash?"✅ 已設定（需密碼才能看）":"⚠️ 未設定（任何人可唯讀瀏覽）"}`;
}


