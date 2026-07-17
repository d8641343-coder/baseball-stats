# 親子勇士 WARRIORS 攻守數據中心

棒球隊伍攻守表現統計工具。原本是單一 HTML 檔(`index.html`,約 20 萬字元),已拆分為 CSS + 多個 JS 模組。**目前仍是傳統 `<script src>` 載入方式(非 ES module)**,所有變數/函式都在同一個全域作用域,`index.html` 內的 `onclick="xxx()"` 直接呼叫全域函式。

## 檔案結構與職責

```
index.html          骨架:scoreboard、nav、各 section、modal,inline onclick 呼叫全域函式
css/style.css        全部樣式
js/data.js           核心資料狀態、CRUD、共用 helper、照片處理、備份匯出入、戰報文字
js/auth.js           登入/權限(admin/editor/viewer)、密碼雜湊、session、儲存偵測
js/batting.js        打擊統計聚合與計算(AVG/OBP/SLG/OPS)
js/pitching.js       投手統計聚合與計算(ERA/WHIP/K9/BB9/GOAO)
js/fielding.js        目前空殼,無獨立守備統計(GO/AO 併入 pitching)
js/scout.js           AI 情蒐、AI 設定/配額閘門(aiGate)、球探報告 PDF、匯入格式、對外連線/代理抓取
js/ui.js              表格渲染、DOM 操作、事件綁定、Chart.js 繪圖、進場初始化 IIFE
firestore.rules       Firestore 安全規則備份(實際生效版本在 Firebase Console)
```

**載入順序不可調整**(`index.html` 底部):
```html
<script src="js/data.js"></script>
<script src="js/auth.js"></script>
<script src="js/batting.js"></script>
<script src="js/pitching.js"></script>
<script src="js/fielding.js"></script>
<script src="js/scout.js"></script>
<script src="js/ui.js"></script>
```
原因:`ui.js` 最後有一段進場初始化 `(async () => {...})()`,會立即呼叫 `auth.js` 的 `checkStorage()`/`loadAuth()`/`trySession()`;其餘檔案的函式雖然彼此呼叫(如 ui.js 呼叫 batting.js/pitching.js 的聚合函式),但都在函式內部、執行時才用到,所以只有 `ui.js` 必須排最後。

## 主要資料結構

全域根物件 `state`(`js/data.js`,存於 `window.storage`):

```js
{
  teamName: string,
  eraBases: { U12, U15, U18, OB, "其他": number },  // ERA 換算局數基準（鍵同 LEVELS）
  players: Player[],
  games: Game[],
  honors: Honor[],
  scouts: Scout[]
}
```

**Player**
```js
{ id, name, num, pos, level: "U12"|"U15"|"U18"|"OB"|"其他",
  throws: ""|"右"|"左", bats: ""|"右"|"左"|"兩", photo }
// 階級清單為單一來源常數 LEVELS（js/data.js 最上方），ERA 局制預設值為 ERA_BASE_DEFAULT；新增/調整階級只改這兩處。
```

**Game**
```js
{ id, created, date, opp, level, squad, tour, coach, us, them,
  mvp, svp,                       // 球員 id
  squad: ""|"藍"|"白"|"紅",        // 分隊（同階級下的隊伍）
  batting: BattingLine[], pitching: PitchingLine[],
  comments: {t, text}[], media: {url, cap}[] }
```

**BattingLine**(`BKEYS` 定義欄位清單,`js/batting.js`)
```js
{ pid, vsP: ""|"R"|"L"|"M", AB, H, d2, d3, HR, BB, SF, R, RBI, SO, SB }
```

**PitchingLine**
```js
{ pid, outs, vsB: ""|"R"|"L"|"M", H, R, ER, BB, SO, GO, AO }
// outs 用 parseIP()/ipStr() 跟 "2.1" 這類局數字串互轉
```

**Honor**(AI 評選 MVP/SVP)
```js
{ id, type: "monthly"|"yearly", period, level, created,
  pitcher: {pid, name, reason}|null, fielder: {pid, name, reason}|null, summary }
```

**Scout**(對戰情蒐報告)
```js
{ id, opp, source: "ai"|"url"|"manual", created, summary,
  keyPlayers: {name, role, hand, note}[], strategy, sources }
```

**Firestore 其他集合**(不在 state 內):
- `teams/warriors/members/{uid}` — 成員:`{ email, name, role, approved, editLevels?, created }`
- `teams/warriors/config/ai` — AI 設定:`{ apiKey, model, editorDaily, updated }`(管理者在「權限管理→AI 功能設定」維護;規則限 admin 寫、admin/editor 讀)
- `teams/warriors/aiUsage/{uid}_{feature}_{yyyymmdd}` — 編輯者每日 AI 用量計數(transaction 累加,`aiGate()` 檢查)
- `teams/warriors/logs/{id}` — 系統紀錄:`{ id, type: "login"|"ai"|"edit", t, uid, email, msg }`(`logEvent()` 寫入;規則:成員可新增、僅 admin 可讀)

