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
function showLogin(){
  authBody(`
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
function logout(){ if(_membersUnsub){ _membersUnsub(); _membersUnsub=null; } firebase.auth().signOut(); }

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
async function approveMember(uid){
  if(!guardAdmin()) return;
  try{ await firebase.firestore().doc("teams/warriors/members/"+uid).set({approved:true},{merge:true}); toast("已核准"); }
  catch(e){ toast("核准失敗："+(e.code||e.message||"")); }
}
async function setMemberRole(uid, r){
  if(!guardAdmin()) return;
  try{ await firebase.firestore().doc("teams/warriors/members/"+uid).set({role:r, approved:true},{merge:true}); toast("已更新身分為 "+ROLE_TXT[r]); }
  catch(e){ toast("更新失敗："+(e.code||e.message||"")); }
}
async function setMemberLevels(uid, v){
  if(!guardAdmin()) return;
  try{ await firebase.firestore().doc("teams/warriors/members/"+uid).set({editLevels:v},{merge:true}); toast("已更新可編輯階級為 "+(v==="ALL"?"全部":v)); }
  catch(e){ toast("更新失敗："+(e.code||e.message||"")); }
}
async function removeMember(uid){
  if(!guardAdmin()) return;
  if(!await confirmBox("移除此成員？之後他將無法再檢視資料（可重新登入後再由你核准）。")) return;
  try{ await firebase.firestore().doc("teams/warriors/members/"+uid).delete(); toast("已移除"); }
  catch(e){ toast("移除失敗："+(e.code||e.message||"")); }
}
