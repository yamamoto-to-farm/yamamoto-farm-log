// analysis/index.js
import { loadJSON } from "/yamamoto-farm-log/common/json.js";

export async function renderFieldList() {
  const container = document.getElementById("analysis-container");
  container.innerHTML = ""; // 初期化

  // ★ field.json 読み込み（キャッシュバスター付き）
  const fields = await loadJSON("/yamamoto-farm-log/data/fields.json");

  // ★ グループ（エリア）ごとにまとめる
  const groups = {};
  for (const f of fields) {
    if (!groups[f.group]) groups[f.group] = [];
    groups[f.group].push(f);
  }

  // ★ グループごとに表示
  for (const [groupName, fieldList] of Object.entries(groups)) {
    const groupDiv = document.createElement("div");
    groupDiv.className = "field-group";

    const title = document.createElement("h2");
    title.textContent = groupName;
    groupDiv.appendChild(title);

    const ul = document.createElement("ul");

    fieldList.forEach(field => {
      const li = document.createElement("li");

      // ★ 圃場名をリンクにする（あなたの例と完全一致）
      const a = document.createElement("a");
      a.textContent = field.name;
      a.href = `/yamamoto-farm-log/analysis/index.html?field=${encodeURIComponent(field.name)}`;

      li.appendChild(a);
      ul.appendChild(li);
    });

    groupDiv.appendChild(ul);
    container.appendChild(groupDiv);
  }
}