const geocode = require('./geocode/geocode'),
	config = require('config');

const KEY = (process.env.MAPQUEST_KEY) ?
  process.env.MAPQUEST_KEY :
  config.get('key');

var lat='47.5115',
  lon = '19.02876';
  
geocode.geocodeAddress(KEY, lat, lon, (errorMessage, results) => {
  if (errorMessage) {
    console.log(errorMessage);
  } else {
    console.log(JSON.stringify(results, undefined, 2));
  }
});