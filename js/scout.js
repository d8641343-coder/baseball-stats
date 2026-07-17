const PROXIES = [
  { name:"allorigins", make:u=>"https://api.allorigins.win/raw?url="+encodeURIComponent(u), kind:"text" },
  { name:"allorigins2", make:u=>"https://api.allorigins.win/get?url="+encodeURIComponent(u), kind:"json" },
  { name:"corsproxy", make:u=>"https://corsproxy.io/?url="+encodeURIComponent(u), kind:"text" },
  { name:"jina", make:u=>"https://r.jina.ai/"+u, kind:"text" }
];

let netOK = null; // null=未測, true/false
// 「就是棒」myscore.games 等成績網站基於隱私會把球員姓名中間字元遮蔽成 O（例：吳丞淏→吳O淏），
// 2 字姓名沒有統一遮蔽慣例，不處理
function maskMiddleName(name){
  if(!name || name.length < 3) return null;
  return name[0] + "O".repeat(name.length - 2) + name[name.length - 1];
}
const SCOUT_JSON_SPEC = `只回傳 JSON，不要任何其他文字或 markdown，格式：
{"found":true或false,"summary":"對手近況與打法風格，100字內","keyPlayers":[{"name":"姓名或背號","role":"投手或打者或其他","hand":"左或右或不明（投手指投、打者指打）","note":"需要留意的原因與特徵，40字內"}],"strategy":"我方應對建議，80字內","sources":"資料來源簡述，40字內"}
找不到可靠資訊時 found 填 false，summary 說明查詢狀況，keyPlayers 給空陣列，不可以編造球員或數據。`;

/* ───────── AI 設定 / 權限 / 配額 ─────────
   搬到 GitHub Pages 後沒有平台代墊 API 費用，改由管理者在「權限管理 → AI 功能設定」
   填入自己的 Anthropic API Key（存 Firestore teams/warriors/config/ai，
   安全規則限管理者/編輯者可讀）。瀏覽器直連 api.anthropic.com 需帶
   anthropic-dangerous-direct-browser-access 標頭啟用 CORS。*/
