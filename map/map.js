// map.js

// ★ initMap は export するだけ。自動実行しない。
export function initMap() {

  const map = L.map("map").setView([34.75, 137.38], 13);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19
  }).addTo(map);

  // ===============================
  // ★ 畑データ保持用（ハイライト用）
  // ===============================
  const fieldLayers = {};   // { fieldName: { polygon, marker, field } }
  let lastSelected = "";    // 前回選択した畑名
  let nextSelected = "";    // click 時点の値（再タップ判定用）

  // ===============================
  // ★ マーカーアイコン（大きく・見やすく）
  // ===============================
  function createFieldIcon(field, isSelected = false) {
    return L.divIcon({
      html: `
        <div style="text-align:center; transform: translateY(-16px);">
          <div style="
            font-size: 20px;
            font-weight: 900;
            color: ${isSelected ? "red" : "black"};
            white-space: nowrap;
            text-shadow:
              0 0 4px white,
              0 0 4px white,
              0 0 6px white;
          ">
            ${field.name}
          </div>
          <img src="/yamamoto-farm-log/img/cabbage.png"
               style="
                 width:60px;
                 height:60px;
                 ${isSelected ? "filter: drop-shadow(0 0 8px red);" : ""}
               ">
        </div>
      `,
      className: "",
      iconSize: [60, 60],
      iconAnchor: [30, 60]
    });
  }

  // ===============================
  // ★ fields.json 読み込み
  // ===============================
  fetch("/yamamoto-farm-log/data/fields.json")
    .then(res => res.json())
    .then(fields => {

      // ▼ 選択リストに追加
      const select = document.getElementById("fieldSelect");
      fields.forEach(f => {
        const opt = document.createElement("option");
        opt.value = f.name;
        opt.textContent = f.name;
        select.appendChild(opt);
      });

      // ▼ 地図に描画
      fields.forEach(field => {

        const safeId = field.name.replace(/[^a-zA-Z0-9_-]/g, "_");

        // ★ ポリゴン
        let polygon = null;
        if (field.coords) {
          polygon = L.polygon(field.coords, {
            color: field.color || "#3388ff",
            weight: 2
          }).addTo(map);
        }

        // ★ マーカー
        const marker = L.marker([field.lat, field.lng], {
          icon: createFieldIcon(field)
        }).addTo(map);

        // ★ ポップアップ
        const popupHtml = `
          <div style="text-align:center;">
            <strong>${field.name}</strong><br><br>

            <button id="nav-${safeId}"
              style="margin:4px; padding:4px 10px;">
              Google Maps（ナビ）
            </button>

            <button id="analysis-${safeId}"
              style="margin:4px; padding:4px 10px;">
              圃場分析ページへ
            </button>
          </div>
        `;

        marker.bindPopup(popupHtml);

        marker.on("popupopen", () => {
          const navBtn = document.getElementById(`nav-${safeId}`);
          if (navBtn) {
            navBtn.addEventListener("click", () => {
              const url = `https://www.google.com/maps/dir/?api=1&destination=${field.lat},${field.lng}`;
              window.open(url, "_blank");
            });
          }

          const analysisBtn = document.getElementById(`analysis-${safeId}`);
          if (analysisBtn) {
            analysisBtn.addEventListener("click", () => {
              const fieldName = encodeURIComponent(field.name);
              location.href = `/yamamoto-farm-log/analysis/index.html?field=${fieldName}`;
            });
          }
        });

        // ★ レイヤーを保存（ハイライト用）
        fieldLayers[field.name] = { polygon, marker, field };
      });

      // ===============================
      // ★ 選択リスト：再タップ判定（click）
      // ===============================
      select.addEventListener("click", () => {
        nextSelected = select.value;
      });

      // ===============================
      // ★ 畑選択 → ハイライト処理（change）
      // ===============================
      select.addEventListener("change", () => {
        let selected = select.value;

        // ★ 同じ畑をもう一度選んだ → 解除
        if (selected === lastSelected && selected === nextSelected) {
          selected = "";
          select.value = "";
        }

        lastSelected = selected;

        Object.keys(fieldLayers).forEach(name => {
          const { polygon, marker, field } = fieldLayers[name];
          const isSelected = (name === selected);

          // ▼ ポリゴンのスタイル変更
          if (polygon) {
            polygon.setStyle({
              color: isSelected ? "red" : (field.color || "#3388ff"),
              weight: isSelected ? 4 : 2
            });
          }

          // ▼ マーカーのアイコン変更
          marker.setIcon(createFieldIcon(field, isSelected));

          // ▼ 選択された畑へズーム
          if (isSelected) {
            if (polygon) {
              map.fitBounds(polygon.getBounds(), { padding: [30, 30] });
            } else {
              map.setView([field.lat, field.lng], 17);
            }
          }
        });

        // ★ 解除時は全体表示に戻す
        if (selected === "") {
          map.setView([34.75, 137.38], 13);
        }
      });

    });
}