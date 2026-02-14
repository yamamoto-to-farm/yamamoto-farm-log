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
          // lat/lng だけの場合は circle
          layer = L.circle([field.lat, field.lng], {
            radius: 30,
            color: field.color || "#3388ff"
          }).addTo(map);
        }

        // ポップアップ
        layer.bindPopup(field.name);

        // ★ 圃場クリック → Google Maps ナビ
        layer.on("click", () => {
          const url = `https://www.google.com/maps/dir/?api=1&destination=${field.lat},${field.lng}`;
          window.open(url, "_blank");
        });
      });
    });
}