const AI_MODELS = [
  { id:"claude-haiku-4-5",  label:"Haiku 4.5（最省）" },
  { id:"claude-sonnet-4-6", label:"Sonnet 4.6（現行預設）" },
  { id:"claude-sonnet-5",   label:"Sonnet 5（較新較強）" },
  { id:"claude-opus-4-8",   label:"Opus 4.8（最強最貴）" }
];
const AI_FEATURES = {
  scout:"AI 網路情蒐", urlscout:"成績網頁分析", gamemvp:"單場 MVP 評選",
  mvp:"月/年度 MVP 評選", advice:"球員個人分析", er:"AI 判定自責分",
  highlight:"AI 賽後焦點總結"
};
// AI 呼叫的 tokens 是即時算出來附進 logEvent 訊息文字（"功能｜model｜tokens 輸入X/輸出Y"），
// 沒有另外存結構化欄位；用量估算面板從這段文字反解析回來，見 auth.js 的 loadAiUsage()。
function parseAiLogMsg(msg){
  const m = String(msg||"").match(/^(.*)｜([\w.-]+)｜tokens 輸入(\d+)\/輸出(\d+)$/);
  if(!m) return null;
  return { feature: m[1], model: m[2], inTok: Number(m[3]), outTok: Number(m[4]) };
}
let aiConf = null, _aiConfUnsub = null;
function aiEnabled(){ return !!(aiConf && aiConf.apiKey); }
function subscribeAiConf(){
  if(_aiConfUnsub || !fs()) return;
  if(role!=="admin" && role!=="editor") return;   // 安全規則也只給這兩種身分讀
  _aiConfUnsub = db.doc("teams/warriors/config/ai").onSnapshot(d=>{
    aiConf = d.exists ? d.data() : {};
    if(typeof renderAiConf === "function") renderAiConf();
  }, e=>{ console.error("AI 設定讀取失敗（可能是 Firestore 安全規則尚未更新）", e); });
}
function localDay(){
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}`;
}
// 每個 AI 功能入口先過這關：身分 → Key → 編輯者每日配額（Firestore transaction 累計）
async function aiGate(feature){
  if(role!=="admin" && role!=="editor"){ toast("AI 功能僅開放管理者與編輯者使用"); return false; }
  if(!aiEnabled()){
    toast(role==="admin"
      ? "尚未設定 Anthropic API Key，請到「權限管理 → AI 功能設定」填入"
      : "AI 功能尚未啟用，請通知管理者設定 API Key");
    return false;
  }
  if(role==="admin") return true;   // 管理者不限次數
  const limit = aiConf.editorDaily === undefined ? 1 : Number(aiConf.editorDaily);
  if(limit <= 0){ toast("管理者目前未開放編輯者使用 AI 功能"); return false; }
  const ref = db.doc(`teams/warriors/aiUsage/${currentUser.uid}_${feature}_${localDay()}`);
  try{
    await db.runTransaction(async tx=>{
      const s = await tx.get(ref);
      const n = s.exists ? (s.data().count||0) : 0;
      if(n >= limit) throw new Error("QUOTA");
      tx.set(ref, { uid:currentUser.uid, email:currentUser.email||"",
        feature, day:localDay(), count:n+1, t:Date.now() });
    });
    return true;
  }catch(e){
    if(e.message === "QUOTA"){
      toast(limit === 1
        ? `因 TOKEN 有限，編輯者的「${AI_FEATURES[feature]||feature}」暫定每天只能呼叫 1 次，今日額度已用完`
        : `因 TOKEN 有限，「${AI_FEATURES[feature]||feature}」每天限 ${limit} 次，今日額度已用完`);
    }else{
      console.error(e); toast("AI 額度檢查失敗："+(e.code||e.message||"請檢查網路"));
    }
    return false;
  }
}

async function callClaude(prompt, useWeb, feature){
  if(!aiEnabled()) throw new Error("尚未設定 API Key");
  const model = aiConf.model || "claude-sonnet-4-6";
  // Haiku 只支援基本版網路搜尋工具；4.6+ 用含動態過濾的新版
  const webTool = /haiku/.test(model) ? "web_search_20250305" : "web_search_20260209";
  const messages = [{role:"user", content: prompt}];
  let text = "", inTok = 0, outTok = 0;
  try{
    for(let round = 0; round < 2; round++){
      const body = { model, max_tokens:1600, messages };
      // max_uses 封頂單次呼叫的搜尋輪數：每多搜一次就要把前面全部結果重送一次當 input，
      // 不設上限容易被沒查到精準資料時瘋狂換關鍵字搜到爆量 token
      if(useWeb) body.tools = [{type:webTool, name:"web_search", max_uses:4}];
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method:"POST",
        headers:{
          "Content-Type":"application/json",
          "x-api-key": aiConf.apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true"
        },
        body: JSON.stringify(body)
      });
      let data;
      try{ data = await res.json(); }
      catch(e){ throw new Error("回應格式異常（HTTP "+res.status+"），請稍後再試"); }
      if(data.error){
        if(res.status === 401) throw new Error("API Key 無效或已被撤銷，請通知管理者更新");
        throw new Error(data.error.message || "API 錯誤");
      }
      if(!Array.isArray(data.content)) throw new Error("回應內容異常，請稍後再試");
      if(data.usage){ inTok += data.usage.input_tokens||0; outTok += data.usage.output_tokens||0; }
      text += data.content.filter(b=>b.type==="text").map(b=>b.text).join("\n");
      // 網路搜尋可能中途暫停或分段，需帶著先前內容續問
      if(data.stop_reason === "pause_turn" || (useWeb && data.stop_reason === "max_tokens")){
        messages.push({role:"assistant", content: data.content});
        if(data.stop_reason === "max_tokens")
          messages.push({role:"user", content:"請直接接續完成，只輸出先前要求的 JSON。"});
        continue;
      }
      break;
    }
    if(!text.trim()) throw new Error("AI 未回傳內容，請稍後再試");
    logEvent("ai", `${AI_FEATURES[feature]||feature||"AI"}｜${model}｜tokens 輸入${inTok}/輸出${outTok}`);
    return text;
  }catch(e){
    logEvent("ai", `${AI_FEATURES[feature]||feature||"AI"} 失敗：${e.message||"未知錯誤"}`);
    throw e;
  }
}
function parseAIJson(text){
  const clean = text.replace(/```json|```/g,"").trim();
  try{ return JSON.parse(clean); }catch(e){}
  const s = clean.indexOf("{"), e2 = clean.lastIndexOf("}");
  if(s<0||e2<0) throw new Error("AI 回覆中找不到結果資料，請再試一次");
  try{ return JSON.parse(clean.slice(s, e2+1)); }
  catch(e){ throw new Error("AI 回覆的資料格式不完整，請再試一次"); }
}

/* ───────── 對戰情蒐 ───────── */
/* ── 備援網路搜尋（多代理 × 多引擎接力） ── */
async function probeNet(){
  try{
    const res = await fetch("https://api.allorigins.win/raw?url=" + encodeURIComponent("https://example.com"), {signal: AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined});
    netOK = res.ok;
  }catch(e){ netOK = false; }
  renderNetBanner();
}
async function proxyFetchText(url, diag){
  for(const p of PROXIES){
    try{
      const res = await fetch(p.make(url));
      if(!res.ok) throw new Error("HTTP "+res.status);
      let text;
      if(p.kind === "json"){ const j = await res.json(); text = j.contents || ""; }
      else text = await res.text();
      if(text && text.length > 200) return text;
      throw new Error("空回應");
    }catch(e){
      if(diag) diag.push(p.name + "→" + (e.message || "連線失敗"));
    }
  }
  throw new Error("所有代理通道皆失敗");
}
function stripHtmlToText(input, limit){
  let text;
  if(/<html|<body|<div/i.test(input)){
    const doc = new DOMParser().parseFromString(input, "text/html");
    doc.querySelectorAll("script,style,noscript,header,footer,nav,iframe").forEach(el=>el.remove());
    text = doc.body ? doc.body.innerText : "";
  }else{
    text = input; // jina 等回傳的純文字/markdown
  }
  return text.replace(/[ \t]+/g," ").replace(/\n{3,}/g,"\n\n").trim().slice(0, limit||6000);
}
function cleanRedirect(url){
  let m = url.match(/uddg=([^&]+)/);
  if(m){ try{ return decodeURIComponent(m[1]); }catch(e){} }
  m = url.match(/[?&]u=(https?[^&]+)/);
  if(m){ try{ return decodeURIComponent(m[1]); }catch(e){} }
  return url;
}
function extractResults(text, max){
  const out = [], seen = {};
  const skip = /bing\.com|duckduckgo\.com|microsoft\.com|go\.microsoft|\.bing\.|jina\.ai|allorigins|corsproxy/;
  const push = (title, url, snippet)=>{
    url = cleanRedirect(String(url||""));
    if(!/^https?:\/\//.test(url) || skip.test(url)) return;
    title = String(title||"").trim();
    if(title.length < 4 || seen[url] || out.length >= max) return;
    seen[url] = 1;
    out.push({title, url, snippet:String(snippet||"").trim().slice(0,300)});
  };
  if(/<html|<a /i.test(text)){
    const doc = new DOMParser().parseFromString(text, "text/html");
    doc.querySelectorAll("li.b_algo").forEach(r=>{                     // Bing
      const a = r.querySelector("h2 a");
      if(a) push(a.textContent, a.getAttribute("href"), (r.querySelector(".b_caption p, p")||{textContent:""}).textContent);
    });
    doc.querySelectorAll(".result").forEach(r=>{                        // DDG html
      const a = r.querySelector("a.result__a");
      if(a) push(a.textContent, a.getAttribute("href"), (r.querySelector(".result__snippet")||{textContent:""}).textContent);
    });
    if(!out.length){                                                     // 一般連結
      doc.querySelectorAll("a[href]").forEach(a=> push(a.textContent, a.getAttribute("href"), ""));
    }
  }
  if(out.length < 3){                                                    // markdown 連結（jina）
    const re = /\[([^\]]{4,})\]\((https?:[^)\s]+)\)/g; let m;
    while((m = re.exec(text)) && out.length < max) push(m[1], m[2], "");
  }
  return out;
}
async function webSearchFallback(query, max, diag){
  const engines = [
    "https://www.bing.com/search?q=" + encodeURIComponent(query) + "&setlang=zh-hant&count=10",
    "https://html.duckduckgo.com/html/?q=" + encodeURIComponent(query),
    "https://lite.duckduckgo.com/lite/?q=" + encodeURIComponent(query)
  ];
  for(const eu of engines){
    try{
      const text = await proxyFetchText(eu, diag);
      const r = extractResults(text, max||8);
      if(r.length) return r;
      if(diag) diag.push(eu.split("/")[2] + "→無法解析結果");
    }catch(e){}
  }
  return [];
}
async function gatherScoutIntel(targets, league, hint, setStatus){
  const main = targets[0];
  const queries = [];
  queries.push(targets.join(" ") + " 棒球" + (league ? " " + league : ""));
  queries.push(main + " 棒球 新聞" + (hint ? " " + hint : ""));
  if(targets[1]) queries.push(targets[1] + " 棒球" + (league ? " " + league : ""));
  const maskedMain = maskMiddleName(main);   // 就是棒等網站可能把姓名中間字元遮蔽成 O，一併查遮蔽寫法
  if(maskedMain) queries.push(maskedMain + " 棒球" + (league ? " " + league : ""));
  const seen = {}, results = [], diag = [];
  for(const q of queries){
    setStatus("搜尋中：" + q.slice(0, 18));
    (await webSearchFallback(q, 8, diag)).forEach(r=>{
      if(!seen[r.url]){ seen[r.url] = 1; results.push(r); }
    });
    if(results.length >= 14) break;
  }
  if(!results.length){
    const d = [...new Set(diag)].slice(0, 6).join("；");
    throw new Error("備援搜尋失敗。診斷：" + (d || "無回應") + "。可改用「指定成績網頁分析」貼上 myscore.games 網址");
  }
  let digest = "【搜尋結果摘要】\n" + results.slice(0,14).map((r,i)=>`${i+1}. ${r.title}\n${r.url}\n${r.snippet}`).join("\n\n");
  const keys = targets.map(t=>t.slice(0,4)).filter(Boolean);
  const cand = results.filter(r => keys.some(k => (r.title + r.snippet).includes(k))).slice(0, 3);
  for(const r of cand){
    setStatus("讀取頁面：" + r.title.slice(0, 16));
    try{
      const t = stripHtmlToText(await proxyFetchText(r.url), 4500);
      if(t.length > 100) digest += `\n\n【頁面內容：${r.title}（${r.url}）】\n${t}`;
    }catch(e){}
  }
  return digest.slice(0, 18000);
}
function buildScoutPrompt(){
  const mode = document.getElementById("scMode").value;
  const opp = document.getElementById("scOpp").value.trim();
  const player = document.getElementById("scPlayer").value.trim();
  const league = document.getElementById("scLeague").value.trim();
  const hint = document.getElementById("scHint").value.trim();
  if(mode === "team" && !opp){ toast("請先填對手隊名"); return null; }
  if(mode === "player" && !player){ toast("請先填選手姓名"); return null; }
  const who = mode === "player"
    ? `棒球選手「${player}」${opp?`（所屬球隊：${opp}）`:""}`
    : `棒球隊「${opp}」`;
  const masked = mode === "player" ? maskMiddleName(player) : null;
  const maskHint = masked ? `就是棒等網站基於隱私可能把姓名中間字元遮蔽成 O，此人可能顯示為「${masked}」，請也嘗試搜尋這個寫法並視為同一人。` : "";
  return `請幫我做賽前情蒐：請用網路搜尋公開資訊（就是棒 myscore.games、賽事官網、新聞報導），調查台灣的${who}${league?`，賽事/聯盟：${league}`:""}${hint?`，補充線索：${hint}`:""}。${maskHint}我的球隊是「親子勇士」，即將與其對戰。