完整安全規則在 repo 根目錄 `firestore.rules`(**僅供比對參考,實際生效要貼到 Firebase Console → Firestore → 規則**;改規則時兩邊要同步)。

聚合統計物件(`battingAgg`/`finishBat`、`pitchingAgg`/`finishPit` 的回傳值,**不儲存,每次即時計算**):
```js
// 打擊: { gp, AB, H, d2, d3, HR, BB, SF, R, RBI, SO, SB, TB, PA, AVG, OBP, SLG, OPS }
// 投球: { gp, outs, H, R, ER, BB, SO, wER, GO, AO, ERA, WHIP, K9, BB9, GOAO }
```

## 發布流程(GitHub Pages)

正式站由 **GitHub Pages** 代管(repo `d8641343-coder/baseball-stats`,master 分支根目錄,`.nojekyll`),網址 https://d8641343-coder.github.io/baseball-stats。Pages 直接服務**拆分後的** `index.html` + `css/` + `js/`(`index.html` 底部用 `<script src="js/*.js">` 載入),**不經過任何 build,不用合併單檔**。

發布步驟:

1. 更新 `js/data.js` 最上方的 `APP_VERSION`(格式 `vX.Y.Z · YYYY-MM-DD`)
2. `git commit` 改動的檔案 → `git push origin master`
3. Pages 自動重新部署(約 1～2 分鐘)。開啟網址核對登入畫面版號是否為新版;版號沒變先 Ctrl+F5 強制重新整理再判斷

**開發鐵則:所有程式修改一律在拆分後的檔案(css/、js/、index.html 骨架)上進行。** 拆分後每次只需讀寫相關模組,AI 協作省 token。

### `build.js` / `dist/` 現況(舊 Artifact 流程遺留,發布已不需要)

`build.js` 會把 css + js 合併成單一 `dist/index.html`,是當初用 Claude Artifact 代管時為了「Artifact 只吃單檔」而寫的。**改用 GitHub Pages 後這一步已不在發布路徑上**——Pages 直接吃拆分檔。`dist/` 仍列在 `.gitignore`,不進版控。build script 目前仍可用(驗證 css link 存在、恰好內嵌 8 個 js、js 內容不含 `</script>` 字串),若哪天要重新產單檔備份可跑,但平常發布無須執行。

## 版號規則

- 版號常數 `APP_VERSION` 定義於 `js/data.js` 最上方(格式:`v主.次.修 · YYYY-MM-DD`),**每次發布前必須更新**。
- 顯示位置:頁首副標(`#appVer`)與登入畫面(`#appVerAuth`),由 `js/ui.js` 的進場初始化 IIFE 填入——登入前就看得到,用來核對發布出去的是不是最新版。

## 命名慣例

- **CRUD**:`addX()`/`delX(id)`/`editX(id)` — 如 `addPlayer`/`delPlayer`/`editPlayer`、`addGame`/`delGame`、`addBatLine`/`addPitLine`/`delLine`
- **統計聚合三段式**(batting.js / pitching.js 共用模式):
  - `xxxAgg(games)` — 依球員聚合原始累加數據,回傳 `Map<pid, rawStats>`
  - `finishXxx(m)` — 把單一球員的原始累加數據算出衍生欄位(AVG/ERA 等)
  - `sumXxx(map)` — 把全隊所有球員加總成球隊合計列
  - `xxxSplitAgg(games, pid)` — 單一球員的左右投/打拆分統計
- **渲染函式**:`renderX()` 對應同名 section/區塊,無回傳值,直接操作 DOM(`innerHTML`),例如 `renderOverview`/`renderRoster`/`renderGames`/`renderBatting`/`renderPitching`/`renderHonors`/`renderScouts`/`renderHeader`。`renderAll()` 統一呼叫全部 render 函式(整頁重繪,見下方技術債)。
- **權限守衛**:`canEdit(level)`/`guardEdit(level)` 帶階級參數(可省略);編輯者(editor)可被管理者限定只能編輯特定階級(Firestore member 文件的 `editLevels` 欄位:`"ALL"` 或 `LEVELS` 之一(U12/U15/U18/OB/其他),admin 一律 ALL,存於 `auth.js` 的 `myLevels`)。寫入型函式須先取得該筆資料的階級(`g.level` / `p.level`)再呼叫 `guardEdit(該階級)`;無 level 參數時僅判斷是否具編輯身分(供 `save()` 等通用場景)。`guardAdmin()` 僅管理者。
- **格式化 helper**:`f3()`/`f2()` 格式化小數,`ipStr()`/`parseIP()` 局數字串互轉,`esc()` HTML escape,`normDate()` 日期正規化。
- **HTML 片段產生**:回傳字串而非直接操作 DOM 的函式,如 `avatarHTML()`/`nameLink()`/`lvlBadge()`/`handBadge()`/`scoutCardHTML()`。

## 未來規劃(Roadmap)

