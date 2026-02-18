// map.js

// ★ initMap は export するだけ。自動実行しない。
export function initMap() {

  const map = L.map("map").setView([34.75, 137.38], 13);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19
  }).addTo(map);

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

  // ★ 絶対パスに変更（安全 & 安定）
  fetch("/yamamoto-farm-log/data/fields.json")
    .then(res => res.json())
    .then(fields => {

      fields.forEach(field => {

        // ★ id として安全な文字列に変換
        const safeId = field.name.replace(/[^a-zA-Z0-9_-]/g, "_");

        if (field.coords) {
          L.polygon(field.coords, {
            color: field.color || "#3388ff",
            weight: 2
          }).addTo(map);
        }

        const marker = L.marker([field.lat, field.lng], {
          icon: createFieldIcon(field)
        }).addTo(map);

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
              location.href = `../analysis/index.html?field=${fieldName}`;
            });
          }
        });
      });
    });
}