// ===============================
// import（必ずファイル先頭）
// ===============================
import { getCurrentPosition, getNearestField } from "./app.js";


// ===============================
// デバッグモード（true で有効）
// ===============================
const DEBUG_MODE = false;

// ===============================
// デバッグ表示用UI（自動生成）
// ===============================
function debugLog(msg) {
    if (!DEBUG_MODE) return;

    let box = document.getElementById("debug");
    if (!box) {
        box = document.createElement("div");
        box.id = "debug";
        box.style.position = "fixed";
        box.style.bottom = "0";
        box.style.left = "0";
        box.style.right = "0";
        box.style.background = "rgba(0,0,0,0.75)";
        box.style.color = "#fff";
        box.style.fontSize = "12px";
        box.style.padding = "6px 10px";
        box.style.zIndex = "9999";
        box.style.whiteSpace = "pre-line";
        document.body.appendChild(box);
    }

    box.textContent = msg;
}


// ===============================
// 圃場セレクタ（エリア → 圃場名）
// ===============================
export async function createFieldSelector(autoId, areaId, manualId) {

    // ▼ fields.json 読み込み
    const res = await fetch("/yamamoto-farm-log/data/fields.json");
    const fields = await res.json();

    // 自動判定欄（読み取り専用）
    const auto = document.getElementById(autoId);
    auto.readOnly = true;

    // ▼ エリア一覧を抽出
    const areaSel = document.getElementById(areaId);
    const areas = [...new Set(fields.map(f => f.area))];

    areas.forEach(area => {
        const opt = document.createElement("option");
        opt.value = area;          // ← area 名
        opt.textContent = area;
        areaSel.appendChild(opt);
    });

    // ▼ 圃場セレクタ（手動）
    const fieldSel = document.getElementById(manualId);
    fieldSel.innerHTML = `<option value="">エリアを選んでください</option>`;

    // ▼ エリア選択時に圃場を絞り込み
    areaSel.addEventListener("change", () => {
        const selectedArea = areaSel.value;

        fieldSel.innerHTML = "";

        if (!selectedArea) {
            fieldSel.innerHTML = `<option value="">エリアを選んでください</option>`;
            return;
        }

        const filtered = fields.filter(f => f.area === selectedArea);

        filtered.forEach(f => {
            const opt = document.createElement("option");
            opt.value = f.name;     // ★ ここを id → name に変更
            opt.textContent = f.name;
            fieldSel.appendChild(opt);
        });
    });

    return fields;
}

// ===============================
// 品種セレクタ
// ===============================
async function setupVarietySelector() {
  const res = await fetch("../data/varieties.json");
  VARIETY_LIST = await res.json();

  const typeSel = document.getElementById("varietyType");
  const nameSel = document.getElementById("variety");

  const types = [...new Set(VARIETY_LIST.map(v => v.type))];
  types.forEach(t => {
    const opt = document.createElement("option");
    opt.value = t;
    opt.textContent = t;
    typeSel.appendChild(opt);
  });

  typeSel.addEventListener("change", () => {
    const selectedType = typeSel.value;
    nameSel.innerHTML = "<option value=''>品名を選択</option>";

    if (!selectedType) return;

    const filtered = VARIETY_LIST.filter(v => v.type === selectedType);

    filtered.forEach(v => {
      const opt = document.createElement("option");
      opt.value = v.name;      // ← name ベース
      opt.textContent = v.name;
      nameSel.appendChild(opt);
    });
  });
}

// ===============================
// GPS → エリア → 圃場 自動連動（nameベース版）
// ===============================
export async function autoDetectField(autoId, areaId, manualId) {

    const auto = document.getElementById(autoId);
    const areaSel = document.getElementById(areaId);
    const fieldSel = document.getElementById(manualId);

    auto.value = "GPS取得中…";
    debugLog("GPS取得中…");

    try {
        const pos = await getCurrentPosition(15000);
        const { lat, lng, accuracy } = pos;

        debugLog(
            `GPS取得成功
lat: ${lat}
lng: ${lng}
accuracy: ±${accuracy}m`
        );

        const nearest = await getNearestField(lat, lng);

        const distText =
            nearest.distance != null
                ? `\n距離: ${nearest.distance.toFixed(1)}m`
                : "";

        debugLog(
            `GPS取得成功
lat: ${lat}
lng: ${lng}
accuracy: ±${accuracy}m

最寄り圃場: ${nearest.name}${distText}`
        );

        // ▼ 自動判定欄に name を表示
        auto.value = `${nearest.name}（推定）`;

        // ▼ エリアをセット
        areaSel.value = nearest.area;
        areaSel.dispatchEvent(new Event("change"));

        // ▼ 圃場セレクタも name をセット（id → name に変更）
        fieldSel.value = nearest.name;

    } catch (err) {
        auto.value = "自動判定できませんでした（GPSエラー）";
        debugLog(`GPSエラー: ${err}`);
        console.error("GPSエラー:", err);
    }
}

