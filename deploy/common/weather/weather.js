// common/weather/weather.js

export async function loadWeatherYear(year) {
  const url = `/data/weather/${year}.json`;
  const res = await fetch(url);
  return await res.json();
}

export async function getWeatherByDate(date) {
  const year = date.slice(0, 4);
  const data = await loadWeatherYear(year);
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