請整理：近況與風格、需要留意的指標球員（含左右投打）與原因、我方應對建議。
最後請「只」輸出一個 JSON 程式碼區塊（不要其他文字），格式：
{"found":true或false,"summary":"近況與風格100字內","keyPlayers":[{"name":"姓名","role":"投手或打者或其他","hand":"左或右或不明","note":"留意原因40字內"}],"strategy":"應對建議80字內","sources":"資料來源40字內"}
查不到可靠資訊時 found 填 false 並在 summary 說明，不可編造。`;
}
async function copyScoutPrompt(){
  const p = buildScoutPrompt();
  if(!p) return;
  await copyText(p, "提問已複製，貼到 Claude 對話送出即可");
}
function parsePastedScout(){
  if(!guardEdit()) return;
  const raw = document.getElementById("scPaste").value.trim();
  const out = document.getElementById("scPasteOut");
  if(!raw){ out.innerHTML = `<div class="hint">請先貼上 Claude 的回覆。</div>`; return; }
  try{
    const r = parseAIJson(raw);
    const mode = document.getElementById("scMode").value;
    const opp = document.getElementById("scOpp").value.trim();
    const player = document.getElementById("scPlayer").value.trim();
    if(!r.found){
      out.innerHTML = `<div class="ai-out">Claude 回報查無可靠資訊：${esc(r.summary||"")}</div>`;
      return;
    }
    const sc = { id:uid(), opp: mode==="player" ? (opp || "選手："+player) : (opp || "未填對手"),
      source:"ai", created:Date.now(),
      summary:r.summary||"", keyPlayers:Array.isArray(r.keyPlayers)?r.keyPlayers:[],
      strategy:r.strategy||"", sources:r.sources||"" };
    state.scouts.push(sc);
    document.getElementById("scPaste").value = "";
    out.innerHTML = "";
    save(); renderAll(); toast("情蒐報告已存檔"); gotoScout(sc.id);
  }catch(e){
    out.innerHTML = `<div class="ai-out">解析失敗：${esc(e.message||"格式不符")}。請確認貼上的是包含 JSON 區塊的完整回覆；也可改用「手動建立情蒐」。</div>`;
  }
}
async function aiScout(){
  const mode = document.getElementById("scMode").value;
  const opp = document.getElementById("scOpp").value.trim();
  const player = document.getElementById("scPlayer").value.trim();
  if(mode === "team" && !opp) return toast("請輸入對手隊名");
  if(mode === "player" && !player) return toast("請輸入選手姓名");
  if(!await aiGate("scout")) return;
  const league = document.getElementById("scLeague").value.trim();
  const hint = document.getElementById("scHint").value.trim();
  const target = mode === "player" ? player : opp;
  const btn = document.getElementById("scBtn");
  const setStatus = t => { btn.innerHTML = `<span class="spinner"></span>${esc(t)}`; };
  btn.disabled = true; setStatus("搜尋整理中…");
  document.getElementById("scOut").innerHTML = "";
  try{
    const masked = mode === "player" ? maskMiddleName(player) : null;
    const maskHint = masked
      ? `「就是棒」myscore.games 等成績網站基於隱私會把姓名中間字元遮蔽成 O，這位選手可能顯示為「${masked}」，請也嘗試用這個寫法搜尋，並視為同一人。`
      : "";
    const taskDesc = mode === "player"
      ? `調查台灣的棒球選手「${player}」${opp?`（所屬球隊：${opp}）`:""}。${maskHint}我方球隊「${state.teamName}」即將與這位選手對戰，請整理：角色（投手/打者）、左右投打、近期表現與特徵、需要留意的原因，以及我方應對建議。keyPlayers 以這位選手為主，同隊其他值得留意者可一併列入。`
      : `調查台灣的棒球隊「${opp}」。我方球隊「${state.teamName}」即將與他們對戰，請整理：對手近況與打法風格、需要留意的指標球員（投手與打者）與原因、以及我方應對建議。`;
    let text = null;
    // 方案一：內建網路搜尋
    try{
      text = await callClaude(`你是棒球隊的賽前情蒐分析師。請用網路搜尋公開資訊，包含聯盟/賽事成績網站（如「就是棒」）與新聞報導，最多搜尋 2~3 次、盡量一次下精準關鍵字，查不到就直接回報 found:false，不要一直換關鍵字重試。${league?`賽事/聯盟：${league}。`:""}${hint?`補充線索：${hint}。`:""}
${taskDesc}
${SCOUT_JSON_SPEC}`, true, "scout");
    }catch(e1){
      // 方案二：自行搜尋後交給 AI 整理
      const digest = await gatherScoutIntel(mode==="player" ? [player, opp].filter(Boolean) : [opp], league, hint, setStatus);
      setStatus("AI 整理報告中…");
      text = await callClaude(`你是棒球隊的賽前情蒐分析師。以下是針對「${target}」的網路搜尋結果與頁面內容，只能依據這些內容整理，不可編造球員或數據；若內容與目標無關或不足，found 填 false 並說明。
${taskDesc}
${SCOUT_JSON_SPEC}

${digest}`, false, "scout");
    }
    const r = parseAIJson(text);
    if(!r.found){
      document.getElementById("scOut").innerHTML = `<div class="ai-out">查無可靠公開資訊：${esc(r.summary||"")}
建議改用「指定成績網頁分析」貼上成績頁網址，或手動建立情蒐。</div>`;
    }else{
      const sc = { id:uid(), opp: mode==="player" ? (opp || "選手："+player) : opp, source:"ai", created:Date.now(),
        summary:r.summary||"", keyPlayers:Array.isArray(r.keyPlayers)?r.keyPlayers:[],
        strategy:r.strategy||"", sources:r.sources||"" };
      document.getElementById("scOut").innerHTML = `<div class="scout-card">${scoutCardHTML(sc,false)}
        <div style="margin-top:10px"><button class="btn gold sm" onclick='saveScout(${JSON.stringify(JSON.stringify(sc))})'>存成情蒐報告</button></div>
        <div class="hint" style="margin-top:6px">提醒：網路情蒐內容請自行核對，存檔後可再手動增修指標人物。</div></div>`;
    }
  }catch(e){
    console.error(e);
    document.getElementById("scOut").innerHTML = `<div class="ai-out">情蒐失敗：${esc(e.message||"未知錯誤")}
可稍後再試，或改用網址分析／手動建立。</div>`;
  }
  btn.disabled = false; btn.textContent = "🔍 開始情蒐";
}
async function urlScout(){
  if(netOK === false){
    document.getElementById("scUrlOut").innerHTML = `<div class="ai-out">⚠️ 目前連不上外部代理服務，無法讀取外部網頁，已為你略過呼叫。
請把成績頁內容直接貼給 Claude 對話整理，再用上方「半自動情蒐」流程貼回解析存檔，或改用「手動建立情蒐」。</div>`;
    return;
  }
  const url = document.getElementById("scUrl").value.trim();
  const opp = document.getElementById("scUrlOpp").value.trim();
  if(!/^https?:\/\//i.test(url)) return toast("請輸入 http/https 開頭的網址");
  if(!opp) return toast("請輸入對手隊名");
  if(!await aiGate("urlscout")) return;
  const btn = document.getElementById("scUrlBtn");
  btn.disabled = true; btn.innerHTML = `<span class="spinner"></span>讀取分析中…`;
  document.getElementById("scUrlOut").innerHTML = "";
  try{
    const pageText = stripHtmlToText(await proxyFetchText(url), 9000);
    if(pageText.length < 50) throw new Error("頁面內容過少或無法讀取");
    const prompt = `以下是從網頁（${url}）擷取的文字內容，請從中整理台灣棒球隊「${opp}」的賽前情蒐：近況與風格、需要留意的指標球員（投手/打者）與原因、我方應對建議。只依據頁面內容，不可編造。
