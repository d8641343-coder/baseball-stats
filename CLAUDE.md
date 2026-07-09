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
js/scout.js           AI 情蒐、球探報告 PDF、匯入格式、對外連線/代理抓取
js/ui.js              表格渲染、DOM 操作、事件綁定、Chart.js 繪圖、進場初始化 IIFE
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
  eraBases: { U12: number, U15: number, "其他": number },  // ERA 換算局數基準
  players: Player[],
  games: Game[],
  honors: Honor[],
  scouts: Scout[]
}
```

**Player**
```js
{ id, name, num, pos, level: "U12"|"U15"|"其他",
  throws: ""|"右"|"左", bats: ""|"右"|"左"|"兩", photo }
```

**Game**
```js
{ id, created, date, opp, level, tour, coach, us, them,
  mvp, svp,                       // 球員 id
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

**auth**(獨立存於 storage,非 state 內)
```js
{ adminHash, editHash, viewHash, updated }
```

聚合統計物件(`battingAgg`/`finishBat`、`pitchingAgg`/`finishPit` 的回傳值,**不儲存,每次即時計算**):
```js
// 打擊: { gp, AB, H, d2, d3, HR, BB, SF, R, RBI, SO, SB, TB, PA, AVG, OBP, SLG, OPS }
// 投球: { gp, outs, H, R, ER, BB, SO, wER, GO, AO, ERA, WHIP, K9, BB9, GOAO }
```

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
- **權限守衛**:`canEdit()` 回傳 boolean,`guardEdit()`/`guardAdmin()` 在無權限時 toast 提示並回傳 false,寫入型函式開頭都會呼叫。
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
7. **AI/情蒐/PDF 功能(`js/scout.js`)相依外部服務**:`callClaude()` 呼叫 Claude API,情蒐抓取靠公開 CORS 代理列表(`PROXIES`)接力嘗試,代理失效會直接影響情蒐功能,沒有重試/降級以外的容錯機制。
8. **兩個大型 base64 圖片仍內嵌在 `index.html`**(登入畫面圖 + 隊徽,各約 5.4 萬字元的 base64 字串),未抽成外部圖檔,`index.html` 骨架本身仍偏肥大。
