# CBC weather

## About the Christmas Bird Count
The Christmas Bird Count is the nation’s longest-running community science bird project. It occurs December 14 to January 5 every season in over 3000 count circles. More information can be found on the [Audubon website](https://www.audubon.org/community-science/christmas-bird-count).

## About the tool
This tool was developed to **help count circle compilers** plan their count by:
- Creating accurate and easy-to-share insights into the likely weather conditions during their count
- Allow easy extraction of the observed conditions after the count for reporting purposes

The prototype of the app is hosted at: https://hydrospheric0.github.io/cbc-weather/

## Features
- OpenSetreetMap basemap
- Selectable alternate base layer - ESRI satellite or ESRI Topo
- All CBC circle locations
- Automated location detection to detect nearest CBC circle
- Navigation to find CBC circles based on name, nearby geographic locations or coordinate
- Seamless integration of [OpenWeather API](https://openweathermap.org/)

## How to use
By default the tool will request the user’s location. If permitted, the tool zooms in on the nearest count circle and populates the weather forecast. If the count date was published on the [CBC circles by National Audubon Society](https://gis.audubon.org/christmasbirdcount/), the count date will be highlighted on the plot.

Once the count has passed, the weather information for that circle’s count date will be automatically populated. This is the information a compiler needs to provide when filling out the count results on the [Audubon Application Portal](https://netapp.audubon.org/aap/application/cbc?_gl=1*14vfzzw*_gcl_au*NDI1NjA4MDIuMTc2NjI5MTI2MA..*_ga*MTAwNTY5OTc2Ny4xNzY2MjkxMjU5*_ga_X2XNL2MWTT*czE3NjY1OTQ0MjEkbzIkZzAkdDE3NjY1OTQ0MjEkajYwJGwwJGgw).

## About the weather data
This project uses the [Open-Meteo API](https://open-meteo.com/).
This API provides free and open access to forecast and 80 years of historical data for non-commercial use.

### Support this project

<a href="https://buymeacoffee.com/bartg">
	<img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me a Coffee" width="180" />
</a>
