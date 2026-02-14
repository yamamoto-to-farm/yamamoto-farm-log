// ===============================
// import（必ずファイル先頭）
// ===============================
import { saveLog } from "../common/save/index.js";


// ===============================
// CSV 行パーサー（改行入りフィールドにも対応）
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
// CSV 列パーサー（カンマ入りフィールド対応）
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
  console.log("=== loadUnweighedHarvests START ===");

  // harvest/all.csv
  const res = await fetch("../logs/harvest/all.csv?nocache=" + Date.now());
  const text = await res.text();
  console.log("=== HARVEST RAW TEXT ===\n", text);

  const lines = splitCSVLines(text);
  console.log("=== HARVEST SPLIT LINES ===", lines);

  const rows = lines.slice(1).map((line, idx) => {
    const cols = parseCSVLine(line);
    console.log(`HARVEST row ${idx}:`, cols);

    const harvestRef =
      cols[0].replace(/-/g, "") + "-" + (cols[6] || "") + "-" + idx;

    return {
      harvestDate: cols[0],
      shippingDate: cols[1],
      workers: cols[2],
      field: cols[3],
      amount: cols[4],
      issue: cols[5] || "",
      plantingRef: cols[6] || "",
      harvestRef
    };
  });

  console.log("=== HARVEST PARSED ROWS ===");
  rows.forEach(r =>
    console.log("harvestRow:", r.harvestDate, r.field, r.amount, r.harvestRef)
  );

  // weight/all.csv
  let weighedRefs = new Set();
  try {
    const wres = await fetch("../logs/weight/all.csv?nocache=" + Date.now());
    const wtext = await res.text();
    console.log("=== WEIGHT RAW TEXT ===\n", wtext);

    const wlines = splitCSVLines(wtext).slice(1);
    console.log("=== WEIGHT SPLIT LINES ===", wlines);

    wlines.forEach((line, idx) => {
      const cols = parseCSVLine(line);
      console.log(`WEIGHT row ${idx}:`, cols);
      weighedRefs.add(cols[1]);
    });
  } catch (e) {
    console.log("weight/all.csv not found (初回は正常)");
  }

  console.log("=== WEIGHT REFS ===");
  weighedRefs.forEach(ref => console.log("weighedRef:", ref));

  // 未計量判定
  const filtered = rows.filter(r => {
    const isWeighed = weighedRefs.has(r.harvestRef);
    console.log(
      `CHECK harvestRef=${r.harvestRef} → weighed=${isWeighed}`
    );
    return !isWeighed;
  });

  console.log("=== UNWEIGHED ROWS ===", filtered);

  return filtered;
}


// ===============================
// UI に未計量の収穫ログを表示
// ===============================
async function renderTable() {
  console.log("=== renderTable START ===");

  const rows = await loadUnweighedHarvests();
  console.log("renderTable rows:", rows);

  const area = document.getElementById("resultArea");

  if (rows.length === 0) {
    area.innerHTML = "<p>未計量の収穫ログはありません。</p>";
    return;
  }

  let html = `
    <table>
      <tr>
        <th>収穫日</th>
        <th>作業者</th>
        <th>圃場</th>
        <th>収穫量</th>
        <th>Bins</th>
        <th>重量(kg)</th>
        <th>メモ</th>
      </tr>
  `;

  rows.forEach((r, i) => {
    html += `
      <tr data-index="${i}">
        <td>${r.harvestDate}</td>
        <td>${r.workers}</td>
        <td>${r.field}</td>
        <td>${r.amount}</td>
        <td><input type="number" class="bins"></td>
        <td><input type="number" class="weight"></td>
        <td><input type="text" class="notes"></td>
      </tr>
    `;
  });

  html += "</table>";
  area.innerHTML = html;

  window._shippingRows = rows;
}


// ===============================
// 入力値を集める
// ===============================
function collectWeightData() {
  const shippingDate = document.getElementById("shippingDate").value;
  const trs = document.querySelectorAll("#resultArea table tr[data-index]");

  const list = [];

  trs.forEach(tr => {
    const idx = tr.dataset.index;
    const base = window._shippingRows[idx];

    const bins = tr.querySelector(".bins").value;
    const weight = tr.querySelector(".weight").value;
    const notes = tr.querySelector(".notes").value || "";

    if (!bins && !weight) return;

    list.push({
      shippingDate,
      harvestRef: base.harvestRef,
      bins,
      weight,
      notes
    });
  });

  return list;
}


// ===============================
// 保存処理（Workers 経由）
// ===============================
async function saveWeightInner() {
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

  for (const item of list) {
    const dateStr = item.shippingDate.replace(/-/g, "");

    const csvLine = [
      item.shippingDate,
      item.harvestRef,
      item.bins,
      item.weight,
      item.notes.replace(/[\r\n,]/g, " ")
    ].join(",");

    await saveLog("weight", dateStr, item, csvLine);
  }

  alert("GitHub に保存しました");
}

window.loadShipping = renderTable;
window.saveWeight = saveWeightInner;