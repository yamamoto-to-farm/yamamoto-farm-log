// common/csv.js
import { readText, writeText } from "./github.js";
import { cb } from "./utils.js";

// --------------------------------------
// CSV 読み込み → 配列オブジェクト
// --------------------------------------
export async function loadCSV(path) {
  // ★ キャッシュバスターを付けて常に最新を読む
  const text = await readText(cb(path));

  const lines = text.trim().split("\n");
  const headers = lines[0].split(",");

  return lines.slice(1).map(line => {
    const cols = line.split(",");
    const obj = {};
    headers.forEach((h, i) => obj[h] = cols[i]);
    return obj;
  });
}

// --------------------------------------
// CSV 追記（append）
// --------------------------------------
export async function appendCSV(path, rows) {
  // ★ 最新の CSV を読んでから追記する
  const text = await readText(cb(path));
  const headers = text.trim().split("\n")[0].split(",");

  const newLines = rows.map(r =>
    headers.map(h => r[h] ?? "").join(",")
  );

  const updated = text.trim() + "\n" + newLines.join("\n") + "\n";
  await writeText(path, updated);
}