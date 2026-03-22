// analysis/index.js
import { loadJSON } from "/yamamoto-farm-log/common/json.js";

export async function renderFieldList() {
  const container = document.getElementById("analysis-container");
  container.innerHTML = ""; // 初期化

  // ★ fields.json 読み込み
  const fields = await loadJSON("data/fields.json");

  // ★ area（エリア）ごとにまとめる
  const groups = {};
  for (const f of fields) {
    const groupName = f.area || "その他"; // ← group → area に変更
    if (!groups[groupName]) groups[groupName] = [];
    groups[groupName].push(f);
  }

  // ★ グループごとに表示（折りたたみ対応）
  for (const [groupName, fieldList] of Object.entries(groups)) {
    const groupDiv = document.createElement("div");
    groupDiv.className = "field-group";

    // ▼ エリア名（クリックで開閉）
    const title = document.createElement("h2");
    title.textContent = `▶ ${groupName}`;
    title.className = "group-title";

    // 折りたたみ用の UL
    const ul = document.createElement("ul");
    ul.style.display = "none"; // 初期状態は閉じる

    // ▼ 圃場リスト
    fieldList.forEach(field => {
      const li = document.createElement("li");

      const a = document.createElement("a");
      a.textContent = field.name;
      a.href = `index.html?field=${encodeURIComponent(field.name)}`;

      li.appendChild(a);
      ul.appendChild(li);
    });

    // ▼ タイトルクリックで開閉
    title.addEventListener("click", () => {
      const isOpen = ul.style.display === "block";
      ul.style.display = isOpen ? "none" : "block";
      title.textContent = `${isOpen ? "▶" : "▼"} ${groupName}`;
    });

    groupDiv.appendChild(title);
    groupDiv.appendChild(ul);
    container.appendChild(groupDiv);
  }
}