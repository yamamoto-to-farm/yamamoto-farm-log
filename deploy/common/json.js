export async function saveJSON(path, jsonObj) {
  const url = "https://whc3hq3yq6.execute-api.ap-northeast-1.amazonaws.com/prod/save-json";

  const body = {
    path: path,
    content: JSON.stringify(jsonObj)
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  const data = await res.json();
  if (!data.ok) {
    throw new Error("saveJSON failed: " + JSON.stringify(data));
  }
}