${SCOUT_JSON_SPEC}
【網頁內容開始】
${pageText}
【網頁內容結束】`;
    const text = await callClaude(prompt, false, "urlscout");
    const r = parseAIJson(text);
    if(!r.found){
      document.getElementById("scUrlOut").innerHTML = `<div class="ai-out">此頁面找不到「${esc(opp)}」的可用資訊：${esc(r.summary||"")}</div>`;
    }else{
      const sc = { id:uid(), opp, source:"url", created:Date.now(),
        summary:r.summary||"", keyPlayers:Array.isArray(r.keyPlayers)?r.keyPlayers:[],
        strategy:r.strategy||"", sources:url };
      document.getElementById("scUrlOut").innerHTML = `<div class="scout-card">${scoutCardHTML(sc,false)}
        <div style="margin-top:10px"><button class="btn gold sm" onclick='saveScout(${JSON.stringify(JSON.stringify(sc))})'>存成情蒐報告</button></div></div>`;
    }
  }catch(e){
    console.error(e);
    document.getElementById("scUrlOut").innerHTML = `<div class="ai-out">讀取或分析失敗：${esc(e.message||"此網站可能擋代理或內容需登入")}。可改用「AI 網路情蒐」或手動建立。</div>`;
  }
  btn.disabled = false; btn.textContent = "讀取並分析";
}
function scoutReportText(sid){
  const sc = state.scouts.find(s=>s.id===sid); if(!sc) return "";
  let s = `🔍 ${state.teamName} 賽前情蒐：${sc.opp}\n━━━━━━━━━━━━\n`;
  if(sc.summary) s += `整體觀察：${sc.summary}\n`;
  if((sc.keyPlayers||[]).length){
    s += `\n⚠️ 指標人物\n`;
    sc.keyPlayers.forEach(k=>{ s += `・${k.name}（${k.role||"—"}${k.hand&&k.hand!=="不明"?"，"+k.hand:""}）：${k.note||""}\n`; });
  }
  if(sc.strategy) s += `\n🎯 應對建議：${sc.strategy}\n`;
  if(sc.sources) s += `\n來源：${sc.sources}\n`;
  return s;
}
function copyScoutReport(sid){ copyText(scoutReportText(sid), "情蒐報告已複製"); }
function statsDigest(games){
  const bAgg = battingAgg(games), pAgg = pitchingAgg(games);
  let s = "打者數據（姓名/階級：打數,安打,全壘打,四死,打點,得分,盜壘,AVG,OBP,SLG,OPS）\n";
  Object.entries(bAgg).forEach(([pid,m])=>{
    const p = getP(pid); if(!p || !m.PA) return;
    s += `${p.name}/${p.level||"U12"}：${m.AB},${m.H},${m.HR},${m.BB},${m.RBI},${m.R},${m.SB},${f3(m.AVG)},${f3(m.OBP)},${f3(m.SLG)},${f3(m.OPS)}\n`;
  });
  s += "\n投手數據（姓名/階級：局數,被安打,失分,自責分,四死,三振,ERA,WHIP）\n";
  Object.entries(pAgg).forEach(([pid,m])=>{
    const p = getP(pid); if(!p || !m.outs) return;
    s += `${p.name}/${p.level||"U12"}：${ipStr(m.outs)},${m.H},${m.R},${m.ER},${m.BB},${m.SO},${m.ERA===Infinity?"INF":f2(m.ERA)},${f2(m.WHIP)}\n`;
  });
  return s;
}
function gameBoxDigest(g){
  let s = `本隊 ${g.us} : ${g.them} 對手 ${g.opp}\n`;
  if((g.batting||[]).length){
    s += "打擊（姓名：打數,安打,二安,三安,全壘打,四死,得分,打點,三振,盜壘）\n";
    g.batting.forEach(l=>{ const p = getP(l.pid); if(!p) return;
      s += `${p.name}：${l.AB},${l.H},${l.d2},${l.d3},${l.HR},${l.BB},${l.R},${l.RBI},${l.SO},${l.SB}\n`; });
  }
  if((g.pitching||[]).length){
    s += "投球（姓名：局數,被安打,失分,自責分,四死,三振,滾地,飛球）\n";
    g.pitching.forEach(l=>{ const p = getP(l.pid); if(!p) return;
      s += `${p.name}：${ipStr(l.outs)},${l.H},${l.R},${l.ER},${l.BB},${l.SO},${l.GO||0},${l.AO||0}\n`; });
  }
  return s;
}
async function aiPickGameMvp(gid){
  if(!guardEdit()) return;
  const g = state.games.find(x=>x.id===gid); if(!g) return;
  if(!(g.batting||[]).length && !(g.pitching||[]).length) return toast("本場尚無球員數據，請先登錄打擊/投球");
  if(!await aiGate("gamemvp")) return;
  const r = gameResult(g);
  const isWin = r !== "L";
  const awShort = isWin ? "MVP" : "SVP";
  const aiKey = isWin ? "aiMvp" : "aiSvp";
  const btn = document.getElementById("aiAwBtn-"+gid);
  if(btn){ btn.disabled = true; btn.innerHTML = `<span class="spinner"></span>AI 評選中…`; }
  try{
    const resultTxt = r==="W"?"本隊獲勝":r==="T"?"雙方平手":"本隊落敗";
    const prompt = `你是少棒/青棒球隊的數據分析師。以下是「${state.teamName}」一場比賽（${g.date}，對 ${g.opp}，${resultTxt} ${g.us}:${g.them}）的單場數據。
請從本隊球員中評選一位「單場 ${awShort}」（${isWin?"獲勝／平手方最有價值球員":"落敗方表現最突出的球員"}），可綜合打擊與投球貢獻。
${gameBoxDigest(g)}
只回傳 JSON，不要任何其他文字或 markdown 標記，格式：
{"name":"球員姓名或null","reason":"40字內理由"}
若資料不足以評選，name 填 null 並在 reason 說明。`;
    const text = await callClaude(prompt, false, "gamemvp");
    const clean = text.replace(/```json|```/g,"").trim();
    const rj = JSON.parse(clean);
    if(!rj.name){ toast("AI 判斷本場資料不足以評選"); if(btn){ btn.disabled=false; btn.textContent=`🤖 AI 選出單場 ${awShort}`; } return; }
    const p = state.players.find(x=>x.name===rj.name);
    g[aiKey] = { pid: p?p.id:null, name: rj.name, reason: rj.reason||"" };
    save(); renderAll(); openCard(gid);
    toast(`AI 單場 ${awShort}：${rj.name}`);
  }catch(e){
    console.error(e);
    toast("AI 評選失敗："+(e.message||"未知錯誤"));
    if(btn){ btn.disabled=false; btn.textContent = `🤖 AI 選出單場 ${awShort}`; }
  }
}
/* ───────── AI 賽後焦點總結（給隊內 LINE 分享用，非正式戰報） ───────── */
async function aiGameHighlight(gid){
  if(!guardEdit()) return;
  const g = state.games.find(x=>x.id===gid); if(!g) return;
  if(!(g.batting||[]).length && !(g.pitching||[]).length) return toast("本場尚無球員數據，請先登錄打擊/投球");
  if(!await aiGate("highlight")) return;
  const btn = document.getElementById("hlBtn-"+gid);
  if(btn){ btn.disabled = true; btn.innerHTML = `<span class="spinner"></span>撰寫中…`; }
  try{
    const r = gameResult(g);
    const resultTxt = r==="W"?"獲勝":r==="T"?"平手":"落敗";
    const styleGuide = g.level==="U12"
      ? "對象是 U12 小朋友球員和家長，語氣要「可愛」：多用活潑逗趣的形容、簡單好懂的比喻，像在稱讚小朋友一樣溫暖鼓勵，避免太複雜的戰術術語。"
      : "對象是青少棒球員和家長，語氣要「輕鬆」：像運動主播熱血播報一樣，帶點幽默口語，有畫面感、有梗，但不失專業。";
    const cmts = (g.comments||[]).map(c=>`[${c.t}] ${c.text}`).join("\n");
    const prompt = `你是少棒/青少棒球隊的隨隊小編，要幫「${state.teamName}」寫一篇賽後焦點花絮，會直接貼到 LINE 群組給隊內選手與家長看，目的是娛樂、炒熱氣氛、增加大家對球隊的認同感，不是正式賽事報導。${styleGuide}
提到失誤、失分、被打爆這類負面畫面時，語氣要體諒、鼓勵，聚焦在球員如何撐住、調整、團隊互相補位，絕對不可以用揶揄、嘲諷、消遣、看笑話的方式描寫（例如不要把守備失誤講成好笑的段子、不要挖苦球員），球員或家長讀了不該覺得被消遣。
比賽：${g.date} vs ${g.opp}，${resultTxt} ${g.us}:${g.them}。
以下是本場數據與現場記錄，只能根據這些內容寫作，不可捏造沒發生的情節或數字：
${gameBoxDigest(g)}
${cmts?`\n現場講評記錄：\n${cmts}\n`:""}
請寫繁體中文，結構如下（可依實際亮點調整標題與人數，沒有亮點的部分就略過，不要硬湊）：
1.「本日最佳特寫」：挑一位表現最突出、能串聯打/投/守亮點的球員做重點特寫，下一個吸睛小標題。
2.「🔥 賽後焦點」：介紹其餘 2~4 位有亮點的球員，各自用一個有趣的暱稱/小標題帶出重點數據。
3.「🎙️ 總結」：簡短總結整場比賽氣氛與團隊精神，正向收尾。
全文約 400~600 字，語氣活潑、可用表情符號，但提到的數字（打數/安打/打點等）必須跟上面提供的數據一致，不可加總或換算錯誤。直接輸出文章內容本身，不要加 markdown 符號（#、**），用換行分段即可。`;
    const text = await callClaude(prompt, false, "highlight");
    g.aiHighlight = { text: text.trim(), created: Date.now(), level: g.level };
    save(); renderAll(); openCard(gid);
    toast("賽後焦點總結已產生");
  }catch(e){
    console.error(e);
    toast("撰寫失敗："+(e.message||"未知錯誤"));
    if(btn){ btn.disabled=false; btn.textContent = "🎙️ AI 賽後焦點總結"; }
  }
}
function aiHighlightHTML(g){
  const h = g.aiHighlight; if(!h) return "";
  return `<div class="hint" style="margin-bottom:4px">🤖 以下由 AI 小編自動生成，僅供隊內娛樂分享，非教練/管理者發言</div>
    <div class="ai-out">${esc(h.text)}</div>
    <div class="hint" style="margin-top:4px">AI 撰寫日期：${new Date(h.created).toLocaleDateString("zh-TW")}</div>
    <div class="frow" style="margin-top:6px">
      <button class="btn gold sm" onclick="copyHighlight('${g.id}')">📋 複製文字（貼到 LINE 分享）</button>
      <button class="btn ghost sm" id="hlPdfBtn-${g.id}" onclick="downloadHighlightPDF('${g.id}')">📄 下載 PDF</button>
    </div>`;
}
/* 賽後焦點 PDF：跟球探報告共用 #pdfStage 離屏容器與 rp- 系列排版樣式（見 buildScoutReportHTML）、
   同一套 html2canvas+jsPDF 產生流程，只是內容換成焦點文章本身，不含編輯用的表單/按鈕。*/
