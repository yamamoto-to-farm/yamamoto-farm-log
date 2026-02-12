import { getNearestField, saveJsonToGitHub } from "../common/app.js";
import { setupFieldSelector, setupWorkerSelector } from "../common/ui.js";

window.addEventListener("DOMContentLoaded", () => {
  setupFieldSelector("field-section");
  setupWorkerSelector("worker-section");

  setupVarietySelector();
  setupInputModeSwitch();
  setupTrayAutoCalc();

  document.getElementById("saveBtn").addEventListener("click", savePlanting);
});

async function setupVarietySelector() {
  const res = await fetch("../common/varieties.json");
  const list = await res.json();
  const sel = document.getElementById("variety");

  list.forEach(v => {
    const opt = document.createElement("option");
    opt.value = v.id;
    opt.textContent = v.name;
    sel.appendChild(opt);
  });
}

function setupInputModeSwitch() {
  const radios = document.querySelectorAll("input[name='mode']");
  radios.forEach(r => {
    r.addEventListener("change", () => {
      const mode = document.querySelector("input[name='mode']:checked").value;
      document.getElementById("stock-input").style.display = mode === "stock" ? "block" : "none";
      document.getElementById("tray-input").style.display = mode === "tray" ? "block" : "none";
    });
  });
}

function setupTrayAutoCalc() {
  const update = () => {
    const count = Number(document.getElementById("trayCount").value || 0);
    const type = Number(document.querySelector("input[name='trayType']:checked").value);
    document.getElementById("calcStock").textContent = count * type;
  };

  document.getElementById("trayCount").addEventListener("input", update);
  document.querySelectorAll("input[name='trayType']").forEach(r => r.addEventListener("change", update));
}

async function savePlanting() {
  const mode = document.querySelector("input[name='mode']:checked").value;

  let quantity = 0;
  let trayCount = null;
  let trayType = null;

  if (mode === "stock") {
    quantity = Number(document.getElementById("stockCount").value);
  } else {
    trayCount = Number(document.getElementById("trayCount").value);
    trayType = Number(document.querySelector("input[name='trayType']:checked").value);
    quantity = trayCount * trayType;
  }

  const data = {
    type: "planting",
    dateStr: new Date().toISOString().slice(0,10).replace(/-/g,""),
    json: {
      plantDate: new Date().toISOString().slice(0,10),
      worker: window.getSelectedWorkers(),
      field: window.getSelectedField(),
      variety: document.getElementById("variety").value,
      quantity,
      inputMode: mode,
      trayCount,
      trayType,
      spacingRow: Number(document.getElementById("spacingRow").value),
      spacingBed: Number(document.getElementById("spacingBed").value),
      notes: document.getElementById("notes").value
    },
    loggedAt: new Date().toISOString()
  };

  data.csv = [
    data.json.plantDate,
    data.json.worker,
    data.json.field,
    data.json.variety,
    data.json.quantity,
    data.json.spacingRow,
    data.json.spacingBed,
    data.json.notes
  ].join(",");

  await saveJsonToGitHub(`planting/${data.dateStr}.json`, data);
  alert("保存しました");
}