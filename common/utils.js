// utils.js

// URL から machine を取得（なければ machine1）
export function getMachineParam() {
  const url = new URL(location.href);
  return url.searchParams.get("machine") || "machine1";
}
