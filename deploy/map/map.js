// map.js

export function initMap() {

  const map = L.map("map").setView([34.75, 137.38], 13);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19
  }).addTo(map);

  const fieldLayers = {};
  let lastSelected = "";
  let nextSelected = "";

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
          <img src="../img/cabbage.png"
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

  fetch("../data/fields.json")
    .then(res => res.json())
    .then(fields => {

      const select = document.getElementById("fieldSelect");

      fields.forEach(f => {
        const opt = document.createElement("option");
        opt.value = f.name;
        opt.textContent = f.name;
        select.appendChild(opt);
      });

      fields.forEach(field => {

        const safeId = field.name.replace(/[^a-zA-Z0-9_-]/g, "_");

        let polygon = null;
        if (field.coords) {
          polygon = L.polygon(field.coords, {
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
              圃場詳細ページへ
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
              location.href = `/fields/index.html?field=${fieldName}`;
            });
          }
        });

        fieldLayers[field.name] = { polygon, marker, field };
      });

      select.addEventListener("click", () => {
        nextSelected = select.value;
      });

      select.addEventListener("change", () => {
        let selected = select.value;

        if (selected === lastSelected && selected === nextSelected) {
          selected = "";
          select.value = "";
        }

        lastSelected = selected;

        Object.keys(fieldLayers).forEach(name => {
          const { polygon, marker, field } = fieldLayers[name];
          const isSelected = (name === selected);

          if (polygon) {
            polygon.setStyle({
              color: isSelected ? "red" : (field.color || "#3388ff"),
              weight: isSelected ? 4 : 2
            });
          }

          marker.setIcon(createFieldIcon(field, isSelected));

          if (isSelected) {
            if (polygon) {
              map.fitBounds(polygon.getBounds(), { padding: [30, 30] });
            } else {
              map.setView([field.lat, field.lng], 17);
            }
          }
        });

        if (selected === "") {
          map.setView([34.75, 137.38], 13);
        }
      });

      // ★ Leaflet の描画ズレを完全解消
      setTimeout(() => {
        map.invalidateSize();
      }, 200);

    });
}