function buildHighlightPdfHTML(gid){
  const g = state.games.find(x=>x.id===gid); if(!g || !g.aiHighlight) return "";
  const r = gameResult(g);
  const isWin = r !== "L";
  const awShort = isWin ? "MVP" : "SVP";
  const awIcon = isWin ? "⭐" : "🥈";
  const offPid = isWin ? g.mvp : g.svp;
  const aiAw = isWin ? g.aiMvp : g.aiSvp;
  const logo = document.querySelector(".sb-logo") ? document.querySelector(".sb-logo").src : "";
  let h = `<div class="rp-page">
    <div class="rp-head">
      ${logo?`<img src="${logo}" alt="">`:""}
      <div><h1>${esc(state.teamName)} 賽後焦點</h1>
        <div class="sub">${esc(g.date)}${g.tour?`【${esc(g.tour)}】`:""} vs ${esc(g.opp)}</div></div>
      <div class="rp-vs">比分<br><b>${g.us} : ${g.them}</b><br>${r==="W"?"勝":r==="L"?"敗":"和"}</div>
    </div>`;

  if(offPid || aiAw){
    h += `<div class="rp-sec">${awIcon} 單場 ${awShort}</div><p style="font-size:12.5px;line-height:1.8">`;
    if(offPid) h += `<b>官方/教練選出：</b>${esc(playerName(offPid))}<br>`;
    if(aiAw) h += `<b>🤖 AI 選出：</b>${esc(aiAw.name||playerName(aiAw.pid))}${aiAw.reason?`　${esc(aiAw.reason)}`:""}`;
    h += `</p>`;
  }

  h += `<p style="font-size:11px;color:#999">🤖 以下由 AI 小編自動生成，僅供隊內娛樂分享，非教練/管理者發言</p>
    <div class="rp-note" style="font-size:13px;line-height:1.9">${esc(g.aiHighlight.text)}</div>`;

  if((g.batting||[]).length){
    h += `<div class="rp-sec">打擊登錄</div>
    <table><thead><tr><th class="l">球員</th><th>打數</th><th>安打</th><th>二安</th><th>三安</th><th>全壘打</th><th>四死</th><th>犧飛</th><th>得分</th><th>打點</th><th>三振</th><th>盜壘</th></tr></thead><tbody>`;
    g.batting.forEach(l=>{
      h += `<tr><td class="l">${esc(playerName(l.pid))}</td><td>${l.AB}</td><td>${l.H}</td><td>${l.d2}</td><td>${l.d3}</td><td>${l.HR}</td>
        <td>${l.BB}</td><td>${l.SF}</td><td>${l.R}</td><td>${l.RBI}</td><td>${l.SO}</td><td>${l.SB}</td></tr>`;
    });
    h += `</tbody></table>`;
  }
  if((g.pitching||[]).length){
    h += `<div class="rp-sec">投球登錄</div>
    <table><thead><tr><th class="l">球員</th><th>局數</th><th>被安打</th><th>失分</th><th>自責分</th><th>四死</th><th>三振</th><th>滾地/飛球</th></tr></thead><tbody>`;
    g.pitching.forEach(l=>{
      h += `<tr><td class="l">${esc(playerName(l.pid))}</td><td>${ipStr(l.outs)}</td><td>${l.H}</td><td>${l.R}</td><td>${l.ER}</td><td>${l.BB}</td><td>${l.SO}</td><td>${(l.GO||0)}/${(l.AO||0)}</td></tr>`;
    });
    h += `</tbody></table>`;
  }
  if((g.media||[]).length){
    h += `<div class="rp-sec">照片 / 影片連結</div><p style="font-size:11.5px;line-height:1.9">`;
    g.media.forEach(m=>{ h += `${m.cap?esc(m.cap)+"：":""}${esc(m.url)}<br>`; });
    h += `</p>`;
  }

  h += `<div class="rp-foot"><span>${esc(state.teamName)} · 攻守數據中心</span><span>AI 生成內容，僅供隊內娛樂分享參考</span></div></div>`;
  return h;
}
async function downloadHighlightPDF(gid){
  const g = state.games.find(x=>x.id===gid); if(!g || !g.aiHighlight) return;
  const btn = document.getElementById("hlPdfBtn-"+gid);
  if(btn){ btn.disabled = true; btn.innerHTML = `<span class="spinner"></span>產生中…`; }
  try{
    const ok = await loadPdfLibs();
    if(!ok) throw new Error("PDF 函式庫載入失敗，請檢查網路後重試");
    const stage = document.getElementById("pdfStage");
    stage.innerHTML = buildHighlightPdfHTML(gid);
    await new Promise(r=>setTimeout(r, 120));   // 等待圖片渲染
    const canvas = await html2canvas(stage, {scale:2, backgroundColor:"#ffffff", logging:false});
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({unit:"mm", format:"a4", orientation:"portrait"});
    const pageW = 210, pageH = 297;
    const pxPerPage = canvas.width * pageH / pageW;
    let rendered = 0, page = 0;
    while(rendered < canvas.height){
      const sliceH = Math.min(pxPerPage, canvas.height - rendered);
      const slice = document.createElement("canvas");
      slice.width = canvas.width; slice.height = sliceH;
      slice.getContext("2d").drawImage(canvas, 0, rendered, canvas.width, sliceH, 0, 0, canvas.width, sliceH);
      if(page > 0) pdf.addPage();
      pdf.addImage(slice.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, pageW, sliceH * pageW / canvas.width);
      rendered += sliceH; page++;
    }
    pdf.save(`${state.teamName}_賽後焦點_${g.date}.pdf`);
    stage.innerHTML = "";
    toast("PDF 已下載");
  }catch(e){
    console.error(e);
    toast("PDF 產生失敗："+(e.message||"請稍後再試"));
  }
  if(btn){ btn.disabled = false; btn.textContent = "📄 下載 PDF"; }
}
async function aiPickMVP(){
  const scope = document.getElementById("aiScope").value;
  let period, games;
  if(scope==="month"){
    period = document.getElementById("aiMonth").value;
    if(!period) return toast("請選擇月份");
    games = lvlGames().filter(g=>g.date.startsWith(period));
  }else{
    period = String(document.getElementById("aiYear").value||"").trim();
    if(!/^\d{4}$/.test(period)) return toast("請輸入年度，例：2026");
    games = lvlGames().filter(g=>g.date.startsWith(period));
  }
  if(!games.length) return toast("該期間沒有比賽資料");
  const hasBat = games.some(g=>(g.batting||[]).length), hasPit = games.some(g=>(g.pitching||[]).length);
  if(!hasBat && !hasPit) return toast("該期間尚無球員數據，請先登錄或匯入");
  if(!await aiGate("mvp")) return;
  const btn = document.getElementById("aiBtn");
  btn.disabled = true; btn.innerHTML = `<span class="spinner"></span>AI 評選中…`;
  document.getElementById("aiResult").innerHTML = "";
  try{
    const prompt = `你是少棒/青棒球隊的數據分析師。以下是「${state.teamName}」${period} 期間（階級：${lvl==="all"?"全隊":lvl}）的球員累積數據。
請評選一位「投手 MVP」與一位「野手 MVP」（野手依打擊表現）。評選需兼顧數據品質與樣本量（局數/打席太少者謹慎給獎）。
${statsDigest(games)}
只回傳 JSON，不要任何其他文字或 markdown 標記，格式：
{"pitcher":{"name":"姓名或null","reason":"50字內理由"},"fielder":{"name":"姓名或null","reason":"50字內理由"},"summary":"整體評語60字內"}
若某類別無足夠數據，name 填 null 並在 reason 說明。`;
    const text = await callClaude(prompt, false, "mvp");
    const clean = text.replace(/```json|```/g,"").trim();
    const r = JSON.parse(clean);
    const findPid = n => { const p = state.players.find(p=>p.name===n); return p?p.id:null; };
    const honor = { id:uid(), type: scope==="month"?"monthly":"yearly", period, level:lvl,
      pitcher: r.pitcher&&r.pitcher.name ? {pid:findPid(r.pitcher.name), name:r.pitcher.name, reason:r.pitcher.reason} : null,
      fielder: r.fielder&&r.fielder.name ? {pid:findPid(r.fielder.name), name:r.fielder.name, reason:r.fielder.reason} : null,
      summary: r.summary||"", created: Date.now() };
    document.getElementById("aiResult").innerHTML = `
      <div class="honor">
        <span class="tag">${scope==="month"?"當月":"年度"} MVP 評選結果 · ${esc(period)}</span>
        <div class="who">⚾ 投手 MVP：<b>${honor.pitcher?esc(honor.pitcher.name):"從缺"}</b></div>
        <div class="why">${esc(honor.pitcher?honor.pitcher.reason:(r.pitcher&&r.pitcher.reason)||"數據不足")}</div>
        <div class="who" style="margin-top:8px">🏏 野手 MVP：<b>${honor.fielder?esc(honor.fielder.name):"從缺"}</b></div>
        <div class="why">${esc(honor.fielder?honor.fielder.reason:(r.fielder&&r.fielder.reason)||"數據不足")}</div>
        <div class="why" style="margin-top:8px">📝 ${esc(honor.summary)}</div>
        <div style="margin-top:10px"><button class="btn gold sm" onclick='saveHonor(${JSON.stringify(JSON.stringify(honor))})'>存入榮譽榜</button></div>
      </div>`;
  }catch(e){
    console.error(e);
    document.getElementById("aiResult").innerHTML = `<div class="ai-out">AI 評選失敗：${esc(e.message||"未知錯誤")}，請稍後再試。</div>`;
  }
  btn.disabled = false; btn.textContent = "🏆 AI 開始評選";
}
async function aiPlayerAdvice(pid){
  const p = getP(pid); if(!p) return;
  const allG = sortedGames();
  const myG = allG.filter(g => (g.batting||[]).some(l=>l.pid===pid) || (g.pitching||[]).some(l=>l.pid===pid));
  if(!myG.length) return toast("此球員尚無數據可分析");
  if(!await aiGate("advice")) return;
  const bat = battingAgg(allG)[pid], pit = pitchingAgg(allG)[pid];
  const last5 = myG.slice(-5);
  const b5 = battingAgg(last5)[pid], p5 = pitchingAgg(last5)[pid];
  const btn = document.getElementById("advBtn");
  btn.disabled = true; btn.innerHTML = `<span class="spinner"></span>分析中…`;
  try{
    let d = `球員：${p.name}（${p.level||"U12"}${p.pos?"，守位 "+p.pos:""}${p.throws?"，"+p.throws+"投":""}${p.bats?"，"+(p.bats==="兩"?"左右開弓":p.bats+"打"):""}），出賽 ${myG.length} 場。\n`;
    const bs = batSplitAgg(allG, pid), ps2 = pitSplitAgg(allG, pid);
    if(bs.R.AB||bs.L.AB) d += `打擊拆分：對右投 ${bs.R.H}-${bs.R.AB}（OPS ${f3(bs.R.OPS)}），對左投 ${bs.L.H}-${bs.L.AB}（OPS ${f3(bs.L.OPS)}）。\n`;
    if(ps2.R.outs||ps2.L.outs) d += `投球拆分：對右打為主打線 ${ipStr(ps2.R.outs)} 局 ERA ${ps2.R.ERA===Infinity?"INF":f2(ps2.R.ERA)}，對左打為主 ${ipStr(ps2.L.outs)} 局 ERA ${ps2.L.ERA===Infinity?"INF":f2(ps2.L.ERA)}。\n`;
    if(bat) d += `生涯打擊：${bat.AB} 打數 ${bat.H} 安（二安${bat.d2}/三安${bat.d3}/全壘打${bat.HR}），四死 ${bat.BB}，三振 ${bat.SO}，盜壘 ${bat.SB}，AVG ${f3(bat.AVG)}，OBP ${f3(bat.OBP)}，SLG ${f3(bat.SLG)}，OPS ${f3(bat.OPS)}。\n`;
    if(b5) d += `近5場打擊：${b5.H}-${b5.AB}，OPS ${f3(b5.OPS)}，三振 ${b5.SO}，四死 ${b5.BB}。\n`;
    if(pit) d += `生涯投球：${ipStr(pit.outs)} 局，被安打 ${pit.H}，四死 ${pit.BB}，三振 ${pit.SO}，自責 ${pit.ER}，ERA ${pit.ERA===Infinity?"INF":f2(pit.ERA)}（依 U12 六局 / U15 七局制換算），WHIP ${f2(pit.WHIP)}，K/9 ${f2(pit.K9)}，BB/9 ${f2(pit.BB9)}${isFinite(pit.GOAO)?"，滾飛比 "+f2(pit.GOAO):""}。\n`;
    if(p5) d += `近5場投球：${ipStr(p5.outs)} 局，ERA ${p5.ERA===Infinity?"INF":f2(p5.ERA)}，${p5.SO} K，${p5.BB} 四死。\n`;
    const prompt = `你是親切的青少棒球隊教練兼數據分析師。根據以下球員數據，用繁體中文寫一段給球員與家長看的分析（250字內）：包含 1)近況與亮點 2)可加強之處 3)一個具體練習建議。語氣正面鼓勵、以成長為導向，不要用表格或markdown符號，直接輸出文字。\n${d}`;
    const text = await callClaude(prompt, false, "advice");
    p.aiAdvice = { text: text.trim(), created: Date.now() };
    await save();
    document.getElementById("advOut").innerHTML = aiAdviceHTML(p.aiAdvice);
  }catch(e){
    document.getElementById("advOut").innerHTML = `<div class="ai-out">分析失敗：${esc(e.message||"未知錯誤")}，請稍後再試。</div>`;
  }
  btn.disabled = false; btn.textContent = "🤖 AI 個人分析與建議";
}
function aiAdviceHTML(adv){
  return `<div class="ai-out">${esc(adv.text)}</div><div class="hint" style="margin-top:4px">AI 分析日期：${new Date(adv.created).toLocaleDateString("zh-TW")}</div>`;
}

