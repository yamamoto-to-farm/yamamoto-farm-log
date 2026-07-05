// common/weather/weather.js

export async function loadWeatherYear(year) {
  const url = `/data/weather/${year}.json`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      return {};
    }

    const contentType = String(res.headers.get("content-type") || "").toLowerCase();
    if (!contentType.includes("application/json")) {
      const text = await res.text();
      if (!text.trim().startsWith("{")) {
        return {};
      }

      try {
        return JSON.parse(text);
      } catch {
        return {};
      }
    }

    return await res.json();
  } catch {
    return {};
  }
}

export async function getWeatherByDate(date) {
  if (!date || typeof date !== "string" || date.length < 10) {
    return null;
  }

  const year = date.slice(0, 4);
  const data = await loadWeatherYear(year);
  if (!data || typeof data !== "object") return null;
  return data[date] || null;
}

/**
 * 天気判定（晴・曇・雨）
 * precip: 降水量 (mm)
 * sunshine: 日照時間 (h)
 */
export function classifyWeather(precip, sunshine) {
  // 雨判定（農業的には 1mm 以上で雨扱い）
  if (precip >= 1) return "雨";

  // 晴れ判定（気象庁の基準に近い）
  if (sunshine >= 5) return "晴";

  // 晴れ・曇りの中間
  if (sunshine >= 0.5) return "晴れ・曇り";

  // 曇り
  return "曇";
}

export function weatherIcon(type) {
  if (type === "晴") return "☀️";
  if (type === "曇") return "🌥️";
  if (type === "雨") return "🌧️";
  return "🌤";
}
