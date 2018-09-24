const request = require('request');
const countries = require('i18n-iso-countries');
countries.registerLocale(require("i18n-iso-countries/langs/en.json"));

var geocodeAddress = (key, lat, lon, callback) => {
var geourl='https://www.mapquestapi.com/geocoding/v1/reverse?key='+ key+ '&location=' +lat+','+lon+'&outFormat=json';
  request({
    url: geourl,
    json: true
  }, (error, response, body) => {
    if (error) {
      callback('Unable to connect to MapQuest servers.');
    } else if (body.info.statuscode==0){
	  //console.log(JSON.stringify(body));
	  console.log(JSON.stringify(body.results[0].locations[0].street));
	  var street = '';
	  var city= '';
	  var zip = '';
	  var country = '';
	  if (body.results[0].locations[0].street != '') {
		  street=body.results[0].locations[0].street;
		  console.log(street);}	  
	  if (body.results[0].locations[0].adminArea5  != '') {
		  city=body.results[0].locations[0].adminArea5;
		  console.log(city)};
	  if (body.results[0].locations[0].postalCode  != '') {
		  zip=body.results[0].locations[0].postalCode;
		  console.log(zip);}
	  if (body.results[0].locations[0].adminArea1  != '') {
		  country=body.results[0].locations[0].adminArea1;
		  console.log(country);
		  country=countries.getName(country, 'en');
		  console.log(country);
		  }
		  
	  if (zip !='') {
		  callback(undefined, {
			street: street,
			city: city,
			zip: zip,
			country: country
		  });		  
	  }
	  else {
		  callback('You are in ' + country + '. No zip found at this location.');
	  }
    } 
	else if (body.info.statuscode==400) {
      callback('Unable to find this location. Statuscode: ${body.info.statuscode}');
    } else {
		callback('Something went wrong. Statuscode: ${body.info.statuscode}');
	} 	
  });
};

module.exports.geocodeAddress = geocodeAddress;
