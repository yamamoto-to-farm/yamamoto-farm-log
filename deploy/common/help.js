const selector = [
  "[data-help]",
  "p.wp-note:not([id])", "p.shift-note:not([id])", "p.finance-note:not([id])",
  "p.machine-note:not([id])", "p.labor-note:not([id])", "p.shortcut-help",
].join(",");
const sources = new Map();

export function showHelp(source, trigger) {
  const dialog = document.createElement("dialog");
  dialog.className = "help-dialog";
  dialog.setAttribute("aria-label", trigger.getAttribute("aria-label"));
  const heading = document.createElement("h2");
  heading.textContent = source.dataset.help || "使い方・補足";
  const content = document.createElement("div");
  content.className = "help-dialog-content";
  for (const child of source.childNodes) content.appendChild(child.cloneNode(true));
  const close = document.createElement("button");
  close.type = "button";
  close.className = "secondary-btn";
  close.textContent = "閉じる";
  close.onclick = () => dialog.close();
  dialog.append(heading, content, close);
  document.body.appendChild(dialog);
  dialog.addEventListener("close", () => {
    dialog.remove();
    if (trigger.isConnected) trigger.focus();
  }, { once: true });
  dialog.addEventListener("click", event => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right
      || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  });
  dialog.showModal();
  close.focus();
}

export function refreshHelp(root = document) {
  for (const [source, trigger] of sources) {
    if (!source.isConnected) { trigger.remove(); sources.delete(source); }
    else if (!trigger.isConnected) sources.delete(source);
    else if (trigger.hidden !== source.hidden) trigger.hidden = source.hidden;
  }
  for (const source of root.querySelectorAll(selector)) {
    if (sources.has(source) || source.closest(".help-dialog") || source.matches(
      '[data-help-keep], [role="status"], [role="alert"], .warning, .warn, .error, .machine-caution, .msg-error')) continue;
    if (!source.textContent.trim()) continue;
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "help-trigger";
    trigger.textContent = "?";
    trigger.setAttribute("aria-label", `${source.dataset.help || "使い方・補足"}を表示`);
    trigger.setAttribute("aria-haspopup", "dialog");
    trigger.hidden = source.hidden;
    const heading = source.previousElementSibling;
    if (heading?.matches("h1, h2, h3, h4, legend")) heading.appendChild(trigger);
    else source.before(trigger);
    source.classList.add("help-source");
    trigger.onclick = () => showHelp(source, trigger);
    sources.set(source, trigger);
  }
}

const stylesheet = document.createElement("link");
stylesheet.rel = "stylesheet";
stylesheet.href = "/common/css/help.css?v=20261106-1";
document.head.appendChild(stylesheet);
refreshHelp();
new MutationObserver(() => refreshHelp()).observe(document.body, {
  childList: true, subtree: true, attributes: true, attributeFilter: ["hidden"],
});
