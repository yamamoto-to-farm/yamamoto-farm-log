import { saveRawFile } from "../common/save/index.js";

// GitHub リポジトリ情報（あなたの環境に合わせて変更）
const OWNER = "yamamoto-to-farm";
const REPO = "yamamoto-farm-log";

// ============================
// /data の JSON 一覧を取得
// ============================
async function loadFileList() {
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/data`;
  const res = await fetch(url);
  const list = await res.json();

  const select = document.getElementById("fileSelect");
  select.innerHTML = "";

  list
    .filter(f => f.name.endsWith(".json"))
    .forEach(f => {
      const opt = document.createElement("option");
      opt.value = f.path;
      opt.textContent = f.name;
      select.appendChild(opt);
    });

  // 最初のファイルを読み込む
  if (select.value) loadJson(select.value);
}

// ============================
// JSON を読み込む
// ============================
async function loadJson(path) {
  const url = `https://raw.githubusercontent.com/${OWNER}/${REPO}/main/${path}`;
  const res = await fetch(url);
  const json = await res.json();

  document.getElementById("currentJson").value = JSON.stringify(json, null, 2);
}

// ============================
// CSV → JSON 変換
// ============================
function csvToJson(csv) {
  const [header, ...rows] = csv.trim().split("\n");
  const keys = header.split(",");

  return rows.map(row => {
    const values = row.split(",");
    return Object.fromEntries(keys.map((k, i) => [k, values[i]]));
  });
}

// ============================
// 保存処理
// ============================
async function saveData() {
  const path = document.getElementById("fileSelect").value;
  const jsonText = document.getElementById("convertedJson").value;

  try {
    const json = JSON.parse(jsonText);
    await saveRawFile(path, JSON.stringify(json, null, 2));
    alert("保存しました");
  } catch (e) {
    alert("JSON が不正です");
  }
}

// ============================
// イベント設定
// ============================
document.getElementById("fileSelect").addEventListener("change", e => {
  loadJson(e.target.value);
});

document.getElementById("convertBtn").addEventListener("click", () => {
  const csv = document.getElementById("csvInput").value;
  const json = csvToJson(csv);
  document.getElementById("convertedJson").value = JSON.stringify(json, null, 2);
});

document.getElementById("saveBtn").addEventListener("click", saveData);

// 初期化
loadFileList();