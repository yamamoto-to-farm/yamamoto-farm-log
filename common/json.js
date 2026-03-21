// common/json.js
import { readText, writeText } from "./github.js";
import { cb } from "./utils.js";

// --------------------------------------
// JSON 読み込み → オブジェクト
// --------------------------------------
export async function loadJSON(path) {
  // ★ キャッシュバスター付きで常に最新を読む
  const text = await readText(cb(path));
  return JSON.parse(text);
}

// --------------------------------------
// JSON 保存（上書き）
// --------------------------------------
export async function saveJSON(path, obj) {
  const text = JSON.stringify(obj, null, 2) + "\n";
  await writeText(path, text);
}