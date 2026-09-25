/** Legacy summaries without kind remain forecasts; historical data is explicit. */
export function weatherPresentation(weather: {
  kind?: string;
  precipitation_probability: number | null;
  historical_wet_day_frequency?: number;
  historical_period?: string;
}) {
  const historical = weather.kind === "historical";
  return {
    title: historical ? "Typical conditions" : "Forecast",
    qualifier: historical ? `Based on historical conditions${weather.historical_period ? ` (${weather.historical_period})` : ""}, not a forecast.` : "",
    precipitation: historical
      ? weather.historical_wet_day_frequency == null ? "" : `${weather.historical_wet_day_frequency}% of sampled historical days had at least 1 mm precipitation.`
      : weather.precipitation_probability == null ? "" : `${weather.precipitation_probability}% chance of precipitation`,
  };
}
