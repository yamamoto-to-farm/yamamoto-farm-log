window.showDebug = async function() {
  const res = await fetch("../logs/harvest/all.csv");
  const text = await res.text();

  const debugArea = document.getElementById("debugArea");
  debugArea.textContent = "=== harvest/all.csv ===\n" + text;
};

// ===============================
// GitHub Actions へログを送る共通関数
// ===============================
async function saveLog(type, dateStr, jsonData, csvLine) {
  const payload = {
    type,
    dateStr,
    csv: csvLine,
    ...jsonData
  };

  const body = {
    ref: "main",
    inputs: {
      payload: JSON.stringify(payload)
    }
  };

  const res = await fetch(
    "https://api.github.com/repos/yamamoto-to-farm/yamamoto-farm-log/actions/workflows/save.yml/dispatches",
    {
      method: "POST",
      headers: {
        "Accept": "application/vnd.github+json"
      },
      body: JSON.stringify(body)
    }
  );

  if (!res.ok) {
    const t = await res.text();
    throw new Error("GitHub Actions への送信に失敗: " + t);
  }
}

// ===============================
// 未計量の収穫ログを読み込む
// ===============================
async function loadUnweighedHarvests() {
  // harvest/all.csv を読む
  const res = await fetch("../logs/harvest/all.csv");
  const text = await res.text();

  // ★ デバッグ表示：生の CSV を画面に出す
  const debugArea = document.getElementById("debugArea");
  if (debugArea) {
    debugArea.textContent = "=== harvest/all.csv ===\n" + text;
  }

  const lines = text.trim().split("\n");
  const rows = lines.slice(1).map(line => {
    const cols = line.split(",");

    return {
      harvestDate: cols[0],
      shippingDate: cols[1],
      workers: cols[2],
      field: cols[3],
      amount: cols[4],
      issue: cols[5] || "",
      plantingRef: cols[6],
      harvestRef: cols[0].replace(/-/g, "") + "-" + cols[6]
    };
  });

  // weight/all.csv を読む（存在しない場合は空扱い）
  let weighedRefs = new Set();
  try {
    const wres = await fetch("../logs/weight/all.csv");
    const wtext = await wres.text();

    // ★ デバッグ表示：weight/all.csv も出す
    if (debugArea) {
      debugArea.textContent += "\n\n=== weight/all.csv ===\n" + wtext;
    }

    const wlines = wtext.trim().split("\n").slice(1);
    wlines.forEach(line => {
      const cols = line.split(",");
      weighedRefs.add(cols[1]);
    });
  } catch (e) {
    // 初回は weight/all.csv が無いので無視
  }

  return rows.filter(r => !weighedRefs.has(r.harvestRef));
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
// 保存処理（weight）
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
