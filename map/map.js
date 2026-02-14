// map.js
import { showPinGate } from "../common/ui.js";

window.addEventListener("DOMContentLoaded", () => {
  showPinGate("pin-container", () => {
    document.getElementById("map-container").style.display = "block";
    initMap();
  });
});

function initMap() {
  const map = L.map("map").setView([34.75, 137.38], 13);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19
  }).addTo(map);

  // ★ キャベツアイコン
  const cabbageIcon = L.icon({
    iconUrl: '../img/cabbage.png',   // ← 画像を置く場所
    iconSize: [40, 40],
    iconAnchor: [20, 20]
  });

  fetch("../data/fields.json")
    .then(res => res.json())
    .then(fields => {
      fields.forEach(field => {
        let layer;

        // polygon がある場合
        if (field.coords) {
          layer = L.polygon(field.coords, {
            color: field.color || "#3388ff",
            weight: 2
          }).addTo(map);
        } else {
          // ★ lat/lng の場合はキャベツアイコン
          layer = L.marker([field.lat, field.lng], {
            icon: cabbageIcon
          }).addTo(map);
        }

        // ★ ポップアップ（ナビ + 分析ページ）
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

        layer.bindPopup(popupHtml);

        layer.on("popupopen", () => {
          // ナビ
          const navBtn = document.getElementById(`nav-${field.name}`);
          if (navBtn) {
            navBtn.addEventListener("click", () => {
              const url = `https://www.google.com/maps/dir/?api=1&destination=${field.lat},${field.lng}`;
              window.open(url, "_blank");
            });
          }

          // 分析ページ
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