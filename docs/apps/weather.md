# Weather

`@moire/weather` shows current conditions and a seven-day forecast for a
chosen city. Its command is `moire-weather`, desktop entry is
`moire-weather.desktop`, and app ID is `org.moire.Weather`.

Search with at least two letters, then select a matching city. The app shows
temperature, feels-like temperature, wind, daily highs and lows, weather
conditions and rain probability. Temperatures use Celsius and wind uses
km/h. Forecast dates and times use the selected location's service-provided
time zone. Location selection is explicit; the app does not access GPS or
infer the user's location.

The app uses the credential-free Open-Meteo
[forecast API](https://open-meteo.com/en/docs) and
[geocoding API](https://open-meteo.com/en/docs/geocoding-api). The free API is
intended for non-commercial use and requires no key. Open-Meteo attribution
is shown in the window. Forecasts are weather estimates, not emergency alerts.

The eight most recently loaded locations and their forecasts are cached in
`$XDG_CACHE_HOME/moire/weather/places.json`, defaulting to
`~/.cache/moire/weather/places.json`. A cached forecast less than 15 minutes
old is used when selecting a saved location. Older forecasts refresh on
selection; Refresh explicitly requests a new forecast. Network errors retain
the selected location's saved forecast and display its age with an offline
status. A location with no saved forecast displays an unavailable state.
Clear Saved removes stored locations and cached data, aborts the current
forecast request and invalidates its result. A late response cannot restore cleared
locations or replace a newer refresh.

Requests have a 10-second timeout. Selecting another location cancels the
previous forecast request, and closing the window cancels outstanding
requests. The app does not poll in the background.

Run `pnpm --filter @moire/weather smoke` for service response validation,
real HTTP requests against a disposable local server, and actual Window
search, selection, persistent cache, offline recovery and clearing.
