// map.js

// ★ showPinGate は使わない
// import { showPinGate } from "../common/ui.js";

window.addEventListener("DOMContentLoaded", () => {
  // map/index.html 側で認証チェック済みなので、
  // ここでは地図を初期化するだけでOK
  initMap();
});

function initMap() {
  const map = L.map("map").setView([34.75, 137.38], 13);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19
  }).addTo(map);

  // ★ 圃場アイコン（キャベツ画像＋圃場名ラベル）
  function createFieldIcon(field) {
    return L.divIcon({
      html: `
        <div style="text-align:center; transform: translateY(-10px);">
          <div style="
            font-size: 14px;
            font-weight: bold;
            color: black;
            white-space: nowrap;
            text-shadow: 0 0 3px white, 0 0 3px white;
          ">
            ${field.name}
          </div>
          <img src="../img/cabbage.png" style="width:40px; height:40px;">
        </div>
      `,
    className: "",
    iconSize: [40, 40],
    iconAnchor: [20, 40]
    });
  }

  fetch("../data/fields.json")
    .then(res => res.json())
    .then(fields => {
      fields.forEach(field => {

        // ★ polygon（圃場の形）がある場合は描画
        if (field.coords) {
          L.polygon(field.coords, {
            color: field.color || "#3388ff",
            weight: 2
          }).addTo(map);
        }

        // ★ メインのマーカー（キャベツ＋圃場名）
        const marker = L.marker([field.lat, field.lng], {
          icon: createFieldIcon(field)
        }).addTo(map);

        // ★ ポップアップ（ナビ＋分析ページ）
        const popupHtml = `
          <div style="text-align:center;">
            <strong>${field.name}</strong><br><br>

            <button id="nav-${field.name}"
              style="margin:4px; padding:4px 10px;">
              Google Maps（ナビ）
            </button>

            <button id="analysis-${field.name}"
              style="margin:4px; padding:4px 10px;">
              圃場分析ページへ
            </button>
          </div>
        `;

        marker.bindPopup(popupHtml);

        // ★ ポップアップが開いたときにイベントを付ける
        marker.on("popupopen", () => {

          // Google Maps ナビ
          const navBtn = document.getElementById(`nav-${field.name}`);
          if (navBtn) {
            navBtn.addEventListener("click", () => {
              const url = `https://www.google.com/maps/dir/?api=1&destination=${field.lat},${field.lng}`;
              window.open(url, "_blank");
            });
          }

          // 圃場分析ページへ
          const analysisBtn = document.getElementById(`analysis-${field.name}`);
          if (analysisBtn) {
            analysisBtn.addEventListener("click", () => {
              const fieldName = encodeURIComponent(field.name);
              location.href = `../analysis/index.html?field=${fieldName}`;
            });
          }
        });
      });
    });
}

export { initMap };
