// admin/diary/card-worktype.js

export function renderWorkTypeCard() {
  return `
    <div class="card" id="card-worktype">
      <h2>作業種別</h2>
      <select id="workType" class="form-input">
        <option value="">選択してください</option>
        <option value="fertilizer">施肥</option>
        <option value="pesticide">防除</option>
        <option value="other">その他作業</option>
      </select>
    </div>
  `;
}