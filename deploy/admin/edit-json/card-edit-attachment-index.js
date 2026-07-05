import { saveJSON } from "/common/json.js?v=1";
import { showSaveModal, completeSaveModal } from "/common/save-modal.js?v=1";

function normalizeList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map(v => String(v || "").trim())
    .filter(Boolean);
}

function parseTextareaLines(text) {
  return Array.from(new Set(
    String(text || "")
      .split(/\r?\n/)
      .map(v => v.trim())
      .filter(Boolean)
  ));
}

export function renderEditCard({ json, container }) {
  const title = document.getElementById("page-title");
  if (title) title.textContent = "アタッチメント設定（attachment-index.json）";

  const current = {
    intertill: normalizeList(json?.intertill),
    bedmaking: normalizeList(json?.bedmaking),
    tillage: normalizeList(json?.tillage)
  };

  container.insertAdjacentHTML("beforeend", `
    <div class="card">
      <h2>ログ別アタッチメント候補</h2>
      <p style="margin:0 0 14px; color:#555;">1行に1件入力します。空行は無視されます。</p>

      <div class="form-row">
        <label class="form-label" for="attachment-intertill">中耕ログ（intertill）</label>
        <textarea id="attachment-intertill" class="form-input" rows="5">${current.intertill.join("\n")}</textarea>
      </div>

      <div class="form-row">
        <label class="form-label" for="attachment-bedmaking">畝立てログ（bedmaking）</label>
        <textarea id="attachment-bedmaking" class="form-input" rows="4">${current.bedmaking.join("\n")}</textarea>
      </div>

      <div class="form-row">
        <label class="form-label" for="attachment-tillage">土づくり・耕起ログ（tillage）</label>
        <textarea id="attachment-tillage" class="form-input" rows="4">${current.tillage.join("\n")}</textarea>
      </div>

      <button id="save-attachment-index-btn" class="primary-btn" style="margin-top:20px;">保存する</button>
    </div>
  `);

  const saveBtn = document.getElementById("save-attachment-index-btn");
  saveBtn.onclick = async () => {
    const intertill = parseTextareaLines(document.getElementById("attachment-intertill")?.value || "");
    const bedmaking = parseTextareaLines(document.getElementById("attachment-bedmaking")?.value || "");
    const tillage = parseTextareaLines(document.getElementById("attachment-tillage")?.value || "");

    if (!intertill.length || !bedmaking.length || !tillage.length) {
      alert("各ログの候補を1件以上入力してください");
      return;
    }

    const next = {
      intertill,
      bedmaking,
      tillage,
      updatedAt: new Date().toISOString()
    };

    showSaveModal("保存しています…");
    await saveJSON("data/attachment-index.json", next);
    completeSaveModal("アタッチメント設定を保存しました");
  };
}
