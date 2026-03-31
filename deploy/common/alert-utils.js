// /common/alert-utils.js

export function showSaveAlert(title, items) {
  let msg = `${title}\n\n`;

  for (const item of items) {
    if (item.label && item.value !== undefined) {
      msg += `${item.label}: ${item.value}\n`;
    }
  }

  alert(msg);
}