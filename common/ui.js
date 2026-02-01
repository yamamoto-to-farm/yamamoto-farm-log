// ===============================
// import（必ずファイル先頭）
// ===============================
import { getCurrentPosition, getNearestField } from "./app.js";


// ===============================
// 圃場セレクタ（エリア → 圃場名）
// ===============================
export async function createFieldSelector(autoId, areaId, manualId) {

    // ▼ fields.json 読み込み
    const res = await fetch("../data/fields.json");
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
            opt.value = f.id;          // 保存用ID
            opt.textContent = f.name;  // 表示名
            fieldSel.appendChild(opt);
        });
    });

    return fields;
}


// ===============================
// GPS → エリア → 圃場 自動連動
// ===============================
export async function autoDetectField(autoId, areaId, manualId) {

    const auto = document.getElementById(autoId);
    const areaSel = document.getElementById(areaId);
    const fieldSel = document.getElementById(manualId);

    try {
        // ① GPS取得
        const pos = await getCurrentPosition();
        const { lat, lng } = pos;

        // ② 最寄り圃場を判定
        const nearest = await getNearestField(lat, lng);

        // ③ 自動判定欄に表示
        auto.value = nearest.name;

        // ④ エリアを自動選択
        areaSel.value = nearest.area;
        areaSel.dispatchEvent(new Event("change")); // 圃場一覧を更新

        // ⑤ 圃場を自動選択
        fieldSel.value = nearest.id;

    } catch (err) {
        auto.value = "自動判定できませんでした";
        console.error(err);
    }
}


// ===============================
// 作業者チェックボックス
// ===============================
export async function createWorkerCheckboxes(containerId) {
    
    const res = await fetch("../data/workers.json");
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