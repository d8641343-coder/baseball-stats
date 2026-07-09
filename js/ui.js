let charts = {};
let currentPid = null;
function avatarHTML(p, lg){
  const cls = "avatar"+(lg?" lg":"");
  if(p && p.photo) return `<img class="${cls}" src="${esc(p.photo)}" alt="${esc(p.name)}" onerror="this.outerHTML='<span class=&quot;${cls}&quot;>${esc((p.name||'?')[0])}</span>'">`;
  return `<span class="${cls}">${esc(((p&&p.name)||"?")[0])}</span>`;
}
function nameLink(pid){
  const p = getP(pid);
  return p ? `<span class="pname" onclick="openProfile('${pid}')">${esc(p.name)}</span>` : "（已移除）";
}
function lvlBadge(v){ return `<span class="lvl-badge lvl-${v==="U12"||v==="U15"?v:"其他"}">${esc(v||"U12")}</span>`; }
function handBadge(p){
  if(!p || (!p.throws && !p.bats)) return "";
  const t = p.throws ? p.throws+"投" : "";
  const b = p.bats ? (p.bats==="兩"?"左右開弓":p.bats+"打") : "";
  return `<span class="pos-badge" style="background:#fdf3d7;color:#8a6410">${t}${t&&b?" ":""}${b}</span>`;
}
function renderHeader(){
  const g = lvlGames();
  const w = g.filter(x=>gameResult(x)==="W").length;
  const l = g.filter(x=>gameResult(x)==="L").length;
  const t = g.length - w - l;
  const rs = g.reduce((s,x)=>s+x.us,0), ra = g.reduce((s,x)=>s+x.them,0);
  document.getElementById("sbLights").innerHTML = `
    <div class="light"><div class="num">${g.length}</div><div class="lbl">出賽</div></div>
    <div class="light"><div class="num">${w}-${l}-${t}</div><div class="lbl">勝-敗-和</div></div>
    <div class="light"><div class="num">${rs}</div><div class="lbl">總得分</div></div>
    <div class="light"><div class="num">${ra}</div><div class="lbl">總失分</div></div>`;
}

/* ───────── 總覽 ───────── */
function renderOverview(){
  const games = windowGames(win.overview);
  const w = games.filter(x=>gameResult(x)==="W").length;
  const l = games.filter(x=>gameResult(x)==="L").length;
  const t = games.length - w - l;
  const rs = games.reduce((s,x)=>s+x.us,0), ra = games.reduce((s,x)=>s+x.them,0);
  const bat = sumBat(battingAgg(games)), pit = sumPit(pitchingAgg(games));
  document.getElementById("ovCards").innerHTML = `
    <div class="card"><div class="v">${w}-${l}-${t}</div><div class="k">區間戰績</div></div>
    <div class="card"><div class="v">${rs} / ${ra}</div><div class="k">得分 / 失分</div></div>
    <div class="card"><div class="v">${f3(bat.AVG)}</div><div class="k">球隊打擊率</div></div>
    <div class="card"><div class="v">${f3(bat.OPS)}</div><div class="k">球隊 OPS</div></div>
    <div class="card"><div class="v">${f2(pit.ERA)}</div><div class="k">球隊防禦率</div></div>
    <div class="card"><div class="v">${f2(pit.WHIP)}</div><div class="k">球隊 WHIP</div></div>`;
  const strip = games.map(g=>`<div class="form-dot ${gameResult(g)}" title="${g.date} vs ${esc(g.opp)} ${g.us}:${g.them}">${gameResult(g)==="W"?"勝":gameResult(g)==="L"?"敗":"和"}</div>`).join("");
  document.getElementById("ovForm").innerHTML = games.length ? `<div class="hint" style="margin-top:4px">近況（左舊右新）</div><div class="form-strip">${strip}</div>` : `<div class="empty">此階級尚無比賽資料，先到「比賽記錄」建立，或用「匯入資料」一次帶入。</div>`;
  drawChart("chartRuns", {
    type:"bar",
    data:{ labels: games.map(g=>g.date.slice(5)+" "+g.opp),
      datasets:[
        {label:"得分",data:games.map(g=>g.us),backgroundColor:"#1c2e5c"},
        {label:"失分",data:games.map(g=>g.them),backgroundColor:"#c34a36"}]},
    options:{responsive:true,plugins:{title:{display:true,text:"每場得失分"}},scales:{y:{beginAtZero:true,ticks:{precision:0}}}}
  });
  const agg = battingAgg(games);
  const rows = Object.entries(agg).filter(([,m])=>m.AB>0)
    .sort((a,b)=> (b[1].OPS||0)-(a[1].OPS||0)).slice(0,10)
    .map(([pid,m],i)=>`<tr><td class="num">${i+1}</td><td class="l">${avatarHTML(getP(pid))} ${nameLink(pid)}</td>
      <td class="num">${m.gp}</td><td class="num">${m.AB}</td><td class="num">${m.H}</td>
      <td class="num">${f3(m.AVG)}</td><td class="num">${f3(m.OBP)}</td><td class="num">${f3(m.SLG)}</td>
      <td class="num"><b>${f3(m.OPS)}</b></td></tr>`).join("");
  document.getElementById("ovLeaders").innerHTML = rows ?
    `<table><thead><tr><th>#</th><th class="l">球員</th><th>場次</th><th>打數</th><th>安打</th><th>打擊率</th><th>上壘率</th><th>長打率</th><th>OPS</th></tr></thead><tbody>${rows}</tbody></table>`
    : `<div class="empty" style="border:none">此區間尚無打擊數據。</div>`;
  // 教練戰績
  const cmap = {};
  games.forEach(g=>{
    const c = (g.coach||"").trim(); if(!c) return;
    const m = cmap[c] = cmap[c]||{gp:0,W:0,L:0,T:0,rs:0,ra:0};
    m.gp++; m[gameResult(g)]++; m.rs+=g.us; m.ra+=g.them;
  });
  const crows = Object.entries(cmap).sort((a,b)=> (b[1].W/(b[1].gp||1))-(a[1].W/(a[1].gp||1)) || b[1].W-a[1].W)
    .map(([c,m])=>`<tr><td class="l"><b>${esc(c)}</b></td><td class="num">${m.gp}</td>
      <td class="num">${m.W}</td><td class="num">${m.L}</td><td class="num">${m.T}</td>
      <td class="num"><b>${m.gp?f3(m.W/m.gp):"-"}</b></td><td class="num">${m.rs} : ${m.ra}</td></tr>`).join("");
  document.getElementById("coachTable").innerHTML = crows ?
    `<div class="tblwrap"><table style="min-width:480px"><thead><tr><th class="l">教練</th><th>帶隊場次</th><th>勝</th><th>敗</th><th>和</th><th>勝率</th><th>得失分</th></tr></thead><tbody>${crows}</tbody></table></div>`
    : `<div class="empty">此區間的比賽尚未登錄帶隊教練。</div>`;
  // 更新教練 datalist
  const dl = document.getElementById("coachList");
  if(dl) dl.innerHTML = coachNames().map(c=>`<option value="${esc(c)}">`).join("");
}

