// ===============================
// import（必ずファイル先頭）
// ===============================
import { getCurrentPosition, getNearestField } from "./app.js";


// ===============================
// デバッグモード（true で有効）
// ===============================
const DEBUG_MODE = true;

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

    // ▼ fields.json 読み込み（絶対パス）
    const res = await fetch("/data/fields.json");
    const fields = await res.json();

    // ▼ 自動判定欄
    const auto = document.getElementById(autoId);
    auto.readOnly = true;

    // ▼ エリアセレクト
    const areaSel = document.getElementById(areaId);
    const areas = [...new Set(fields.map(f => f.area))];

    areas.forEach(area => {
        const opt = document.createElement("option");
        opt.value = area;
        opt.textContent = area;
        areaSel.appendChild(opt);
    });

    // ▼ 圃場セレクト
    const fieldSel = document.getElementById(manualId);
    fieldSel.innerHTML = `<option value="">エリアを選んでください</option>`;

    // ▼ エリア選択時に圃場を絞る
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
            opt.value = f.id;
            opt.textContent = f.name;
            fieldSel.appendChild(opt);
        });
    });

    return fields;
}


// ===============================
// GPS → エリア → 圃場 自動連動（デバッグ対応）
// ===============================
export async function autoDetectField(autoId, areaId, manualId) {

    const auto = document.getElementById(autoId);
    const areaSel = document.getElementById(areaId);
    const fieldSel = document.getElementById(manualId);

    // ▼ ① GPS取得中の表示
    auto.value = "GPS取得中…";
    debugLog("GPS取得中…");

    try {
        // ▼ ② GPS取得（15秒に延長）
        const pos = await getCurrentPosition(15000);
        const { lat, lng, accuracy } = pos;

        debugLog(
            `GPS取得成功
lat: ${lat}
lng: ${lng}
accuracy: ±${accuracy}m`
        );

        // ▼ ③ 最寄り圃場を判定
        const nearest = await getNearestField(lat, lng);

        debugLog(
            `GPS取得成功
lat: ${lat}
lng: ${lng}
accuracy: ±${accuracy}m

最寄り圃場: ${nearest.name}
距離: ${nearest.distance.toFixed(1)}m`
        );

        // ▼ ④ UI反映（推定）
        auto.value = `${nearest.name}（推定）`;

        // ▼ ⑤ エリアを自動選択
        areaSel.value = nearest.area;
        areaSel.dispatchEvent(new Event("change"));

        // ▼ ⑥ 圃場を自動選択
        fieldSel.value = nearest.id;

    } catch (err) {
        // ▼ ⑦ GPSが本当に失敗したときだけ表示
        auto.value = "自動判定できませんでした（GPSエラー）";
        debugLog(`GPSエラー: ${err}`);
        console.error("GPSエラー:", err);
    }
}


// ===============================
// 作業者チェックボックス
// ===============================
export async function createWorkerCheckboxes(containerId) {
    
    const res = await fetch("/data/workers.json");
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