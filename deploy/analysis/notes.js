// notes.js
// ---------------------------------------------
// すべての logs/◯◯/all.csv から plantingRef に紐づく note を抽出する
// ---------------------------------------------

const CF_BASE = "https://d3sscxnlo0qnhe.cloudfront.net";

/* ===============================
   CSV を読み込んで配列に変換
=============================== */
async function fetchCSV(path) {
  const url = `${CF_BASE}/${path}?ts=${Date.now()}`;
  const text = await fetch(url).then(r => r.text());

  const lines = text.trim().split("\n");
  const headers = lines[0].split(",");

  return lines.slice(1).map(line => {
    const cols = line.split(",");
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = cols[i] ?? "";
    });
    return obj;
  });
}

/* ===============================
   note 抽出ロジック（メイン）
=============================== */
export async function loadNotesForPlantingRef(plantingRef) {

  // ★ logs/◯◯/all.csv に修正済み
  const sources = [
    { file: "logs/planting/all.csv", tag: "【定植】" },

    // { file: "logs/cultivation/all.csv", tag: "【中耕】" },
    // { file: "logs/fertilizer/all.csv",  tag: "【施肥】" },
    // { file: "logs/pesticide/all.csv",   tag: "【防除】" },

    { file: "logs/harvest/all.csv",  tag: "【収穫】" },
    { file: "logs/weight/all.csv", tag: "【出荷】" }
  ];

  let notes = [];

  for (const src of sources) {
    try {
      const rows = await fetchCSV(src.file);

      for (const row of rows) {
        if (row.plantingRef === plantingRef && row.note && row.note.trim() !== "") {
          notes.push(`${src.tag}${row.note.trim()}`);
        }
      }

    } catch (e) {
      console.warn(`note 読み込み失敗: ${src.file}`, e);
    }
  }

  return notes;
}