/* ───────── AI 判斷自責分 ───────── */
function toggleErPanel(gid){
  const el = document.getElementById("erPanel-"+gid);
  if(el) el.style.display = el.style.display === "none" ? "" : "none";
}
async function aiJudgeER(gid){
  const g = state.games.find(x=>x.id===gid); if(!g) return;
  const desc = document.getElementById("erDesc-"+gid).value.trim();
  if(!desc) return toast("請先描述失分過程（或先在下方新增講評）");
  const R = Math.max(0, Number(document.getElementById("pR-"+gid).value)||0);
  if(!R) return toast("請先在上方填入該投手的「失分」，AI 會在失分範圍內判定自責分");
  if(!await aiGate("er")) return;
  const pid = document.getElementById("pp-"+gid).value;
  const btn = document.getElementById("erBtn-"+gid);
  const out = document.getElementById("erOut-"+gid);
  btn.disabled = true; btn.innerHTML = `<span class="spinner"></span>判定中…`;
  out.innerHTML = "";
  try{
    const prompt = `你是棒球比賽的官方記錄員。請依正式棒球規則判定投手的自責分（earned run）：
- 因守備失誤、捕逸而上壘、進壘或延長局面（該局本應三出局結束）所形成的得分，不計自責分；判斷時採「重建無失誤與捕逸局面」原則。
- 安打、四死球、觸身球、暴投、犧牲打、盜壘、野手選擇造成的得分，計自責分。
- 中繼接手時，壘上繼承跑者的失分責任歸原投手。
比賽：${g.date} vs ${g.opp}${pid?`，投手：${playerName(pid)}`:""}，該投手任內共失 ${R} 分。
現場記錄描述如下：
${desc}
只回傳 JSON，不要任何其他文字或 markdown：{"er":自責分數字,"reason":"判定過程與依據，100字內"}
自責分介於 0 到 ${R} 之間；若描述不足以完整判斷，做最合理判定並在 reason 說明所做的假設。`;
    const text = await callClaude(prompt, false, "er");
    const r = parseAIJson(text);
    const er = Math.max(0, Math.min(R, Number(r.er)||0));
    document.getElementById("pER-"+gid).value = er;
    pendingErAI[gid] = {pid, reason: r.reason||"", desc};
    out.innerHTML = `<div class="ai-out" style="margin:8px 0 0">⚖️ 判定自責分：<b>${er}</b>（失分 ${R}）
${esc(r.reason||"")}
已自動填入上方「自責分」欄位，確認無誤後再按「＋ 登錄」；AI 判定僅供參考，可自行修改。</div>`;
  }catch(e){
    console.error(e);
    out.innerHTML = `<div class="ai-out" style="margin:8px 0 0">判定失敗：${esc(e.message||"未知錯誤")}，請稍後再試或手動填寫。</div>`;
  }
  btn.disabled = false; btn.textContent = "⚖️ AI 判定自責分";
}