// ===============================
// 作業者チェックボックス
// ===============================
export async function createWorkerCheckboxes(containerId) {
    
    const res = await fetch("/yamamoto-farm-log/data/workers.json");
    const workers = await res.json();

    const box = document.getElementById(containerId);

    workers.forEach(w => {
        const div = document.createElement("div");
        div.innerHTML = `
            <label>
                <input type="checkbox" name="workers" value="${w.name}">
                ${w.name}
            </label>
        `;
        box.appendChild(div);
    });
}


// ===============================
// 作業者の取得（固定＋単発バイト）
// ===============================
export function getSelectedWorkers(boxId, tempId) {
    const fixed = [...document.querySelectorAll(`#${boxId} input[name='workers']:checked`)]
        .map(x => x.value);

    const temp = document.getElementById(tempId).value
        .split(",")
        .map(x => x.trim())
        .filter(x => x);

    return [...fixed, ...temp].join(",");
}


// ===============================
// 日付入力コンポーネント
// ===============================
export function createDateInput(targetId, labelText = "") {
    const container = document.getElementById(targetId);

    const label = document.createElement("label");
    label.textContent = labelText;

    const input = document.createElement("input");
    input.type = "date";
    input.style.width = "100%";
    input.style.padding = "8px";
    input.style.fontSize = "16px";
    input.style.marginTop = "5px";

    container.appendChild(label);
    container.appendChild(input);

    return input;
}

// ===============================
// 圃場の最終決定ロジック（nameベース版）
// ===============================
export function getFinalField(
  autoId = "field_auto",
  manualId = "field_manual",
  confirmId = "field_confirm"
) {
    const rawAuto = document.getElementById(autoId)?.value || "";
    const manual = document.getElementById(manualId)?.value || "";
    const confirmed = document.getElementById(confirmId)?.checked;

    // ▼ auto の「（推定）」を除去して name だけにする
    const auto = rawAuto.replace(/（推定）/g, "").trim();

    // ▼ 優先順位：確認チェック → 手動 → 自動
    if (confirmed && auto) return auto;
    if (manual) return manual;
    return auto;
}

// ===============================
// PIN 認証 UI を表示し、認証後に callback を実行
// ===============================
export function showPinGate(containerId, onSuccess) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const input = document.getElementById("pin-input");
  const button = document.getElementById("pin-submit");

  if (!input || !button) {
    console.error("PIN UI が見つかりません");
    return;
  }

  // PIN 認証処理
  async function authenticate() {
    const pin = input.value.trim();
    if (!pin) return;

    try {
      const res = await fetch("/yamamoto-farm-log/data/access.csv");
      const text = await res.text();
      const lines = text.trim().split("\n");
      const headers = lines[0].split(",");

      const users = lines.slice(1).map(line => {
        const cols = line.split(",");
        const obj = {};
        headers.forEach((h, i) => obj[h] = cols[i]);
        return obj;
      });

      const user = users.find(u => u.pin === pin);

      if (!user) {
        alert("PIN が違います");
        return;
      }

      // ★ 認証成功 → グローバル変数に保存
      window.currentHuman = user.name;
      window.currentRole = user.role;

      // ★ localStorage にも保存（QR 直アクセス対応）
      localStorage.setItem("human", user.name);
      localStorage.setItem("role", user.role);

      // PIN UI を非表示
      container.style.display = "none";

      // 認証後の処理
      if (onSuccess) onSuccess();

    } catch (e) {
      alert("認証データの読み込みに失敗しました");
    }
  }

  // ボタン押下
  button.onclick = authenticate;

  // Enter キー対応
  input.addEventListener("keydown", e => {
    if (e.key === "Enter") authenticate();
  });
}

// ===============================
// ページ読み込み時に localStorage から認証情報を復元
// （index 以外のページで利用）
// ===============================
window.addEventListener("DOMContentLoaded", () => {
  const savedRole = localStorage.getItem("role");
  const savedHuman = localStorage.getItem("human");

  if (savedRole) window.currentRole = savedRole;
  if (savedHuman) window.currentHuman = savedHuman;
});