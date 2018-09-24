/*
 * Copyright 2016-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

/* jshint node: true, devel: true */
'use strict';

const
  bodyParser = require('body-parser'),
  config = require('config'),
  crypto = require('crypto'),
  express = require('express'),
  https = require('https'),
  request = require('request'),
  geocode = require('./geocode/geocode'),
  graph = require('fbgraph');
  
var app = express();
app.set('port', process.env.PORT || 5005);
app.set('view engine', 'ejs');
app.use(bodyParser.json({ verify: verifyRequestSignature }));
app.use(express.static('public'));

var options = {
    timeout:  3000
  , pool:     { maxSockets:  Infinity }
  , headers:  { connection:  "keep-alive" }
};


/*
 * Be sure to setup your config values before running this code. You can
 * set them using environment variables or modifying the config file in /config.
 *
 */

 //MapQuest Key
const KEY = (process.env.MAPQUEST_KEY) ?
  process.env.MAPQUEST_KEY :
  config.get('key');

// App Secret can be retrieved from the App Dashboard
const APP_SECRET = (process.env.MESSENGER_APP_SECRET) ?
  process.env.MESSENGER_APP_SECRET :
  config.get('appSecret');

// Arbitrary value used to validate a webhook
const VALIDATION_TOKEN = (process.env.MESSENGER_VALIDATION_TOKEN) ?
  (process.env.MESSENGER_VALIDATION_TOKEN) :
  config.get('validationToken');

// Generate a page access token for your page from the App Dashboard
const PAGE_ACCESS_TOKEN = (process.env.MESSENGER_PAGE_ACCESS_TOKEN) ?
  (process.env.MESSENGER_PAGE_ACCESS_TOKEN) :
  config.get('pageAccessToken');
// Set background access token
const WORKER_APP_ACCESS_TOKEN = (process.env.MESSENGER_WORKER_APP_ACCESS_TOKEN) ?
  (process.env.MESSENGER_WORKER_APP_ACCESS_TOKEN) :
  config.get('workerAppAccessToken');
// URL where the app is running (include protocol). Used to point to scripts and
// assets located at this address.
const SERVER_URL = (process.env.SERVER_URL) ?
  (process.env.SERVER_URL) :
  config.get('serverURL');

if (!(APP_SECRET && VALIDATION_TOKEN && PAGE_ACCESS_TOKEN && SERVER_URL)) {
  console.error("Missing config values");
  process.exit(1);
}

/*
 * Use your own validation token. Check that the token used in the Webhook
 * setup is the same token used here.
 *
 */
app.get('/webhook', function(req, res) {
  if (req.query['hub.mode'] === 'subscribe' &&
      req.query['hub.verify_token'] === VALIDATION_TOKEN) {
    console.log("Validating webhook");
    res.status(200).send(req.query['hub.challenge']);
  } else {
    console.error("Failed validation. Make sure the validation tokens match.");
    res.sendStatus(403);
  }
});


/*
 * All callbacks for Messenger are POST-ed. They will be sent to the same
 * webhook. Be sure to subscribe your app to your page to receive callbacks
 * for your page.
 * https://developers.facebook.com/docs/messenger-platform/product-overview/setup#subscribe_app
 *
 */
app.post('/webhook', function (req, res) {
  var data = req.body;

  // Make sure this is a page subscription
  if (data.object == 'page') {
    // Iterate over each entry
    // There may be multiple if batched
    data.entry.forEach(function(pageEntry) {
      var pageID = pageEntry.id;
      var timeOfEvent = pageEntry.time;

      // Iterate over each messaging event
      pageEntry.messaging.forEach(function(messagingEvent) {
        if (messagingEvent.optin) {
          receivedAuthentication(messagingEvent);
        } else if (messagingEvent.message) {
          receivedMessage(messagingEvent);
        } else if (messagingEvent.delivery) {
          receivedDeliveryConfirmation(messagingEvent);
        } else if (messagingEvent.postback) {
          receivedPostback(messagingEvent);
        } else if (messagingEvent.read) {
          receivedMessageRead(messagingEvent);
        } else if (messagingEvent.account_linking) {
          receivedAccountLink(messagingEvent);
        } else {
          console.log("Webhook received unknown messagingEvent: ", messagingEvent);
        }
      });
    });

    // Assume all went well.
    //
    // You must send back a 200, within 20 seconds, to let us know you've
    // successfully received the callback. Otherwise, the request will time out.
    res.sendStatus(200);
  }
});

/*
 * This path is used for account linking. The account linking call-to-action
 * (sendAccountLinking) is pointed to this URL.
 *
 */
