// ===============================
// 圃場セレクタ
// ===============================
export async function createFieldSelector(autoId, manualId) {
    // Netlify で確実に動く絶対パス
    const res = await fetch("/common/fields.json");
    const fields = await res.json();

    // 自動判定欄
    const auto = document.getElementById(autoId);
    auto.readOnly = true;

    // 手動セレクト
    const sel = document.getElementById(manualId);
    sel.innerHTML = '<option value="">自動判定を優先</option>';

    fields.forEach(f => {
        const opt = document.createElement("option");
        opt.value = f.id;
        opt.textContent = `${f.name}（${f.area}）`;
        sel.appendChild(opt);
    });

    return fields;
}


// ===============================
// 作業者チェックボックス
// ===============================
export async function createWorkerCheckboxes(containerId) {
    // Netlify で確実に動く絶対パス
    const res = await fetch("/common/workers.json");
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
    // 固定メンバー
    const fixed = [...document.querySelectorAll(`#${boxId} input[name='workers']:checked`)]
        .map(x => x.value);

    // 単発バイト（カンマ区切り）
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

    return input; // 後で値を取得しやすいように返す
}