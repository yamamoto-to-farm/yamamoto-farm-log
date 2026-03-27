// admin/diary/card-other.js

export function renderOtherCard() {
  return `
    <div class="card" id="card-other">
      <h2>その他作業</h2>

      <div class="form-field">
        <label>作業内容</label>
        <input id="otherWork" class="form-input" placeholder="例：草刈り、片付けなど">
      </div>
    </div>
  `;
}