app.get('/authorize', function(req, res) {
  var accountLinkingToken = req.query.account_linking_token;
  var redirectURI = req.query.redirect_uri;

  // Authorization Code should be generated per user by the developer. This will
  // be passed to the Account Linking callback.
  var authCode = "1234567890";

  // Redirect users to this URI on successful login
  var redirectURISuccess = redirectURI + "&authorization_code=" + authCode;

  res.render('authorize', {
    accountLinkingToken: accountLinkingToken,
    redirectURI: redirectURI,
    redirectURISuccess: redirectURISuccess
  });
});

/*
 * Verify that the callback came from Facebook. Using the App Secret from
 * the App Dashboard, we can verify the signature that is sent with each
 * callback in the x-hub-signature field, located in the header.
 *
 * https://developers.facebook.com/docs/graph-api/webhooks#setup
 *
 */
function verifyRequestSignature(req, res, buf) {
  var signature = req.headers["x-hub-signature"];

  if (!signature) {
    // For testing, let's log an error. In production, you should throw an
    // error.
    console.error("Couldn't validate the signature.");
  } else {
    var elements = signature.split('=');
    var method = elements[0];
    var signatureHash = elements[1];

    var expectedHash = crypto.createHmac('sha1', APP_SECRET)
                        .update(buf)
                        .digest('hex');

    if (signatureHash != expectedHash) {
      throw new Error("Couldn't validate the request signature.");
    }
  }
}

/*
 * Authorization Event
 *
 * The value for 'optin.ref' is defined in the entry point. For the "Send to
 * Messenger" plugin, it is the 'data-ref' field. Read more at
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/authentication
 *
 */
function receivedAuthentication(event) {
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;
  var timeOfAuth = event.timestamp;

  // The 'ref' field is set in the 'Send to Messenger' plugin, in the 'data-ref'
  // The developer can set this to an arbitrary value to associate the
  // authentication callback with the 'Send to Messenger' click event. This is
  // a way to do account linking when the user clicks the 'Send to Messenger'
  // plugin.
  var passThroughParam = event.optin.ref;

  console.log("Received authentication for user %d and page %d with pass " +
    "through param '%s' at %d", senderID, recipientID, passThroughParam,
    timeOfAuth);

  // When an authentication is received, we'll send a message back to the sender
  // to let them know it was successful.
  sendTextMessage(senderID, "Authentication successful");
}

/*
 * Message Event
 *
 * This event is called when a message is sent to your page. The 'message'
 * object format can vary depending on the kind of message that was received.
 * Read more at https://developers.facebook.com/docs/messenger-platform/webhook-reference/message-received
 *
 * For this example, we're going to echo any text that we get. If we get some
 * special keywords ('button', 'generic', 'receipt'), then we'll send back
 * examples of those bubbles to illustrate the special message bubbles we've
 * created. If we receive a message with an attachment (image, video, audio),
 * then we'll simply confirm that we've received the attachment.
 *
 */
function receivedMessage(event) {
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;
  var timeOfMessage = event.timestamp;
  var message = event.message;

  console.log("Received message for user %d and page %d at %d with message:",
    senderID, recipientID, timeOfMessage);
  console.log(JSON.stringify(message));

  var isEcho = message.is_echo;
  var messageId = message.mid;
  var appId = message.app_id;
  var metadata = message.metadata;

  // You may get a text or attachment but not both
  var messageText = message.text;
  var messageAttachments = message.attachments;
  var quickReply = message.quick_reply;

  if (isEcho) {
    // Just logging message echoes to console
    console.log("Received echo for message %s and app %d with metadata %s",
      messageId, appId, metadata);
    return;
  }  else if (quickReply) {
    var quickReplyPayload = quickReply.payload;
    console.log("Quick reply for message %s with payload %s",
      messageId, quickReplyPayload);
    if (quickReplyPayload === 'YES') {
	    sendQuickReplyLocation(senderID);		
	} else if (quickReplyPayload === 'NO') {
	    sendTextMessage(senderID, 'Maybe later. Have a nice day!');
	}
    return;
  } 

  if (messageText) {
    // If we receive a text message, check to see if it matches any special
    // keywords and send back the corresponding example. Otherwise, just echo
    // the text we received.
    switch (messageText.replace(/[^\w\s]/gi, '').trim().toLowerCase()) {
      case 'help':
        sendTextMessage(senderID, 'I am a simple Geolocation bot. When you share your location, I say your address using MapQuest. Type start or location to get started!');
        break;
	  
      case 'START':
      case 'start':	
      case 'location':		  
	    sendQuickReply(senderID);
        break;
		
      case 'privacy':
      case 'policy':
      case 'privacy policy':
         sendTextMessage(senderID, 'Here is the privacy policy: https://datadatbot.tk/privacypolicy/placelookup_policy.html');
        break;		
      case 'TOKEN':
        sendTextMessage(senderID, 'TOKEN');
        break;		
      default:
	    sendQuickReply(senderID);
    }
  } else if (messageAttachments) {
		if (messageAttachments[0].payload) {var payload = messageAttachments[0].payload;}
		console.log("Ez a location quick reply payload: " + payload);
		if (payload.coordinates) {
			console.log('Lat: ' + payload.coordinates.lat);
			console.log('Lon: ' + payload.coordinates.long);		
			geocode.geocodeAddress(KEY, payload.coordinates.lat, payload.coordinates.long, (errorMessage, results) => {
			if (errorMessage) {
				console.log(errorMessage);			
			} else if (results.zip){
				console.log(JSON.stringify(results, undefined, 2));
				sendTextMessage(senderID, 'Your location: ' + results.zip + ' ' + results.country + ', ' + results.city + ', ' + results.street + ' 📧');	
				var path='pages/search?q=Restaurant,' + results.zip + ' ' + results.country + '&fields=name,location';
				console.log(path);
				graphpagerequests(path).then(function(response) {
						var j=0;
						for (var i=0; j < 3; i++) {
							if (response.length>i && response[i].location.zip && response[i].location.zip == results.zip){
								j=j+1
								var id=response[i].id;
								var restaurantname='',
									restaurantcity='',
									restaurantcountry='',
									restaurantmessage='';
									restaurantstreet='';
								if (response[i].name){restaurantname=response[i].name;}
								if (response[i].location.city){restaurantcity=response[i].location.city;}
								if (response[i].location.country){restaurantcountry=response[i].location.country;}
								if (response[i].location.street){restaurantstreet=response[i].location.street;}
								}
							restaurantmessage=restaurantname + ' ' + restaurantstreet + ' ' + restaurantcity + ' ' + restaurantcountry;
							console.log(restaurantmessage);					
							sendTextMessage(senderID, restaurantmessage);									
						}
				}, function(error) {
					sendTextMessage(senderID, error);
				});
			} else {
			sendTextMessage(senderID, results);
			}
		});	  
	}
  }	
}


