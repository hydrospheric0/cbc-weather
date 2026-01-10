# CBC weather

[![Top language](https://img.shields.io/github/languages/top/hydrospheric0/cbc-weather)](https://github.com/hydrospheric0/cbc-weather)
[![Language count](https://img.shields.io/github/languages/count/hydrospheric0/cbc-weather)](https://github.com/hydrospheric0/cbc-weather)

## About the Christmas Bird Count
The Christmas Bird Count is the nation’s longest-running community science bird project. They take place annualy between December 14 to January 5 in over 3000 count circles. More information can be found on the [Audubon website](https://www.audubon.org/community-science/christmas-bird-count).

## About the tool
This tool aims to **help count circle compilers** plan their count by:
- Creating accurate and easy-to-share insights into the likely weather conditions during their count
- Allow easy extraction of the observed conditions after the count for reporting purposes

The prototype of the app is hosted at: https://hydrospheric0.github.io/cbc-weather/

## Features
- OpenStreetMap basemap
- Selectable alternate base layer - ESRI satellite or ESRI Topo
- All CBC circle locations
- Automated location detection to detect nearest CBC circle
- Navigation to find CBC circles based on name, nearby geographic locations or coordinate
- 8-day weather forecast via the [Open-Meteo API](https://open-meteo.com/)
- Observed conditions (METAR) auto-fill via [AviationWeather.gov](https://aviationweather.gov/)

## How to use
By default the tool will request the user’s location. If permitted, the tool zooms in on the nearest count circle and populates the weather forecast. If the count date was published on the [CBC circles by National Audubon Society](https://gis.audubon.org/christmasbirdcount/), the count date will be highlighted on the plot.

Once the count has passed, the weather information for that circle’s count date will be automatically populated. This is the information a compiler needs to provide when filling out the count results on the [Audubon Application Portal](https://netapp.audubon.org/aap/application/cbc).

## About the weather forecast data
This project uses the [Open-Meteo API](https://open-meteo.com/) for generating teh weather forecast.
This API provides free and open access to forecast and 80 years of historical data for non-commercial use.

## About observed conditions (METAR)
For the “Weather report” (observed conditions after the count), this project uses the public [AviationWeather.gov](https://aviationweather.gov/) API:
- Station lookup: `/api/data/stationinfo` (to find the nearest METAR-capable station)
- METAR observations: `/api/data/metar` (to derive AM/PM cloud and precipitation categories, wind, temperature, etc.)

### Support this project

<a href="https://buymeacoffee.com/bartg">
	<img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me a Coffee" width="180" />
</a>