/* ───────── 球探報告 PDF ───────── */
function scoutCardHTML(sc, saved){
  const kp = (sc.keyPlayers||[]).map((k,i)=>`<tr>
    <td class="l"><b>${esc(k.name)}</b></td><td>${esc(k.role||"")}${k.hand&&k.hand!=="不明"?`（${esc(k.hand)}）`:""}</td><td class="l">${esc(k.note||"")}</td>
    ${saved?`<td><button class="del" onclick="delKeyPlayer('${sc.id}',${i})">✕</button></td>`:"<td></td>"}</tr>`).join("");
  return `
    <div style="font-size:15px;font-weight:700">🔍 對手：${esc(sc.opp)}
      <span class="src-tag src-${sc.source}">${sc.source==="ai"?"網路情蒐":sc.source==="url"?"網頁分析":"手動"}</span>
      ${saved?`<span class="hint" style="font-weight:400;margin-left:8px">${new Date(sc.created).toLocaleDateString("zh-TW")}</span>`:""}
    </div>
    <div style="font-size:14px;margin:8px 0">${esc(sc.summary||"")}</div>
    ${kp?`<div class="tblwrap"><table style="min-width:420px"><thead><tr><th class="l">指標人物</th><th>角色（左右）</th><th class="l">留意說明</th><th></th></tr></thead><tbody>${kp}</tbody></table></div>`
       :`<div class="hint">尚無指標人物。</div>`}
    ${saved?`<div class="frow edit-only" style="margin:6px 0">
      <input id="kn-${sc.id}" placeholder="姓名/背號" style="width:100px">
      <select id="kr-${sc.id}" style="width:84px"><option>投手</option><option>打者</option><option>其他</option></select>
      <select id="kh-${sc.id}" style="width:78px"><option>不明</option><option>右</option><option>左</option></select>
      <input id="kt-${sc.id}" placeholder="留意說明" style="flex:1;min-width:150px">
      <button class="btn sm" onclick="addKeyPlayer('${sc.id}')">＋ 指標人物</button>
    </div>`:""}
    ${sc.strategy?`<div class="comment" style="border-left-color:var(--navy)"><b>應對建議：</b>${esc(sc.strategy)}</div>`:""}
    ${sc.sources?`<div class="hint">資料來源：${esc(sc.sources)}</div>`:""}`;
}