**方向:先做功能面與基本資料面、網站內容豐富後,再遷移到 Firebase Authentication + Firestore。**(2026/07 決定)

- **現階段**:維持 Claude Artifact 發布 + App 內建三層共用密碼(admin/editor/viewer),零額外費用,舊資料(`warriors-data`)沿用。開發重點放在功能與資料完整度。
- **未來遷移到 Firebase 的理由**:改用「Google 帳號登入」,家長/教練不用記共用密碼、可個人識別(記錄誰改了資料)、可個別停權,對使用者較友善。Spark 免費方案(不綁信用卡)的額度對球隊規模綽綽有餘。
- **遷移時要處理的重點**(屆時建議用 Plan Mode 先規劃):
  1. Google 登入只解決「身分驗證」,還需要新寫「授權」機制:管理者核准新成員、指定 editor/viewer 角色,搭配 Firestore Security Rules。
  2. `auth.js` 整個重寫;`data.js` 儲存層從 `window.storage` 換成 Firestore SDK。
  3. **資料結構必須拆開**:目前是一大包 JSON 整存整取,Firestore 單一文件上限 1MB,球員照片(base64)會爆——需拆成 players/games/honors/scouts 等集合分開存,這是比換 API 更深的重構。
  4. 發布位置改用 Firebase Hosting 或 GitHub Pages(皆免費);舊資料用現有「JSON 備份匯出」功能帶出,再寫一次性匯入程式灌進 Firestore。

## 已知技術債

1. **`addBatLine`/`addPitLine`/`addGame`/`addPlayer` 混雜 DOM 讀取與資料寫入**:直接在函式內 `document.getElementById(...).value` 讀表單,同時寫入 `state`。理想上應拆成「讀表單值」(ui)+「寫入 state」(data)兩段,目前為了不改變行為而保留原樣,整組函式放在 `js/data.js`。
2. **`renderAll()` 整頁重繪**:幾乎每個修改函式最後都呼叫 `save()` + `renderAll()`,`renderAll()` 會重跑全部 8 個 render 函式,沒有局部更新機制,資料量變大後可能有效能疑慮。
3. **`guardEdit()`/`canEdit()` 散落各處**:每個寫入型函式開頭手動呼叫,沒有統一的攔截層(如裝飾器/中介層),容易漏加。
4. **非 module 全域作用域**:所有檔案共享同一全域 scope,純粹靠 `<script src>` 載入順序維持正確性,沒有 import/export,新增檔案或調整順序都有風險,IDE 也無法做跨檔案的型別/引用檢查。
5. **inline `onclick="xxx()"` 遍布 HTML 字串**:render 函式產生的 HTML 大量內嵌 `onclick`,表示所有可能被呼叫的函式都必須維持全域可見,無法安全地做作用域封裝或改成 ES module。
6. **`js/fielding.js` 是空殼**:目前沒有獨立守備統計(失誤、守備率等),`pos` 只是名冊欄位,GO/AO 算在投手數據裡。若未來要做真正的守備統計,需要重新設計資料結構(比賽層級可能要新增 fielding 記錄)。
7. **AI/情蒐/PDF 功能(`js/scout.js`)相依外部服務**:`callClaude()` 用管理者設定的 API Key 瀏覽器直連 `api.anthropic.com`(需 `anthropic-dangerous-direct-browser-access` 標頭啟用 CORS);情蒐備援抓取靠公開 CORS 代理列表(`PROXIES`)接力嘗試,代理失效會影響「網頁分析」與備援搜尋。**已知取捨**:API Key 存 Firestore 且編輯者可讀(呼叫必須),表示編輯者技術上可繞過每日次數限制——次數管控是防誤用不是防惡意,真要防須改走 Cloudflare Worker 等後端代理。每個 AI 功能入口先過 `aiGate(feature)`(身分→Key→編輯者每日配額),`callClaude(prompt, useWeb, feature)` 成功/失敗都寫 `logEvent("ai", ...)`。
8. ~~兩個大型 base64 圖片內嵌在 `index.html`~~(v1.2.1 已瘦身)。登入圖與隊徽是同一張 200×203 PNG(各約 5.4 萬字元 base64、40KB),alpha 全不透明。已在 v1.2.1 用 Pillow 重新編碼:縮到 192px(對應登入畫面 96px 顯示的 2× retina)、flatten 白底轉 RGB、存成 JPEG q88,各約 1.4 萬字元;`dist/index.html` 從 243KB 降到 175KB。**兩張圖仍完全相同且仍各存一份(未去重)**——若要再省一份約 1.4 萬字元,可把 data URI 抽成單一 JS 常數、進場時設給兩個 `<img>.src`;但需注意 `js/scout.js` 的 PDF 產生器會讀 `.sb-logo` 的 `src`,登入畫面圖也要在進場即設好避免閃爍。重新編碼的 Python 腳本邏輯:讀 PNG→`convert("RGBA")`→白底 `paste`→`resize((192,195),LANCZOS)`→`save(JPEG,quality=88,optimize=True)`。
