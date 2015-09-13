'use strict';

if (!process.env.VCAP_SERVICES) {
  require('dotenv').load();
}

var vcapServices = JSON.parse(process.env.VCAP_SERVICES);

var SENDGRID = JSON.parse(process.env.SENDGRID);

var Hapi = require('hapi');
var Cloudant = require('cloudant');
var emailjs = require('emailjs');
var request = require('request');
var Pusher = require('pusher');

var pusher = new Pusher({
  appId: '141471',
  key: '0c14468a7026fcb6895b',
  secret: '8f7490ee1930c36495a8'
});

var server = new Hapi.Server({ debug: { request: ['error'] } });

server.connection({
  host: process.env.VCAP_APP_HOST || 'localhost',
  port: process.env.VCAP_APP_PORT || 3000,
});

server.route({
  method: 'GET',
  path: '/send',
  handler: function(req, reply) {
    var email = req.query.email;
    var sendgrid  = require('sendgrid')(SENDGRID.username, SENDGRID.password);

    var url = 'http://email-interaction.eu-gb.mybluemix.net/';

    var payload   = {
      to      : email,
      from    : "howareyou@guardian.me",
      subject : 'Hey, how are you?',
      text: "Hi,\r\n" + "\r\n" + "We\'re just checking in to see how you\'re doing.\r\n\r\n" + url + "/good/?type=email&email=" + email + "\r\n\r\n"  + url + "/sad/?type=email&email=" + email + "\r\n" + "\r\n" + "Thanks,\r\n" + "Mike",
    }

    sendgrid.send(payload, function(err, json) {
      if (err) { console.error(err); }
      console.log(json);
    });

    pusher.trigger('channel-1', 'interaction-event', { type: "email", message: "Quiz Email" });

    var dbName = req.query.email.replace(/[^0-9A-Za-z]+/g, '_').toLowerCase();
    Cloudant({account:vcapServices.cloudantNoSQLDB[0].credentials.username, password:vcapServices.cloudantNoSQLDB[0].credentials.password}, function(er, cloudant) {
      cloudant.db.create(dbName, function(err, body) {

        if(err)
          console.log(err);

        var database = cloudant.db.use(dbName);

        database.get('_design/lookups', function(err, body) {
          if (!err)
            console.log(body);
          database.insert({"views": {"timestamp":{"map": "function (doc) {\n  emit(doc.timestamp, 1);\n}"}}}, '_design/lookups', function(err, body, header) {});
        });
      });
    });

    reply({});
  },
});

server.route({
  method: 'GET',
  path: '/good',
  handler: function(req, reply) {
    var dbName = req.query.email.replace(/[^0-9A-Za-z]+/g, '_').toLowerCase();
    Cloudant({account:vcapServices.cloudantNoSQLDB[0].credentials.username, password:vcapServices.cloudantNoSQLDB[0].credentials.password}, function(er, cloudant) {
      var database = cloudant.db.use(dbName);

      var d = new Date();

      database.insert({
        timestamp: d.getTime(),
        score: 75,
        reqType: req.query.type
      },function(err,body){
        reply({message:"Your doing great."});
      });
    });
  },
});

server.route({
  method: 'GET',
  path: '/bad',
  handler: function(req, reply) {
    var dbName = req.query.email.replace(/[^0-9A-Za-z]+/g, '_').toLowerCase();
    Cloudant({account:vcapServices.cloudantNoSQLDB[0].credentials.username, password:vcapServices.cloudantNoSQLDB[0].credentials.password}, function(er, cloudant) {

      if(req.query.type=='flic') {
        pusher.trigger('channel-1', 'interaction-event', { type: "flic", message: "Button pressed." });
      }

      request.post({
        url:     'http://battlehack.curtish.me/twilio/trigger'
      }, function(error, response, body){
        if (error) console.log(error)
        pusher.trigger('channel-1', 'interaction-event', { type: "twilio", message: "Text message sent." });
      });

      var database = cloudant.db.use(dbName);

      var d = new Date();

      database.insert({
        timestamp: d.getTime(),
        score: 25,
        reqType: req.query.type
      },function(err,body){
        if (err) console.log(err);
        reply({message:"How can we help?"});
      });
    });
  },
});

server.route({
  method: 'GET',
  path: '/',
  handler: function(req, reply) {
    var dbName = req.query.email.replace(/[^0-9A-Za-z]+/g, '_').toLowerCase();
    Cloudant({account:vcapServices.cloudantNoSQLDB[0].credentials.username, password:vcapServices.cloudantNoSQLDB[0].credentials.password}, function(er, cloudant) {
      var database = cloudant.db.use(dbName);

      var viewParams = {
          inclusive_end: true,
          include_docs:true
        };

      if(req.query.start_date)
        viewParams.start_key = req.query.start_date*1000;
      if(req.query.end_date)
        viewParams.end_key = req.query.end_date*1000;

      database.view('lookups', 'timestamp', viewParams, function(err, body) {
        var score = 0;
        body.rows.forEach(function(doc) {
          score += doc.doc.score;
        });

        var frequency = body.rows.length;

        reply({score:(score/frequency),frequency:frequency})
      });


    });
  },
});

server.start(function() {
  console.log('Server running at:', server.info.uri);
});
