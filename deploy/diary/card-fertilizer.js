// admin/diary/card-fertilizer.js

export function renderFertilizerCard() {
  return `
    <div class="card" id="card-fertilizer">
      <h2>施肥（Fertilizer）</h2>

      <div class="form-field">
        <label>肥料名</label>
        <input id="materialName" class="form-input">
      </div>

      <div class="form-field">
        <label>全体使用量</label>
        <input id="totalAmount" class="form-input" inputmode="numeric">
      </div>

      <div class="form-field">
        <label>按分方法</label>
        <select id="allocation" class="form-input">
          <option value="area">面積按分</option>
          <option value="equal">均等按分</option>
          <option value="manual">手動</option>
        </select>
      </div>
    </div>
  `;
}