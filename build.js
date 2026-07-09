#!/usr/bin/env node
/*
 * 合併回單檔 build script — 供 Claude Artifact 發布使用
 *
 * 用法:node build.js
 * 產出:dist/index.html(css/style.css 與 js/*.js 全部內嵌回單一 HTML)
 *
 * 發布流程:
 *   1. 更新 js/data.js 最上方的 APP_VERSION
 *   2. node build.js
 *   3. 把 dist/index.html 的完整內容貼回 Claude Artifact 發布
 */
const fs = require("fs");
const path = require("path");

const root = __dirname;
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

const src = read("index.html");

// 1. 內嵌 CSS
const cssTag = '<link rel="stylesheet" href="css/style.css">';
if (!src.includes(cssTag)) {
  console.error("錯誤:index.html 找不到 css link 標籤,無法內嵌 CSS");
  process.exit(1);
}
let out = src.replace(cssTag, () => "<style>\n" + read("css/style.css").trimEnd() + "\n</style>");

// 2. 內嵌 js/*.js(依 index.html 內的載入順序,逐一換成 inline <script>)
let count = 0;
out = out.replace(/<script src="(js\/[\w.-]+\.js)"><\/script>/g, (m, p) => {
  const code = read(p);
  if (/<\/script/i.test(code)) {
    console.error(`錯誤:${p} 內含 "</script>" 字串,內嵌會破壞 HTML,請先改寫該處`);
    process.exit(1);
  }
  count++;
  return "<script>\n/* ═══ " + p + " ═══ */\n" + code.trimEnd() + "\n</script>";
});
if (count !== 7) {
  console.error(`錯誤:預期內嵌 7 個 js 檔,實際只處理了 ${count} 個(index.html 的 <script src> 標籤可能被改動)`);
  process.exit(1);
}

// 3. 輸出
fs.mkdirSync(path.join(root, "dist"), { recursive: true });
fs.writeFileSync(path.join(root, "dist", "index.html"), out);

const ver = (read("js/data.js").match(/APP_VERSION\s*=\s*"([^"]+)"/) || [])[1] || "(找不到版號!)";
const kb = (Buffer.byteLength(out, "utf8") / 1024).toFixed(0);
console.log(`完成:dist/index.html(${kb} KB,內嵌 ${count} 個 js 檔 + CSS)`);
console.log(`版號:${ver} — 發布前請確認已更新`);
