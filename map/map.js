// map.js
import { showPinGate } from "../common/ui.js";

window.addEventListener("DOMContentLoaded", () => {
  showPinGate("pin-container", () => {
    document.getElementById("map-container").style.display = "block";
    initMap();
  });
});

function initMap() {
  // とりあえず地図だけ表示（圃場は後で）
  const map = L.map("map").setView([34.75, 137.38], 13);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19
  }).addTo(map);
}