import { saveLog } from "../common/save/index.js";

window.addEventListener("DOMContentLoaded", () => {
  showPinGate("pin-area", () => {
    document.getElementById("form-area").style.display = "block";
  });
});

import { getMachineParam } from "../common/utils.js";   // ← 追加
// human は PIN_MAP により ui.js で window.currentHuman に入る

// ===============================
// CSV 行パーサー
// ===============================
function splitCSVLines(text) {
  const lines = [];
  let current = "";
  let insideQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (c === '"') {
      insideQuotes = !insideQuotes;
      current += c;
    } else if ((c === "\n" || c === "\r") && !insideQuotes) {
      if (current.trim() !== "") lines.push(current);
      current = "";
    } else {
      current += c;
    }
  }
  if (current.trim() !== "") lines.push(current);

  return lines;
}

// ===============================
// CSV 列パーサー
// ===============================
function parseCSVLine(line) {
  const result = [];
  let current = "";
  let insideQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const c = line[i];

    if (c === '"') {
      if (insideQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (c === "," && !insideQuotes) {
      result.push(current);
      current = "";
    } else {
      current += c;
    }
  }
  result.push(current);

  return result;
}

// ===============================
// harvest/all.csv と weight/all.csv を読み込む
// ===============================
async function loadUnweighedHarvests() {
  const debug = [];
  debug.push("=== loadUnweighedHarvests START ===");

  // harvest/all.csv
  const res = await fetch("../logs/harvest/all.csv?nocache=" + Date.now());
  const text = await res.text();
  debug.push("=== HARVEST RAW TEXT ===\n" + text);

  const lines = splitCSVLines(text);
  debug.push("=== HARVEST SPLIT LINES === " + lines.length);

  const rows = lines.slice(1).map((line, idx) => {
    const cols = parseCSVLine(line);

    const harvestDate = cols[0];
    const shippingDate = cols[1];
    const workers = cols[2];
    const field = cols[3];
    const bins = parseFloat(cols[4] || "0");

    // ★ harvestID = 出荷申込日 + 圃場 + 行番号
    const harvestID =
      shippingDate.replace(/-/g, "") + "-" + field + "-" + idx;

    return {
      harvestID,
      harvestDate,
      shippingDate,
      workers,
      field,
      bins,
      issue: cols[5] || "",
      plantingRef: cols[6] || ""
    };
  });

  // weight/all.csv
  let weighedIDs = new Set();
  try {
    const wres = await fetch("../logs/weight/all.csv?nocache=" + Date.now());
    const wtext = await wres.text();
    debug.push("=== WEIGHT RAW TEXT ===\n" + wtext);

    const wlines = splitCSVLines(wtext).slice(1);
    wlines.forEach(line => {
      const cols = parseCSVLine(line);
      weighedIDs.add(cols[1]); // harvestID
    });
  } catch (e) {
    debug.push("weight/all.csv not found (初回は正常)");
  }

  // 未計量判定
  const filtered = rows.filter(r => !weighedIDs.has(r.harvestID));

  document.getElementById("debugArea").textContent = debug.join("\n");
  return filtered;
}

// ===============================
// UI に未計量の収穫ログを表示
// ===============================
async function renderTable() {
  const rows = await loadUnweighedHarvests();
  const area = document.getElementById("resultArea");

  if (rows.length === 0) {
    area.innerHTML = "<p>未計量の収穫ログはありません。</p>";
    return;
  }

  let html = `
    <table>
      <tr>
        <th>収穫日</th>
        <th>出荷申込日</th>
        <th>圃場</th>
        <th>収穫基数</th>
        <th>重量入力（複数行）</th>
        <th>メモ</th>
      </tr>
  `;

  rows.forEach((r, i) => {
    html += `
      <tr data-index="${i}">
        <td>${r.harvestDate}</td>
        <td>${r.shippingDate}</td>
        <td>${r.field}</td>
        <td>${r.bins} 基</td>
        <td><textarea class="weights" placeholder="1行に1つずつ入力"></textarea></td>
        <td><input type="text" class="notes"></td>
      </tr>
    `;
  });

  html += "</table>";
  area.innerHTML = html;

  window._shippingRows = rows;
}

// ===============================
// 入力値を集める（按分ロジック含む）
// ===============================
function collectWeightData() {
  const shippingDate = document.getElementById("shippingDate").value;
  const trs = document.querySelectorAll("#resultArea table tr[data-index]");

  const list = [];

  trs.forEach(tr => {
    const idx = tr.dataset.index;
    const base = window._shippingRows[idx];

    const weightsText = tr.querySelector(".weights").value.trim();
    const notes = tr.querySelector(".notes").value || "";

    if (!weightsText) return;

    // 改行で split → 数値化
    const weightList = weightsText
      .split(/\r?\n/)
      .map(v => parseFloat(v.trim()))
      .filter(v => !isNaN(v));

    // ★ 必要重量数（2基単位）
    const requiredCount = Math.ceil(base.bins / 2);

    if (weightList.length !== requiredCount) {
      alert(
        `圃場「${base.field}」の重量入力数が収穫基数と一致しません。\n` +
        `収穫基数: ${base.bins} 基\n` +
        `必要重量数（2基ごと）: ${requiredCount} 個\n` +
        `重量入力数: ${weightList.length} 個`
      );
      throw new Error("重量数不一致");
    }

    // ★ 按分計算（2基単位 → bins 基分に変換）
    const totalRaw = weightList.reduce((a, b) => a + b, 0);
    const totalWeight = totalRaw * (base.bins / (2 * weightList.length));

    list.push({
      shippingDate,
      harvestID: base.harvestID,
      field: base.field,
      bins: base.bins,
      totalWeight,
      notes
    });
  });

  return list;
}

// ===============================
// 保存処理
// ===============================
async function saveWeight() {
  const shippingDate = document.getElementById("shippingDate").value;
  if (!shippingDate) {
    alert("出荷日を入力してください");
    return;
  }

  const list = collectWeightData();
  if (list.length === 0) {
    alert("入力がありません");
    return;
  }

  // QR → machine
  const machine = getMachineParam();        // ← 追加
  // PIN → human
  const human = window.currentHuman || "";  // ← 追加

  for (const item of list) {
    const dateStr = item.shippingDate.replace(/-/g, "");

    const csvLine = [
      item.shippingDate,
      item.harvestID,
      item.field,
      item.bins,
      item.totalWeight,
      item.notes.replace(/[\r\n,]/g, " "),
      machine,   // ← ★ 追加
      human      // ← ★ 追加
    ].join(",");

    await saveLog("weight", dateStr, item, csvLine);
  }

  alert("GitHub に保存しました");
}

window.loadShipping = renderTable;
window.saveWeight = saveWeight;