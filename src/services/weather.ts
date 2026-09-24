export interface WeatherData {
  temperature: number | null
  windSpeed: number | null
  windDirection: string | null
  humidity: number | null
  visibility: number | null
  conditions: string | null
}

export function getMockWeather(): WeatherData {
  return {
    temperature: null,
    windSpeed: null,
    windDirection: null,
    humidity: null,
    visibility: null,
    conditions: null,
  }
}