/*
 * Delivery Confirmation Event
 *
 * This event is sent to confirm the delivery of a message. Read more about
 * these fields at https://developers.facebook.com/docs/messenger-platform/webhook-reference/message-delivered
 *
 */
function receivedDeliveryConfirmation(event) {
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;
  var delivery = event.delivery;
  var messageIDs = delivery.mids;
  var watermark = delivery.watermark;
  var sequenceNumber = delivery.seq;

  if (messageIDs) {
    messageIDs.forEach(function(messageID) {
      console.log("Received delivery confirmation for message ID: %s",
        messageID);
    });
  }

  console.log("All message before %d were delivered.", watermark);
}


/*
 * Postback Event
 *
 * This event is called when a postback is tapped on a Structured Message.
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/postback-received
 *
 */
function receivedPostback(event) {
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;
  var timeOfPostback = event.timestamp;

  // The 'payload' param is a developer-defined field which is set in a postback
  // button for Structured Messages.
  var payload = event.postback.payload;
  console.log("Received postback for user %d and page %d with payload '%s' " +
  "at %d", senderID, recipientID, payload, timeOfPostback);

	// When a postback is called, we'll send a message back to the sender to
	// let them know it was successful
   sendQuickReply(senderID);
  

}

/*
 * Message Read Event
 *
 * This event is called when a previously-sent message has been read.
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/message-read
 *
 */
function receivedMessageRead(event) {
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;

  // All messages before watermark (a timestamp) or sequence have been seen.
  var watermark = event.read.watermark;
  var sequenceNumber = event.read.seq;

  console.log("Received message read event for watermark %d and sequence " +
    "number %d", watermark, sequenceNumber);
}

/*
 * Account Link Event
 *
 * This event is called when the Link Account or UnLink Account action has been
 * tapped.
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/account-linking
 *
 */
function receivedAccountLink(event) {
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;

  var status = event.account_linking.status;
  var authCode = event.account_linking.authorization_code;

  console.log("Received account link event with for user %d with status %s " +
    "and auth code %s ", senderID, status, authCode);
}

/*
 * If users came here through testdrive, they need to configure the server URL
 * in default.json before they can access local resources likes images/videos.
 */
function requiresServerURL(next, [recipientId, ...args]) {
  if (SERVER_URL === "to_be_set_manually") {
    var messageData = {
      recipient: {
        id: recipientId
      },
      message: {
        text: `
We have static resources like images and videos available to test, but you need to update the code you downloaded earlier to tell us your current server url.
1. Stop your node server by typing ctrl-c
2. Paste the result you got from running "lt —port 5000" into your config/default.json file as the "serverURL".
3. Re-run "node app.js"
Once you've finished these steps, try typing “video” or “image”.
        `
      }
    }

    callSendAPI(messageData);
  } else {
    next.apply(this, [recipientId, ...args]);
  }
}


/*
 * Send a text message using the Send API.
 *
 */
