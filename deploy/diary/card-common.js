// admin/diary/card-common.js
import {
  createWorkerCheckboxes,
  createFieldSelector,
  autoDetectField,
  getSelectedWorkers,
  getFinalField
} from "../common/ui.js";

// ▼ 共通カードの HTML
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
      <div id="fields_box">
        <label>自動判定（推定）</label>
        <input id="field_auto" class="form-input" readonly style="background:#fff3b0; font-weight:bold;">

        <label style="margin-top:10px;">
          <input type="checkbox" id="field_confirm">
          この圃場で確定する
        </label>

        <hr style="margin: 15px 0;">

        <label>エリア選択</label>
        <select id="field_area" class="form-input">
          <option value="">エリアを選択</option>
        </select>

        <label>圃場選択</label>
        <select id="field_manual" class="form-input">
          <option value="">エリアを選んでください</option>
        </select>
      </div>

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

// ▼ 共通カードの初期化（harvest と同じ）
export async function initCommonCard() {
  createWorkerCheckboxes("workers_box");
  await createFieldSelector("field_auto", "field_area", "field_manual");
  autoDetectField("field_auto", "field_area", "field_manual");

  // 今日の日付をセット
  const today = new Date().toISOString().slice(0, 10);
  document.getElementById("workDate").value = today;
}