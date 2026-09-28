import { verifyLocalAuth, bumpAuthVersion } from "/common/ui.js";
import { renderHeader } from "/common/header.js?v=1.1";
import { saveJSON } from "/common/json.js?v=1";
import { showSaveModal, completeSaveModal } from "/common/save-modal.js?v=1";

window.addEventListener("DOMContentLoaded", async () => {
  const authenticated = await verifyLocalAuth();
  if (!authenticated) return;
  if (window.currentRole !== "admin") {
    alert("このページは管理者のみ利用できます");
    location.href = "/admin/index.html";
    return;
  }

  renderHeader({ adminPage: true });
  document.getElementById("page-area").style.display = "block";

  const response = await fetch(`/data/workers.json?v=${Date.now()}`);
  if (!response.ok) {
    alert("従業員データを読み込めませんでした");
    return;
  }
  let accounts = await response.json();
  accounts = Array.isArray(accounts) ? accounts.map(account => ({ ...account })) : [];

  const list = document.getElementById("employee-list");
  const employeeIndices = () => accounts
    .map((account, index) => account?.role === "worker" ? index : -1)
    .filter(index => index >= 0);

  function render() {
    const indices = employeeIndices();
    if (!indices.length) {
      list.innerHTML = "";
      const empty = document.createElement("p");
      empty.className = "info-line";
      empty.textContent = "従業員はまだ登録されていません。";
      list.appendChild(empty);
      return;
    }

    list.innerHTML = `
      <table class="employee-table">
        <thead>
          <tr>
            <th scope="col">表示名</th>
            <th scope="col">識別名</th>
            <th scope="col">在籍状況</th>
          </tr>
        </thead>
        <tbody></tbody>
      </table>
    `;
    const tbody = list.querySelector("tbody");

    indices.forEach(index => {
      const employee = accounts[index];
      const row = document.createElement("tr");
      row.className = "employee-row";
      row.dataset.index = String(index);

      const displayCell = document.createElement("td");
      displayCell.style.textAlign = "left";
      displayCell.textContent = String(employee.display || "（未設定）");

      const nameCell = document.createElement("td");
      nameCell.style.textAlign = "left";
      nameCell.textContent = String(employee.name || "（未設定）");

      const statusCell = document.createElement("td");
      statusCell.style.textAlign = "center";
      const statusSelect = document.createElement("select");
      statusSelect.className = "form-input employee-status";
      statusSelect.innerHTML = '<option value="active">在籍中</option><option value="retired">退職済み</option>';
      statusSelect.value = employee.employmentStatus === "retired" ? "retired" : "active";
      statusCell.appendChild(statusSelect);

      row.append(displayCell, nameCell, statusCell);
      tbody.appendChild(row);
    });
  }

  document.getElementById("save-employees-btn").addEventListener("click", async () => {
    const nextAccounts = accounts.map(account => ({ ...account }));
    const usedNames = new Set(nextAccounts
      .filter(account => account?.role !== "worker")
      .map(account => String(account?.name || "").trim())
      .filter(Boolean));
    let retiring = false;

    for (const row of list.querySelectorAll(".employee-row")) {
      const index = Number(row.dataset.index);
      const employmentStatus = row.querySelector(".employee-status").value;
      const previous = nextAccounts[index];
      const name = String(previous.name || "").trim();
      if (usedNames.has(name)) {
        alert(`識別名「${name}」が重複しています。`);
        return;
      }
      usedNames.add(name);
      if (employmentStatus === "retired" && previous.employmentStatus !== "retired") retiring = true;
      nextAccounts[index] = {
        ...previous,
        role: "worker",
        employmentStatus,
        pin: employmentStatus === "retired" ? "" : String(previous.pin || "")
      };
    }

    if (retiring && !confirm("退職済みにする従業員のPINを削除し、ログインできなくします。従業員情報は保存して残します。続けますか？")) return;

    showSaveModal("保存しています…");
    try {
      await saveJSON("data/workers.json", nextAccounts);
      await bumpAuthVersion("employee roster updated");
      accounts = nextAccounts;
      completeSaveModal("保存が完了しました");
      render();
    } catch (error) {
      console.error("従業員データの保存に失敗しました:", error);
      completeSaveModal("保存に失敗しました");
    }
  });

  render();
});