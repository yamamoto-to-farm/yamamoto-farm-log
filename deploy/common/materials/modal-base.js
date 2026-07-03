function ensureHost() {
  let host = document.getElementById("material-info-modal-host");
  if (!host) {
    host = document.createElement("div");
    host.id = "material-info-modal-host";
    document.body.appendChild(host);
  }
  return host;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function openInfoModal({ title, rows = [] }) {
  const host = ensureHost();

  const rowsHtml = rows
    .filter(v => v && String(v.value ?? "").trim() !== "")
    .map(v => `
      <tr>
        <th style="text-align:left; vertical-align:top; padding:8px; width:180px; border-bottom:1px solid #eee;">${escapeHtml(v.label)}</th>
        <td style="padding:8px; border-bottom:1px solid #eee; white-space:pre-wrap; word-break:break-word;">${escapeHtml(v.value)}</td>
      </tr>
    `)
    .join("");

  host.innerHTML = `
    <div id="material-info-modal-bg" style="position:fixed; inset:0; background:rgba(0,0,0,0.45); z-index:9999; display:flex; align-items:center; justify-content:center; padding:16px;">
      <div style="background:#fff; width:min(920px, 100%); max-height:90vh; border-radius:10px; overflow:auto; box-shadow:0 14px 40px rgba(0,0,0,0.3);">
        <div style="display:flex; justify-content:space-between; align-items:center; padding:12px 16px; border-bottom:1px solid #eee; position:sticky; top:0; background:#fff;">
          <h3 style="margin:0; font-size:1.05rem;">${escapeHtml(title || "詳細")}</h3>
          <button id="material-info-modal-close" class="secondary-btn" type="button">閉じる</button>
        </div>
        <div style="padding:12px 16px;">
          <table style="width:100%; border-collapse:collapse; font-size:0.95rem;">
            <tbody>${rowsHtml || '<tr><td style="padding:8px; color:#666;">表示できる情報がありません。</td></tr>'}</tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  const close = () => {
    host.innerHTML = "";
  };

  host.querySelector("#material-info-modal-close")?.addEventListener("click", close);
  host.querySelector("#material-info-modal-bg")?.addEventListener("click", e => {
    if (e.target?.id === "material-info-modal-bg") close();
  });
}