function sendTextMessage(recipientId, messageText) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      text: messageText,
      metadata: "DEVELOPER_DEFINED_METADATA"
    }
  };

  callSendAPI(messageData);
}

function graphpagerequests(requeststring) {
	return new Promise(function(resolve, reject) {
	var success = '0';
	//FB Error message set up.
	var generic_error_message='Something went wrong when I searched Facebook for you. Please type start to restart your search.'; // Ezt kapja, ha nem azonos�tottuk a hiba ok�t.
	//Ha nem kapna tartalmat, az �ltal�nos hib�ra inicializ�ljuk. 
	var errormessage=generic_error_message; 
	
	graph
	.setAccessToken(WORKER_APP_ACCESS_TOKEN)
	.setOptions(options)
	.get(requeststring , function(err, fbresponse) {
		console.log('Raw Fb response: ' + JSON.stringify(fbresponse));
		//var error10=JSON.parse('{"error":{"message":"(#10) To use Page Public Content Access, your use of this endpoint must be reviewed and approved by Facebook. To submit this Page Public Content Access feature for review please read our documentation on reviewable features: https://developers.facebook.com/docs/apps/review.","type":"OAuthException","code":10,"fbtrace_id":"ACGe5z+R+cc"}}');
		//var error190=JSON.parse('{"error":{"message":"Invalid OAuth access token signature.","type":"OAuthException","code":190,"fbtrace_id":"GQWHG+ETnCz"}}');
		//var error1=JSON.parse('{"error":{"message":"Invalid OAuth access token signature.","type":"OAuthException","code":1,"fbtrace_id":"GQWHG+ETnCz"}}');
		//var error0=JSON.parse('{"error":{"message":"Invalid OAuth access token signature.","type":"OAuthException","fbtrace_id":"GQWHG+ETnCz"}}');
		//fbresponse=error803;
		
		if (fbresponse && fbresponse['error']) {
			// extract the error from the json
			console.log('Graph api error!!!!');
			var error=fbresponse['error'];
			if (error && error['code']) {
			// extract the error code
				var code=error['code'];
				console.log(code);
				//Let the message be appropriate to the error code
				switch (code) {
					case 10:
						errormessage='Sorry, still waiting to pass the review by Facebook to be able to serve you.';
					break;
					case 190:
						errormessage='There is a problem with Fb authentication. I cannot respond to your queries right now.';
						break;
					default:
						errormessage=generic_error_message;
				}
			
			} else {
			errormessage=generic_error_message;
			}
			reject(errormessage);
		} else {if (fbresponse && fbresponse['data']) {
				if (fbresponse['data'].length>0){
					resolve(fbresponse['data']); //This is the meat of the application
				}
				else
				errormessage='No restaurants found at this zip code.';
				reject(errormessage);
					
			} else {
				reject(errormessage);
				
			}
		}
		
		});	

  });

}


/*
 * Send a message with Quick Reply buttons.
 *
 */
function sendQuickReplyLocation(recipientId) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      text: "Let me know where you are by pressing 👇🏿👇🏿👇🏿👇🏿THE BUTTON👇🏿👇🏿👇🏿👇🏿 and sharing your location.",
      quick_replies: [
        {
          "content_type":"location"
        }
      ]
    }
  };

  callSendAPI(messageData);
}
/*
 * Send a message with Quick Reply buttons.
 *
 */
function sendQuickReply(recipientId) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      text: "Let me know where you are 🏝️ 🏔️ 🌋 🌄 and I will tell you your city 🏙️ and zip code. ",
      quick_replies: [
        {
          "content_type":"text",
		  "title":"Let's get started!",
          "payload":"YES"
        },
		{
          "content_type":"text",
		  "title":"No thanks.",
          "payload":"NO"
        }

      ]
    }
  };

  callSendAPI(messageData);
}

/*
 * Call the Send API. The message data goes in the body. If successful, we'll
 * get the message id in a response
 *
 */
function callSendAPI(messageData) {
  request({
    uri: 'https://graph.facebook.com/v2.6/me/messages',
    qs: { access_token: PAGE_ACCESS_TOKEN },
    method: 'POST',
    json: messageData

  }, function (error, response, body) {
    if (!error && response.statusCode == 200) {
      var recipientId = body.recipient_id;
      var messageId = body.message_id;

      if (messageId) {
        console.log("Successfully sent message with id %s to recipient %s",
          messageId, recipientId);
      } else {
      console.log("Successfully called Send API for recipient %s",
        recipientId);
      }
    } else {
      console.error("Failed calling Send API", response.statusCode, response.statusMessage, body.error);
    }
  });
}

// Start server
// Webhooks must be available via SSL with a certificate signed by a valid
// certificate authority.
app.listen(app.get('port'), function() {
  console.log('Node app is running on port', app.get('port'));
});

module.exports = app;
