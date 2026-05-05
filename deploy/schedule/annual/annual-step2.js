// annual-step2.js

export function initStep2(annual) {
  buildUI(annual);

  document.getElementById("addStep2Row").addEventListener("click", () => {
    annual.step2.rows.push({
      harvestWeek: "",
      variety: "",
      targetUnits: "",
      needArea: "",
      sowDate: "",
      plantDate: ""
    });
    buildUI(annual);
  });

  document.getElementById("recalcStep2").addEventListener("click", () => {
    recalc(annual);
  });
}

function buildUI(annual) {
  const tbody = document.getElementById("step2Body");
  tbody.innerHTML = "";

  annual.step2.rows.forEach((r, idx) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><input data-i="${idx}" data-k="harvestWeek" value="${r.harvestWeek}"></td>
      <td><input data-i="${idx}" data-k="variety" value="${r.variety}"></td>
      <td><input data-i="${idx}" data-k="targetUnits" value="${r.targetUnits}"></td>
      <td><input data-i="${idx}" data-k="needArea" value="${r.needArea}" readonly></td>
      <td><input data-i="${idx}" data-k="sowDate" value="${r.sowDate}"></td>
      <td><input data-i="${idx}" data-k="plantDate" value="${r.plantDate}"></td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll("input").forEach(inp => {
    const i = inp.dataset.i;
    const k = inp.dataset.k;
    inp.addEventListener("input", () => {
      annual.step2.rows[i][k] = inp.value;
    });
  });
}

function recalc(annual) {
  annual.step2.rows.forEach(r => {
    const target = Number(r.targetUnits || 0);
    const per10a = 5000; // 仮ロジック
    r.needArea = target > 0 ? (target / per10a).toFixed(2) : "";
  });
  buildUI(annual);
}