function renderNetBanner(){
  const el = document.getElementById("netBanner");
  if(!el) return;
  if(netOK === true){
    el.innerHTML = `<div class="hint" style="background:#e8f3ec;border:1px solid #b9d9c5;border-radius:8px;padding:8px 12px;margin:10px 0">✅ 外部連線正常，AI 網路情蒐與網頁分析可以使用。${(role==="admin"||role==="editor") && !aiEnabled() ? "（AI 功能尚未設定 API Key，請管理者到「權限管理 → AI 功能設定」啟用）" : ""}</div>`;
  }else if(netOK === false){
    el.innerHTML = `<div style="background:#fdf3d7;border:1px solid #ecd48a;border-radius:8px;padding:12px;margin:10px 0;font-size:14px">
      <b>⚠️ 目前連不上外部代理服務</b>，「指定成績網頁分析」與備援搜尋暫時無法使用；「AI 網路情蒐」不受影響（用 AI 內建網路搜尋）。<br><br>
      也可以改用半自動流程：<br>
      1️⃣ 在 Claude 對話中請 Claude 幫忙：「幫我情蒐○○隊／○○選手」<br>
      2️⃣ 把結果貼到下方「<b>半自動情蒐</b>」解析存檔，全隊即可查看，比賽卡片也會自動連結</div>`;
  }else{
    el.innerHTML = "";
  }
}
function scModeChange(){
  const isP = document.getElementById("scMode").value === "player";
  document.getElementById("scPlayerFld").style.display = isP ? "" : "none";
  document.getElementById("scOppLbl").textContent = isP ? "所屬球隊（選填）" : "對手隊名";
  document.getElementById("scOpp").placeholder = isP ? "例：向上" : "例：向上";
}
function gotoScout(sid){
  document.querySelector('[data-tab="scout"]').click();
  setTimeout(()=>{
    const el = document.getElementById("sc-"+sid);
    if(el){ el.scrollIntoView({behavior:"smooth",block:"center"}); el.classList.add("flash");
      setTimeout(()=>el.classList.remove("flash"), 2000); }
  }, 60);
}
function renderReportOptions(){
  const sel = document.getElementById("rpScout");
  if(!sel) return;
  const cur = sel.value;
  sel.innerHTML = `<option value="">（不含對手情蒐）</option>` +
    (state.scouts||[]).slice().reverse().map(s=>
      `<option value="${s.id}">${esc(s.opp)}（${new Date(s.created).toLocaleDateString("zh-TW")}）</option>`).join("");
  if(cur) sel.value = cur;
}
function loadScript(src){
  return new Promise(res=>{ const s=document.createElement("script"); s.src=src; s.onload=res; s.onerror=res; document.head.appendChild(s); });
}
async function loadPdfLibs(){
  if(typeof html2canvas === "undefined")
    await loadScript("https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js");
  if(!(window.jspdf && window.jspdf.jsPDF))
    await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js");
  return (typeof html2canvas !== "undefined") && window.jspdf && window.jspdf.jsPDF;
}
function buildScoutReportHTML(){
  const sid = document.getElementById("rpScout").value;
  const w = document.getElementById("rpWin").value;
  const note = document.getElementById("rpNote").value.trim();
  const sc = sid ? state.scouts.find(s=>s.id===sid) : null;
  const games = windowGames(w);
  const winTxt = w==="all" ? "全部賽事" : w==="1m" ? "近一個月" : "近 " + w + " 場";
  const lvlTxt = lvl==="all" ? "全隊" : lvl;
  const tourTxt = tourFilter==="all" ? "" : tourFilter;   // 頂部選取的賽事名稱，全部時不顯示
  const logo = document.querySelector(".sb-logo") ? document.querySelector(".sb-logo").src : "";

  const wn = games.filter(g=>gameResult(g)==="W").length;
  const ln = games.filter(g=>gameResult(g)==="L").length;
  const tn = games.length - wn - ln;
  const rs = games.reduce((s,g)=>s+g.us,0), ra = games.reduce((s,g)=>s+g.them,0);
  const bAgg = battingAgg(games), pAgg = pitchingAgg(games);
  const tb = sumBat(bAgg), tp = sumPit(pAgg);
  const form = games.map(g=>gameResult(g)==="W"?"勝":gameResult(g)==="L"?"敗":"和").join(" ");

  let h = `<div class="rp-page">
    <div class="rp-head">
      ${logo?`<img src="${logo}" alt="">`:""}
      <div><h1>親子勇士 球探報告</h1>
        <div class="sub">SCOUTING REPORT · ${lvlTxt}${tourTxt?" · "+esc(tourTxt):""} · 產生日期 ${new Date().toLocaleDateString("zh-TW")}</div></div>
      ${sc?`<div class="rp-vs">對戰對手<br><b>${esc(sc.opp)}</b></div>`:""}
    </div>`;

  if(sc){
    h += `<div class="rp-sec">一、對手情蒐${sc.source==="manual"?"（教練觀察）":"（AI 整理，請自行核對）"}</div>`;
    if(sc.summary) h += `<p><b>整體觀察：</b>${esc(sc.summary)}</p>`;
    if((sc.keyPlayers||[]).length){
      h += `<table><thead><tr><th class="l">指標人物</th><th>角色</th><th>左右</th><th class="l">留意說明</th></tr></thead><tbody>`;
      sc.keyPlayers.forEach(k=>{
        h += `<tr><td class="l"><b>${esc(k.name)}</b></td><td>${esc(k.role||"—")}</td><td>${esc(k.hand||"不明")}</td><td class="l">${esc(k.note||"")}</td></tr>`;
      });
      h += `</tbody></table>`;
    }
    if(sc.strategy) h += `<p><b>🎯 應對建議：</b>${esc(sc.strategy)}</p>`;
    if(sc.sources) h += `<p style="color:#999;font-size:10.5px">來源：${esc(sc.sources)}</p>`;
  }

  h += `<div class="rp-sec">${sc?"二":"一"}、我方球隊近況（${winTxt}）</div>`;
  if(!games.length){
    h += `<p>此範圍尚無比賽資料。</p>`;
  }else{
    h += `<div class="rp-cards">
      <div class="rp-card"><div class="v">${wn}-${ln}-${tn}</div><div class="k">戰績</div></div>
      <div class="rp-card"><div class="v">${rs} : ${ra}</div><div class="k">得失分</div></div>
      <div class="rp-card"><div class="v">${f3(tb.AVG)}</div><div class="k">團隊打擊率</div></div>
      <div class="rp-card"><div class="v">${f3(tb.OPS)}</div><div class="k">團隊 OPS</div></div>
      <div class="rp-card"><div class="v">${f2(tp.ERA)}</div><div class="k">團隊防禦率</div></div>
      <div class="rp-card"><div class="v">${f2(tp.WHIP)}</div><div class="k">團隊 WHIP</div></div>
    </div>
    <p><b>近況：</b>${form}（左舊右新）</p>`;

    const bRows = state.players.filter(p=>bAgg[p.id] && bAgg[p.id].PA>0)
      .map(p=>({p,m:bAgg[p.id]})).sort((a,b)=>(b.m.OPS||0)-(a.m.OPS||0));
    if(bRows.length){
      h += `<div class="rp-sec">${sc?"三":"二"}、我方打者近況</div>
      <table><thead><tr><th class="l">球員</th><th>投打</th><th>場次</th><th>打數</th><th>安打</th><th>全壘打</th><th>四死</th><th>打點</th><th>三振</th><th>盜壘</th><th>打擊率</th><th>上壘率</th><th>長打率</th><th>OPS</th></tr></thead><tbody>`;
      bRows.forEach(({p,m})=>{
        const hand = (p.throws?p.throws+"投":"") + (p.bats?(p.bats==="兩"?"左右":p.bats)+"打":"") || "—";
        h += `<tr><td class="l"><b>${esc(p.name)}</b>${p.num?` #${esc(p.num)}`:""}</td><td>${hand}</td>
          <td>${m.gp}</td><td>${m.AB}</td><td>${m.H}</td><td>${m.HR}</td><td>${m.BB}</td><td>${m.RBI}</td><td>${m.SO}</td><td>${m.SB}</td>
          <td>${f3(m.AVG)}</td><td>${f3(m.OBP)}</td><td>${f3(m.SLG)}</td><td><b>${f3(m.OPS)}</b></td></tr>`;
      });
      h += `</tbody></table>`;
    }
    const pRows = state.players.filter(p=>pAgg[p.id] && pAgg[p.id].outs>0)
      .map(p=>({p,m:pAgg[p.id]})).sort((a,b)=>(isFinite(a.m.ERA)?a.m.ERA:1e9)-(isFinite(b.m.ERA)?b.m.ERA:1e9));
    if(pRows.length){
      h += `<div class="rp-sec">${sc?"四":"三"}、我方投手近況</div>
      <table><thead><tr><th class="l">球員</th><th>投</th><th>場次</th><th>局數</th><th>被安打</th><th>四死</th><th>三振</th><th>防禦率</th><th>WHIP</th><th>K/9</th><th>滾飛比</th></tr></thead><tbody>`;
      pRows.forEach(({p,m})=>{
        h += `<tr><td class="l"><b>${esc(p.name)}</b>${p.num?` #${esc(p.num)}`:""}</td><td>${p.throws?p.throws+"投":"—"}</td>
          <td>${m.gp}</td><td>${ipStr(m.outs)}</td><td>${m.H}</td><td>${m.BB}</td><td>${m.SO}</td>
          <td><b>${m.ERA===Infinity?"INF":f2(m.ERA)}</b></td><td>${f2(m.WHIP)}</td><td>${f2(m.K9)}</td><td>${m.GOAO===Infinity?"全滾":isFinite(m.GOAO)?f2(m.GOAO):"-"}</td></tr>`;
      });
      h += `</tbody></table>
      <p style="color:#999;font-size:10.5px">防禦率依比賽階級局制換算（U12 ${(state.eraBases||{}).U12||6} 局 / U15 ${(state.eraBases||{}).U15||7} 局 / U18 ${(state.eraBases||{}).U18||7} 局 / OB ${(state.eraBases||{}).OB||9} 局）。</p>`;
    }
  }

  if(note) h += `<div class="rp-sec">教練註記</div><div class="rp-note">${esc(note)}</div>`;
  h += `<div class="rp-foot"><span>親子勇士 WARRIORS · 攻守數據中心</span><span>本報告數據僅供隊內參考</span></div></div>`;
  return h;
}
function previewScoutPDF(){
  const box = document.getElementById("rpPreview");
  if(box.style.display !== "none"){ box.style.display = "none"; return; }
  box.innerHTML = `<div style="transform-origin:top left;background:#fff">${buildScoutReportHTML()}</div>`;
  box.style.display = "block";
}
async function downloadScoutPDF(){
  const btn = document.getElementById("rpBtn");
  btn.disabled = true; btn.innerHTML = `<span class="spinner"></span>載入產生器…`;
  try{
    const ok = await loadPdfLibs();
    if(!ok) throw new Error("PDF 函式庫載入失敗，請檢查網路後重試");
    const stage = document.getElementById("pdfStage");
    stage.innerHTML = buildScoutReportHTML();
    btn.innerHTML = `<span class="spinner"></span>排版轉換中…`;
    await new Promise(r=>setTimeout(r, 120)); // 等待圖片渲染
    const canvas = await html2canvas(stage, {scale:2, backgroundColor:"#ffffff", logging:false});
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({unit:"mm", format:"a4", orientation:"portrait"});
    const pageW = 210, pageH = 297;
    const imgH = canvas.height * pageW / canvas.width;
    const pxPerPage = canvas.width * pageH / pageW;   // 每頁對應的原始畫布高度
    let rendered = 0, page = 0;
    while(rendered < canvas.height){
      const sliceH = Math.min(pxPerPage, canvas.height - rendered);
      const slice = document.createElement("canvas");
      slice.width = canvas.width; slice.height = sliceH;
      slice.getContext("2d").drawImage(canvas, 0, rendered, canvas.width, sliceH, 0, 0, canvas.width, sliceH);
      if(page > 0) pdf.addPage();
      pdf.addImage(slice.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, pageW, sliceH * pageW / canvas.width);
      rendered += sliceH; page++;
    }
    const scSel = document.getElementById("rpScout");
    const oppName = scSel.value ? (state.scouts.find(s=>s.id===scSel.value)||{}).opp : "";
    pdf.save(`親子勇士球探報告${oppName?"-vs"+oppName:""}-${new Date().toISOString().slice(0,10)}.pdf`);
    stage.innerHTML = "";
    toast("PDF 已下載");
  }catch(e){
    console.error(e);
    toast("PDF 產生失敗：" + (e.message||"請稍後再試"));
  }
  btn.disabled = false; btn.textContent = "📄 產生並下載 PDF";
}

/* ───────── 榮譽殿堂 ───────── */
function showImpFormat(){
  document.getElementById("impFormat").textContent = IMP_FORMATS[document.getElementById("impType").value];
}