/* ───────── 名單 ───────── */
function renderRoster(){
  const allG = sortedGames();
  const bat = battingAgg(allG), pit = pitchingAgg(allG);
  const list = state.players.filter(p => lvl==="all" || (p.level||"U12")===lvl);
  const rows = list.map(p=>{
    const b = bat[p.id], pi = pit[p.id], c = mvpCounts(p.id);
    return `<tr><td>${avatarHTML(p)}</td><td class="num">${esc(p.num)||"-"}</td>
      <td class="l">${nameLink(p.id)}${p.pos?`<span class="pos-badge">${esc(p.pos)}</span>`:""}${lvlBadge(p.level)}${handBadge(p)}</td>
      <td class="num">${b?b.gp:0} / ${pi?pi.gp:0}</td>
      <td class="num">${b?f3(b.AVG):"-"}</td><td class="num">${pi?f2(pi.ERA):"-"}</td>
      <td class="num">${c.mvp?("⭐"+c.mvp):"-"}</td>
      <td><button class="del" onclick="delPlayer('${p.id}')" title="移除">✕</button></td></tr>`;
  }).join("");
  document.getElementById("rosterTable").innerHTML = rows ?
    `<div class="tblwrap"><table><thead><tr><th></th><th>背號</th><th class="l">球員（點姓名看歷程）</th><th>打擊/投球 場次</th><th>打擊率</th><th>防禦率</th><th>單場MVP</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
    : `<div class="empty">此階級名單是空的，先加入球員或用「匯入資料」。</div>`;
}

/* ───────── 比賽 ───────── */
function playerOptions(sel, level){
  const list = state.players.filter(p => !level || level==="其他" || (p.level||"U12")===level || true);
  return `<option value="">— 選擇球員 —</option>` + state.players
    .slice().sort((a,b)=> ((a.level||"") === (level||"") ? -1 : 0))
    .map(p=>`<option value="${p.id}" ${p.id===sel?"selected":""}>${esc(p.num?p.num+" ":"")}${esc(p.name)}（${esc(p.level||"U12")}）</option>`).join("");
}
function toggleGame(id){ document.getElementById("gc-"+id).classList.toggle("open"); }
function renderGames(){
  const games = lvlGames().slice().reverse();
  if(!games.length){ document.getElementById("gameList").innerHTML = `<div class="empty">此階級尚無比賽。</div>`; return; }
  document.getElementById("gameList").innerHTML = games.map(g=>{
    const r = gameResult(g);
    const batRows = (g.batting||[]).map((l,i)=>`<tr>
      <td class="l">${nameLink(l.pid)}</td><td class="num">${l.AB}</td><td class="num">${l.H}</td>
      <td class="num">${l.d2}</td><td class="num">${l.d3}</td><td class="num">${l.HR}</td>
      <td class="num">${l.BB}</td><td class="num">${l.SF}</td><td class="num">${l.R}</td><td class="num">${l.RBI}</td>
      <td class="num">${l.SO}</td><td class="num">${l.SB}</td><td>${VSP_TXT[l.vsP||""]}</td>
      <td><button class="del" onclick="delLine('${g.id}','batting',${i})">✕</button></td></tr>`).join("");
    const pitRows = (g.pitching||[]).map((l,i)=>`<tr>
      <td class="l">${nameLink(l.pid)}</td><td class="num">${ipStr(l.outs)}</td><td class="num">${l.H}</td>
      <td class="num">${l.R}</td><td class="num">${l.ER}</td><td class="num">${l.BB}</td><td class="num">${l.SO}</td>
      <td class="num">${(l.GO||0)}/${(l.AO||0)}</td>
      <td>${VSB_TXT[l.vsB||""]}</td>
      <td class="num">${l.outs?f2(l.ER*eraBaseOf(g.level)*3/l.outs):"-"}</td>
      <td><button class="del" onclick="delLine('${g.id}','pitching',${i})">✕</button></td></tr>`).join("");
    const comments = (g.comments||[]).map((c,i)=>`<div class="comment"><span class="t">${esc(c.t)}</span>${esc(c.text)}
      <button class="del" style="float:right" onclick="delComment('${g.id}',${i})">✕</button></div>`).join("");
    const media = (g.media||[]).map((m,i)=>{
      const isImg = /^data:image\//.test(m.url) || /\.(jpe?g|png|gif|webp|avif|bmp|heic|heif)(\?|$)/i.test(m.url);
      const isData = /^data:image\//.test(m.url);
      const inner = isImg ? (isData ? `<img src="${m.url}" alt="${esc(m.cap)}">` : `<a href="${esc(m.url)}" target="_blank" rel="noopener"><img src="${esc(m.url)}" alt="${esc(m.cap)}"></a>`)
        : `<div class="vid-thumb">▶</div>`;
      return `<div class="media-item">${inner}<div class="cap">${isImg?"":`<a href="${esc(m.url)}" target="_blank" rel="noopener">開啟連結</a><br>`}${esc(m.cap)||""}
        <button class="del" style="float:right" onclick="delMedia('${g.id}',${i})">✕</button></div></div>`;
    }).join("");
    const mvpTag = g.mvp ? `<span class="gh-mvp">⭐ MVP ${esc(playerName(g.mvp))}</span>` : "";
    return `<div class="game-card" id="gc-${g.id}">
      <div class="game-head" onclick="toggleGame('${g.id}')">
        <span class="gh-date">${g.date}</span>
        <span class="gh-vs">${lvlBadge(g.level)} ${g.tour?`【${esc(g.tour)}】`:""} vs ${esc(g.opp)}${g.coach?` <span class="hint">· ${esc(g.coach)} 教練</span>`:""}</span>
        ${mvpTag}
        <span class="gh-score">${g.us} : ${g.them}</span>
        <span class="res ${r}">${r==="W"?"勝":r==="L"?"敗":"和"}</span>
      </div>
      <div class="game-body">
        <div class="frow" style="justify-content:space-between">
          <div class="frow edit-only">
            <div class="fld"><label>⭐ 單場 MVP</label><select onchange="setGameAward('${g.id}','mvp',this.value)">${playerOptions(g.mvp, g.level)}</select></div>
            <div class="fld"><label>🥈 單場 SVP</label><select onchange="setGameAward('${g.id}','svp',this.value)">${playerOptions(g.svp, g.level)}</select></div>
            <div class="fld"><label>👔 帶隊教練</label><input list="coachList" value="${esc(g.coach||"")}" placeholder="教練姓名" style="width:100px" onchange="setGameCoach('${g.id}',this.value)"></div>
          </div>
          <div class="frow" style="gap:8px">
            ${(state.scouts||[]).some(s=>s.opp===g.opp)?`<button class="btn gold sm" onclick="gotoScout('${(state.scouts.filter(s=>s.opp===g.opp).slice(-1)[0]).id}')">🔍 對手情蒐</button>`:""}
            <button class="btn ghost sm" onclick="copyGameReport('${g.id}')">複製單場戰報</button>
            <button class="btn warn sm" onclick="delGame('${g.id}')">刪除比賽</button>
          </div>
        </div>

        <div class="subhead">打擊登錄（四死球含觸身球）</div>
        ${batRows?`<div class="tblwrap"><table><thead><tr><th class="l">球員</th><th>打數</th><th>安打</th><th>二安</th><th>三安</th><th>全壘打</th><th>四死</th><th>犧飛</th><th>得分</th><th>打點</th><th>三振</th><th>盜壘</th><th>面對投手</th><th></th></tr></thead><tbody>${batRows}</tbody></table></div>`:`<div class="hint">尚未登錄打擊數據。</div>`}
        <div class="frow edit-only" style="margin-top:6px">
          <div class="fld"><label>球員</label><select id="bp-${g.id}">${playerOptions("", g.level)}</select></div>
          ${["AB:打數","H:安打","d2:二安","d3:三安","HR:全壘打","BB:四死","SF:犧飛","R:得分","RBI:打點","SO:三振","SB:盜壘"].map(x=>{const[k,l]=x.split(":");return `<div class="fld w60"><label>${l}</label><input type="number" min="0" value="0" id="b${k}-${g.id}"></div>`;}).join("")}
          <div class="fld"><label>面對投手</label><select id="bvsP-${g.id}"><option value="">不明</option><option value="R">右投</option><option value="L">左投</option><option value="M">混合</option></select></div>
          <button class="btn sm" onclick="addBatLine('${g.id}')">＋ 登錄</button>
        </div>

        <div class="subhead">投球登錄（局數格式 2.1＝2又1/3局；四死含觸身）</div>
        ${pitRows?`<div class="tblwrap"><table><thead><tr><th class="l">球員</th><th>局數</th><th>被安打</th><th>失分</th><th>自責分</th><th>四死</th><th>三振</th><th>滾地/飛球</th><th>面對打線</th><th>單場ERA</th><th></th></tr></thead><tbody>${pitRows}</tbody></table></div>`:`<div class="hint">尚未登錄投球數據。</div>`}
        <div class="frow edit-only" style="margin-top:6px">
          <div class="fld"><label>球員</label><select id="pp-${g.id}">${playerOptions("", g.level)}</select></div>
          <div class="fld w60"><label>局數</label><input id="pIP-${g.id}" placeholder="2.1"></div>
          ${["H:被安打","R:失分","ER:自責分","BB:四死","SO:三振","GO:滾地出局","AO:飛球出局"].map(x=>{const[k,l]=x.split(":");return `<div class="fld w60"><label>${l}</label><input type="number" min="0" value="0" id="p${k}-${g.id}"></div>`;}).join("")}
          <div class="fld"><label>面對打線</label><select id="pvsB-${g.id}"><option value="">不明</option><option value="R">右打為主</option><option value="L">左打為主</option><option value="M">混合</option></select></div>
          <button class="btn sm" onclick="addPitLine('${g.id}')">＋ 登錄</button>
        </div>

        <div class="subhead">即時講評 / 賽況記錄</div>
        ${comments||`<div class="hint">尚無講評，可隨賽況隨時新增（自動附上時間）。</div>`}
        <div class="frow edit-only" style="margin-top:6px">
          <textarea id="cm-${g.id}" placeholder="例：三局下換投，OO 上場中繼，先抓下關鍵雙殺！" style="flex:1;min-width:220px"></textarea>
          <button class="btn sm" onclick="addComment('${g.id}')">＋ 新增講評</button>
        </div>

        <div class="subhead">照片 / 影片連結</div>
        ${media?`<div class="media-grid">${media}</div>`:`<div class="hint">貼上照片或影片網址（Google 相簿、YouTube 等分享連結皆可）。</div>`}
        <div class="frow edit-only" style="margin-top:6px">
          <div class="fld" style="flex:1;min-width:200px"><label>網址</label><input id="mu-${g.id}" placeholder="https://..."></div>
          <div class="fld" style="min-width:140px"><label>說明（選填）</label><input id="mc-${g.id}" placeholder="例：再見安打瞬間"></div>
          <button class="btn sm" onclick="addMedia('${g.id}')">＋ 加入連結</button>
          <label class="btn ghost sm" style="display:inline-flex;align-items:center">📷 上傳照片<input type="file" accept="image/*,.heic,.heif" style="display:none" onchange="uploadMediaFile(this,'${g.id}')"></label>
        </div>
      </div>
    </div>`;
  }).join("");
}
function openCard(gid){ const el=document.getElementById("gc-"+gid); if(el) el.classList.add("open"); }

/* ───────── 打擊 / 投球表 ───────── */
function renderBatting(){
  const games = windowGames(win.batting);
  const agg = battingAgg(games);
  const rows = state.players.filter(p=>agg[p.id]).map(p=>({p, m:agg[p.id]}))
    .sort((a,b)=>(b.m.OPS||0)-(a.m.OPS||0));
  if(!rows.length){ document.getElementById("batTable").innerHTML = `<div class="empty">此區間尚無打擊數據。</div>`; if(charts.chartBat){charts.chartBat.destroy();delete charts.chartBat;} return; }
  const tot = sumBat(agg);
  const html = rows.map(({p,m})=>`<tr><td class="l">${avatarHTML(p)} ${nameLink(p.id)}</td>
    <td class="num">${m.gp}</td><td class="num">${m.PA}</td><td class="num">${m.AB}</td><td class="num">${m.H}</td>
    <td class="num">${m.d2}</td><td class="num">${m.d3}</td><td class="num">${m.HR}</td><td class="num">${m.BB}</td>
    <td class="num">${m.R}</td><td class="num">${m.RBI}</td><td class="num">${m.SO}</td><td class="num">${m.SB}</td>
    <td class="num">${f3(m.AVG)}</td><td class="num">${f3(m.OBP)}</td><td class="num">${f3(m.SLG)}</td><td class="num"><b>${f3(m.OPS)}</b></td></tr>`).join("");
  document.getElementById("batTable").innerHTML = `<div class="tblwrap"><table>
    <thead><tr><th class="l">球員</th><th>場次</th><th>打席</th><th>打數</th><th>安打</th><th>二安</th><th>三安</th><th>全壘打</th><th>四死</th><th>得分</th><th>打點</th><th>三振</th><th>盜壘</th><th>打擊率</th><th>上壘率</th><th>長打率</th><th>OPS</th></tr></thead>
    <tbody>${html}<tr class="total"><td class="l">球隊合計</td><td class="num">${games.length}</td><td class="num">${tot.PA}</td><td class="num">${tot.AB}</td><td class="num">${tot.H}</td><td class="num">${tot.d2}</td><td class="num">${tot.d3}</td><td class="num">${tot.HR}</td><td class="num">${tot.BB}</td><td class="num">${tot.R}</td><td class="num">${tot.RBI}</td><td class="num">${tot.SO}</td><td class="num">${tot.SB}</td><td class="num">${f3(tot.AVG)}</td><td class="num">${f3(tot.OBP)}</td><td class="num">${f3(tot.SLG)}</td><td class="num">${f3(tot.OPS)}</td></tr></tbody></table></div>`;
  drawChart("chartBat", {
    type:"bar",
    data:{ labels: rows.map(r=>r.p.name),
      datasets:[
        {label:"上壘率",data:rows.map(r=>+ (r.m.OBP||0).toFixed(3)),backgroundColor:"#1c2e5c"},
        {label:"長打率",data:rows.map(r=>+ (r.m.SLG||0).toFixed(3)),backgroundColor:"#f0b429"}]},
    options:{indexAxis:"y",responsive:true,plugins:{title:{display:true,text:"球員 OBP / SLG（疊加即為 OPS）"}},scales:{x:{stacked:true,beginAtZero:true},y:{stacked:true}}}
  });
  // 對左右投拆分
  const srows = rows.map(({p})=>{
    const s = batSplitAgg(games, p.id);
    if(!s.R.AB && !s.L.AB) return "";
    return `<tr><td class="l">${nameLink(p.id)}${handBadge(p)}</td>
      <td class="num">${s.R.AB?`${s.R.H}-${s.R.AB}`:"-"}</td><td class="num">${f3(s.R.AVG)}</td><td class="num">${f3(s.R.OPS)}</td>
      <td class="num">${s.L.AB?`${s.L.H}-${s.L.AB}`:"-"}</td><td class="num">${f3(s.L.AVG)}</td><td class="num">${f3(s.L.OPS)}</td></tr>`;
  }).filter(Boolean).join("");
  document.getElementById("batSplit").innerHTML = srows ?
    `<div class="tblwrap"><table style="min-width:560px"><thead><tr><th class="l">球員</th><th>對右投 安-打數</th><th>對右投 AVG</th><th>對右投 OPS</th><th>對左投 安-打數</th><th>對左投 AVG</th><th>對左投 OPS</th></tr></thead><tbody>${srows}</tbody></table></div>`
    : `<div class="empty">尚無拆分數據；打擊登錄時選「面對投手」右投/左投即可累積。</div>`;
}
function renderPitching(){
  const eb = state.eraBases || {U12:6,U15:7,"其他":9};
  const e1=document.getElementById("ebU12"), e2=document.getElementById("ebU15"), e3=document.getElementById("ebOther");
  if(e1){ e1.value=String(eb.U12||6); e2.value=String(eb.U15||7); e3.value=String(eb["其他"]||9); }
  const games = windowGames(win.pitching);
  const agg = pitchingAgg(games);
  const rows = state.players.filter(p=>agg[p.id]).map(p=>({p, m:agg[p.id]}))
    .sort((a,b)=>(isFinite(a.m.ERA)?a.m.ERA:1e9)-(isFinite(b.m.ERA)?b.m.ERA:1e9));
  if(!rows.length){ document.getElementById("pitTable").innerHTML = `<div class="empty">此區間尚無投球數據。</div>`; return; }
  const tot = sumPit(agg);
  const html = rows.map(({p,m})=>`<tr><td class="l">${avatarHTML(p)} ${nameLink(p.id)}</td>
    <td class="num">${m.gp}</td><td class="num">${ipStr(m.outs)}</td><td class="num">${m.H}</td>
    <td class="num">${m.R}</td><td class="num">${m.ER}</td><td class="num">${m.BB}</td><td class="num">${m.SO}</td>
    <td class="num"><b>${m.ERA===Infinity?"INF":f2(m.ERA)}</b></td><td class="num">${f2(m.WHIP)}</td>
    <td class="num">${f2(m.K9)}</td><td class="num">${f2(m.BB9)}</td>
    <td class="num">${m.GOAO===Infinity?"全滾地":f2(m.GOAO)}</td></tr>`).join("");
  document.getElementById("pitTable").innerHTML = `<div class="tblwrap"><table>
    <thead><tr><th class="l">球員</th><th>場次</th><th>局數</th><th>被安打</th><th>失分</th><th>自責分</th><th>四死</th><th>三振</th><th>防禦率</th><th>WHIP</th><th>K/9</th><th>BB/9</th><th>滾飛比</th></tr></thead>
    <tbody>${html}<tr class="total"><td class="l">球隊合計</td><td class="num">${games.length}</td><td class="num">${ipStr(tot.outs)}</td><td class="num">${tot.H}</td><td class="num">${tot.R}</td><td class="num">${tot.ER}</td><td class="num">${tot.BB}</td><td class="num">${tot.SO}</td><td class="num">${f2(tot.ERA)}</td><td class="num">${f2(tot.WHIP)}</td><td class="num">${f2(tot.K9)}</td><td class="num">${f2(tot.BB9)}</td><td class="num">${tot.GOAO===Infinity?"全滾地":f2(tot.GOAO)}</td></tr></tbody></table></div>
    <div class="hint">防禦率依各場比賽的階級局制換算（U12 ${ (state.eraBases||{}).U12||6 } 局、U15 ${ (state.eraBases||{}).U15||7 } 局、其他 ${ (state.eraBases||{})["其他"]||9 } 局）；K/9、BB/9 固定以每 9 局換算；滾飛比＝滾地出局 ÷ 飛球出局，越高代表越會製造滾地球。</div>`;
}

/* ───────── 個人歷程 ───────── */
function openProfile(pid){
  currentPid = pid;
  const p = getP(pid); if(!p) return;
  const allG = sortedGames();
  const myG = allG.filter(g => (g.batting||[]).some(l=>l.pid===pid) || (g.pitching||[]).some(l=>l.pid===pid));
  const bat = battingAgg(allG)[pid], pit = pitchingAgg(allG)[pid];
  const last5 = myG.slice(-5);
  const b5 = battingAgg(last5)[pid], p5 = pitchingAgg(last5)[pid];
  const c = mvpCounts(pid);
  const honorPills = [
    c.mvp ? `<span class="hpill">⭐ 單場 MVP × ${c.mvp}</span>` : "",
    c.svp ? `<span class="hpill">🥈 單場 SVP × ${c.svp}</span>` : "",
    ...c.ai.map(h=>{
      const role = h.pitcher&&h.pitcher.pid===pid ? "投手" : "野手";
      return `<span class="hpill">🏆 ${esc(h.period)} ${h.type==="monthly"?"當月":"年度"}${role} MVP</span>`;
    })
  ].filter(Boolean).join("") || `<span class="hint">尚無獲獎紀錄，繼續加油！</span>`;

  const batCards = bat ? `
    <div class="cards">
      <div class="card"><div class="v">${bat.gp}</div><div class="k">打擊出賽</div></div>
      <div class="card"><div class="v">${f3(bat.AVG)}</div><div class="k">打擊率</div></div>
      <div class="card"><div class="v">${f3(bat.OBP)}</div><div class="k">上壘率</div></div>
      <div class="card"><div class="v">${f3(bat.SLG)}</div><div class="k">長打率</div></div>
      <div class="card"><div class="v">${f3(bat.OPS)}</div><div class="k">OPS</div></div>
      <div class="card"><div class="v">${bat.H}/${bat.HR}</div><div class="k">安打/全壘打</div></div>
      <div class="card"><div class="v">${bat.RBI}</div><div class="k">打點</div></div>
      <div class="card"><div class="v">${bat.SB}</div><div class="k">盜壘</div></div>
    </div>` : `<div class="hint">尚無打擊數據。</div>`;
  const pitCards = pit ? `
    <div class="cards">
      <div class="card"><div class="v">${pit.gp}</div><div class="k">投球出賽</div></div>
      <div class="card"><div class="v">${ipStr(pit.outs)}</div><div class="k">投球局數</div></div>
      <div class="card"><div class="v">${pit.ERA===Infinity?"INF":f2(pit.ERA)}</div><div class="k">防禦率</div></div>
      <div class="card"><div class="v">${f2(pit.WHIP)}</div><div class="k">WHIP</div></div>
      <div class="card"><div class="v">${pit.SO}</div><div class="k">奪三振</div></div>
      <div class="card"><div class="v">${f2(pit.K9)}</div><div class="k">K/9</div></div>
      <div class="card"><div class="v">${pit.GOAO===Infinity?"全滾":isFinite(pit.GOAO)?f2(pit.GOAO):"-"}</div><div class="k">滾飛比</div></div>
    </div>` : `<div class="hint">尚無投球數據。</div>`;

  const trend = last5.length ? `
    <div class="hint" style="margin-bottom:4px">個人出賽的最近 ${last5.length} 場：
      ${b5?`打擊 ${b5.H}-${b5.AB}（AVG ${f3(b5.AVG)}／OPS ${f3(b5.OPS)}）`:""}
      ${p5?`；投球 ${ipStr(p5.outs)} 局 ERA ${p5.ERA===Infinity?"INF":f2(p5.ERA)}、${p5.SO} K`:""}
    </div>` : "";

  const logRows = myG.slice().reverse().map(g=>{
    const bl = (g.batting||[]).filter(l=>l.pid===pid);
    const pl = (g.pitching||[]).filter(l=>l.pid===pid);
    const bTxt = bl.map(l=>`${l.H}-${l.AB}${l.HR?`,${l.HR}轟`:""}${l.RBI?`,${l.RBI}打點`:""}${l.BB?`,${l.BB}四死`:""}`).join("；") || "-";
    const pTxt = pl.map(l=>`${ipStr(l.outs)}局,${l.SO}K,失${l.R}(責${l.ER})`).join("；") || "-";
    const award = g.mvp===pid ? "⭐MVP" : g.svp===pid ? "🥈SVP" : "";
    return `<tr><td class="num">${g.date}</td><td class="l">${lvlBadge(g.level)} vs ${esc(g.opp)}</td>
      <td class="num">${g.us}:${g.them} ${gameResult(g)==="W"?"勝":gameResult(g)==="L"?"敗":"和"}</td>
      <td class="l">${bTxt}</td><td class="l">${pTxt}</td><td>${award}</td></tr>`;
  }).join("");

  document.getElementById("modalBox").innerHTML = `
    <div class="modal-head">
      ${avatarHTML(p, true)}
      <div>
        <h3>${esc(p.name)} <span style="font-family:var(--mono);color:var(--gold)">#${esc(p.num)||"-"}</span></h3>
        <div class="meta">${esc(p.level||"U12")}${p.pos?` · ${esc(p.pos)}`:""}${p.throws?` · ${esc(p.throws)}投`:""}${p.bats?` · ${p.bats==="兩"?"左右開弓":esc(p.bats)+"打"}`:""} · 出賽 ${myG.length} 場</div>
      </div>
      <button class="modal-close" onclick="closeProfile()">關閉 ✕</button>
    </div>
    <div class="modal-body">
      <div class="honor-pills">${honorPills}</div>
      <div class="frow" style="margin:8px 0">
        <label class="btn sm ghost edit-only" style="display:inline-flex;align-items:center">📷 上傳大頭照<input type="file" accept="image/*,.heic,.heif" style="display:none" onchange="uploadAvatarFor(this,'${pid}')"></label>
        <button class="btn sm ghost edit-only" onclick="editPhoto('${pid}')">用網址設定</button>
        <button class="btn sm ghost edit-only" onclick="editPlayer('${pid}')">編輯基本資料</button>
        <button class="btn sm gold" id="advBtn" onclick="aiPlayerAdvice('${pid}')">🤖 AI 個人分析與建議</button>
      </div>
      <div id="advOut"></div>
      <div class="subhead">生涯打擊</div>${batCards}
      <div class="subhead">生涯投球</div>${pitCards}
      <div class="subhead">左右拆分</div>
      ${(()=>{
        const bs = batSplitAgg(allG, pid), ps = pitSplitAgg(allG, pid);
        let h = "";
        if(bs.R.AB || bs.L.AB) h += `<div class="tblwrap"><table style="min-width:420px"><thead><tr><th>打擊</th><th>安-打數</th><th>AVG</th><th>OBP</th><th>SLG</th><th>OPS</th></tr></thead><tbody>
          <tr><td>對右投</td><td class="num">${bs.R.AB?`${bs.R.H}-${bs.R.AB}`:"-"}</td><td class="num">${f3(bs.R.AVG)}</td><td class="num">${f3(bs.R.OBP)}</td><td class="num">${f3(bs.R.SLG)}</td><td class="num">${f3(bs.R.OPS)}</td></tr>
          <tr><td>對左投</td><td class="num">${bs.L.AB?`${bs.L.H}-${bs.L.AB}`:"-"}</td><td class="num">${f3(bs.L.AVG)}</td><td class="num">${f3(bs.L.OBP)}</td><td class="num">${f3(bs.L.SLG)}</td><td class="num">${f3(bs.L.OPS)}</td></tr>
        </tbody></table></div>`;
        if(ps.R.outs || ps.L.outs) h += `<div class="tblwrap"><table style="min-width:420px"><thead><tr><th>投球</th><th>局數</th><th>被安打</th><th>四死</th><th>三振</th><th>ERA</th><th>WHIP</th></tr></thead><tbody>
          <tr><td>對右打為主打線</td><td class="num">${ipStr(ps.R.outs)}</td><td class="num">${ps.R.H}</td><td class="num">${ps.R.BB}</td><td class="num">${ps.R.SO}</td><td class="num">${ps.R.ERA===Infinity?"INF":f2(ps.R.ERA)}</td><td class="num">${f2(ps.R.WHIP)}</td></tr>
          <tr><td>對左打為主打線</td><td class="num">${ipStr(ps.L.outs)}</td><td class="num">${ps.L.H}</td><td class="num">${ps.L.BB}</td><td class="num">${ps.L.SO}</td><td class="num">${ps.L.ERA===Infinity?"INF":f2(ps.L.ERA)}</td><td class="num">${f2(ps.L.WHIP)}</td></tr>
        </tbody></table></div>`;
        return h || `<div class="hint">尚無拆分數據；登錄時選「面對投手／面對打線」即可累積。</div>`;
      })()}
      <div class="subhead">近況與逐場紀錄</div>
      ${trend}
      ${logRows?`<div class="tblwrap"><table style="min-width:560px"><thead><tr><th>日期</th><th class="l">對戰</th><th>比分</th><th class="l">打擊</th><th class="l">投球</th><th>獎項</th></tr></thead><tbody>${logRows}</tbody></table></div>`:`<div class="hint">尚無出賽紀錄。</div>`}
    </div>`;
  document.getElementById("modalBg").classList.add("show");
}
function closeProfile(){ document.getElementById("modalBg").classList.remove("show"); currentPid = null; }
function renderScouts(){
  renderReportOptions();
  const list = (state.scouts||[]).slice().reverse();
  document.getElementById("scoutList").innerHTML = list.length ? list.map(sc=>`
    <div class="scout-card" id="sc-${sc.id}">
      <div class="frow" style="justify-content:flex-end;gap:8px;float:right">
        <button class="btn ghost sm" onclick="copyScoutReport('${sc.id}')">複製報告</button>
        <button class="btn ghost sm edit-only" onclick="editScout('${sc.id}')">編輯文字</button>
        <button class="del" onclick="delScout('${sc.id}')">✕</button>
      </div>
      ${scoutCardHTML(sc,true)}
    </div>`).join("") : `<div class="empty">尚無情蒐報告。賽前先用上方任一方式建立，比賽卡片就會自動出現「對手情蒐」捷徑。</div>`;
}
function renderHonors(){
  // 單場 MVP 列表
  const gm = lvlGames().filter(g=>g.mvp||g.svp).slice().reverse();
  document.getElementById("gameMvpList").innerHTML = gm.length ? `<div class="tblwrap"><table>
    <thead><tr><th>日期</th><th class="l">對戰</th><th>比分</th><th class="l">⭐ MVP</th><th class="l">🥈 SVP</th></tr></thead>
    <tbody>${gm.map(g=>`<tr><td class="num">${g.date}</td><td class="l">${lvlBadge(g.level)} ${g.tour?`【${esc(g.tour)}】`:""}vs ${esc(g.opp)}</td>
      <td class="num">${g.us}:${g.them}</td>
      <td class="l">${g.mvp?nameLink(g.mvp):"-"}</td><td class="l">${g.svp?nameLink(g.svp):"-"}</td></tr>`).join("")}</tbody></table></div>`
    : `<div class="empty">尚未選出任何單場 MVP，可在比賽卡片中選取。</div>`;
  // AI 榮譽榜
  const hs = state.honors.filter(h=> lvl==="all" || h.level==="all" || h.level===lvl).slice().reverse();
  document.getElementById("honorList").innerHTML = hs.length ? hs.map(h=>`
    <div class="honor">
      <span class="tag">${h.type==="monthly"?"當月":"年度"} MVP · ${esc(h.period)}${h.level&&h.level!=="all"?` · ${esc(h.level)}`:""}</span>
      <button class="del" style="float:right" onclick="delHonor('${h.id}')">✕</button>
      <div class="who">⚾ 投手 MVP：<b>${h.pitcher?(h.pitcher.pid?nameLink(h.pitcher.pid):esc(h.pitcher.name)):"從缺"}</b></div>
      ${h.pitcher?`<div class="why">${esc(h.pitcher.reason)}</div>`:""}
      <div class="who" style="margin-top:6px">🏏 野手 MVP：<b>${h.fielder?(h.fielder.pid?nameLink(h.fielder.pid):esc(h.fielder.name)):"從缺"}</b></div>
      ${h.fielder?`<div class="why">${esc(h.fielder.reason)}</div>`:""}
      ${h.summary?`<div class="why" style="margin-top:6px">📝 ${esc(h.summary)}</div>`:""}
    </div>`).join("") : `<div class="empty">榮譽榜還是空的，用上方的 AI 評選產生第一筆吧。</div>`;
}

/* ───────── 匯入 ───────── */
function previewSeasonReport(){
  const p = document.getElementById("reportPreview");
  p.style.display = p.style.display==="none" ? "block" : "none";
  p.textContent = seasonReportText();
}
function drawChart(id, cfg){
  if(charts[id]) charts[id].destroy();
  const ctx = document.getElementById(id);
  if(!ctx || typeof Chart === "undefined") return;
  charts[id] = new Chart(ctx, cfg);
}
function renderAll(){
  renderHeader(); renderOverview(); renderRoster(); renderGames(); renderBatting(); renderPitching(); renderHonors(); renderScouts();
}
function toast(msg){
  const t = document.getElementById("toast");
  t.textContent = msg; t.classList.add("show");
  setTimeout(()=>t.classList.remove("show"), 2400);
}
document.querySelectorAll(".tab").forEach(b => b.onclick = () => {
  document.querySelectorAll(".tab").forEach(x=>x.classList.remove("active"));
  document.querySelectorAll("main section").forEach(x=>x.classList.remove("active"));
  b.classList.add("active");
  document.getElementById(b.dataset.tab).classList.add("active");
});
document.getElementById("lvlChips").addEventListener("click", e=>{
  if(!e.target.classList.contains("chip")) return;
  document.querySelectorAll("#lvlChips .chip").forEach(c=>c.classList.remove("active"));
  e.target.classList.add("active");
  lvl = e.target.dataset.lvl;
  renderAll();
});
[["ovChips","overview"],["batChips","batting"],["pitChips","pitching"]].forEach(([cid,key])=>{
  document.getElementById(cid).addEventListener("click", e => {
    if(!e.target.classList.contains("chip")) return;
    document.querySelectorAll("#"+cid+" .chip").forEach(c=>c.classList.remove("active"));
    e.target.classList.add("active");
    win[key] = e.target.dataset.win;
    renderAll();
  });
});
document.getElementById("aiScope").onchange = function(){
  document.getElementById("aiMonthFld").style.display = this.value==="month"?"":"none";
  document.getElementById("aiYearFld").style.display = this.value==="year"?"":"none";
};

(async () => {
  const now = new Date();
  document.getElementById("gDate").value = now.toISOString().slice(0,10);
  document.getElementById("aiMonth").value = now.toISOString().slice(0,7);
  document.getElementById("aiYear").value = now.getFullYear();
  showImpFormat();
  document.getElementById("permTab").style.display = "none";
  storageOK = await checkStorage();
  if(!storageOK){ showNoStorage(); return; }
  await loadAuth();
  if(!auth || !auth.adminHash){ showAuth("setup"); return; }
  const r = await trySession();
  if(r) enterAs(r); else showAuth("login");
})();
