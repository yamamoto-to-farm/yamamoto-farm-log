// admin/diary/card-pesticide.js

export function renderPesticideCard() {
  return `
    <div class="card" id="card-pesticide">
      <h2>防除（Pesticide）</h2>

      <div class="form-field">
        <label>薬剤名</label>
        <input id="materialName" class="form-input">
      </div>

      <div class="form-field">
        <label>希釈倍率</label>
        <input id="dilution" class="form-input" placeholder="例：1000倍">
      </div>

      <div class="form-field">
        <label>全体使用量</label>
        <input id="totalAmount" class="form-input" inputmode="numeric">
      </div>
    </div>
  `;
}