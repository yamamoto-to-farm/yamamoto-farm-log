// admin/diary/card-common.js
import { loadJSON } from "/common/json.js?v=2026031418";

export function renderCommonCard() {
  return `
    <div class="card" id="card-common">
      <h2>共通情報</h2>

      <div class="form-field">
        <label>作業日</label>
        <input type="date" id="workDate" class="form-input">
      </div>

      <h3>作業者</h3>
      <div id="workers_box">読み込み中…</div>

      <h3>圃場（複数選択）</h3>
      <div id="fields_box">読み込み中…</div>

      <h3>天候</h3>
      <select id="weather" class="form-input">
        <option value="">選択</option>
        <option value="晴れ">晴れ</option>
        <option value="曇り">曇り</option>
        <option value="雨">雨</option>
        <option value="風強い">風強い</option>
      </select>

      <h3>メモ</h3>
      <textarea id="notes" class="form-textarea" rows="3"></textarea>
    </div>
  `;
}

// ★★★ これが無いとエラーになる ★★★
export async function initCommonCard() {
  await loadWorkers();
  await loadFields();
}

async function loadWorkers() {
  const box = document.getElementById("workers_box");
  const workers = await loadJSON("/data/workers.json");

  box.innerHTML = workers.map(w => `
    <label class="check-line">
      <input type="checkbox" value="${w}">
      ${w}
    </label>
  `).join("");
}

async function loadFields() {
  const box = document.getElementById("fields_box");
  const fields = await loadJSON("/data/fields.json");

  box.innerHTML = fields.map(f => `
    <label class="check-line">
      <input type="checkbox" value="${f.field}">
      ${f.field}
    </label>
  `).join("");
}