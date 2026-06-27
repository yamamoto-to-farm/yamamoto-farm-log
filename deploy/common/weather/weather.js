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
