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

    // ▼ fields.json 読み込み（正しいパス）
    const res = await fetch("/yamamoto-farm-log/data/fields.json");
    const fields = await res.json();

    const auto = document.getElementById(autoId);
    auto.readOnly = true;

    const areaSel = document.getElementById(areaId);
    const areas = [...new Set(fields.map(f => f.area))];

    areas.forEach(area => {
        const opt = document.createElement("option");
        opt.value = area;
        opt.textContent = area;
        areaSel.appendChild(opt);
    });

    const fieldSel = document.getElementById(manualId);
    fieldSel.innerHTML = `<option value="">エリアを選んでください</option>`;

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

        auto.value = `${nearest.name}（推定）`;

        areaSel.value = nearest.area;
        areaSel.dispatchEvent(new Event("change"));

        fieldSel.value = nearest.id;

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
// 圃場の最終決定ロジック（共通化）
// ===============================
export function getFinalField(autoId = "field_auto", manualId = "field_manual", confirmId = "field_confirm") {
    const auto = document.getElementById(autoId)?.value || "";
    const manual = document.getElementById(manualId)?.value || "";
    const confirmed = document.getElementById(confirmId)?.checked;

    if (confirmed) return auto;
    if (manual) return manual;
    return auto;
}