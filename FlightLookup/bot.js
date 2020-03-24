var Backbone = require('backbone');
var Discord = require('discord.io');
var airportsJson = require('./airports.json');
var auth = require('./auth.json');
var logger = require('winston');

// var request = require('request');
// var sleep = require('sleep');

var airports = new Backbone.Collection(airportsJson);
var airportObjects = airports.toJSON();

var commands = [];
commands = {
    'lookup': {
        parameters: {
            'airport': {
                prefix: 'an',
                plural: 'airports',
                keys: {
                    'iata': { 
                        prefix: 'an',
                        plural: 'codes',
                        code: 'IATA',
                        description: 'International Air Transport Association code'
                    },
                    'icao': {
                        prefix: 'an',
                        plural: 'codes',
                        code: 'ICAO', 
                        description: 'International Civil Aviation Organization code'
                    },
                    'name': {
                        prefix: 'a',
                        plural: 'names',
                        code: 'name', 
                        description: 'name of the airport'
                    }
                }
            }
        }
    }
};

// Configure logger
logger.remove(logger.transports.Console);
logger.add(new logger.transports.Console, {
    name: 'debug-console',
    colorize: true,
    level: 'debug',
    prettyPrint: true
});

// Initialise bot
var bot = new Discord.Client({
    token: auth.token,
    autorun: true
});

bot.on('ready', function(event) {
    logger.info('Connected. Logged in as: ' + bot.username + ' - (' + bot.id + ')');
    logger.info('');
});

bot.on('message', parseRequest);

// Initialise conversation tracking
var conversations = [];
var users = [];

function parseRequest(username, userId, channelId, message, event) {
    //logger.info(JSON.stringify(event));
    
    if (username == 'FlightLookup') {
        return;
    }
    
    var author = event.d.author;
    if (!users.hasOwnProperty(userId)) {
        users[userId] = author;
        logger.info('Added user ' + author.username + '#' + author.discriminator);
        logger.info('');
    }

    var conversationId = updateConversation(author.id, channelId, message);
    var call = parseCall(conversationId, message);

    logger.info('Call details after parse: ' + JSON.stringify(call));

    conversations[conversationId].call = call;
    
    switch (conversations[conversationId].call.command) {
        case 'lookup':
            response = lookup(author, conversations[conversationId].call);
            logger.info('Got response ' + response);
            speak(channelId, response);
    }
}

function updateConversation(userId, channelId, message) {
    var username = users[userId].username + '#' + users[userId].discriminator
    var conversationId = username + '-' + channelId;

    if (!conversations.hasOwnProperty(conversationId) || message.substring(0, 1) == "$") {
        if (message.substring(0, 1) == "$") {
            message = message.substring(1).split(' ');
        }
    
        logger.info('Created new conversation ' + conversationId);
        logger.info('');
        
        var newCall = {command: '', parameter: '', key: '', query: ''};
        conversations[conversationId] = {username, channelId, messages: [message], call: newCall};
    }
    else {
        logger.info('Found conversation ' + conversationId);
        logger.info('');

        conversations[conversationId].messages.push(message);
    }

    return conversationId;
}

function parseCall(conversationId, message) {

    if (message.substring(0, 1) == '$') {
        conversations[conversationId].call = {command: '', parameter: '', key: '', query: ''};
        message = message.substring(1);
    }

    var args = message.split(' ');
    var existingCall = conversations[conversationId].call;
    var call = {command: existingCall.command, parameter: existingCall.parameter, key: existingCall.key, query: existingCall.query}

    for (var i = 0; i < args.length; i++) {
        var arg = args[i];
        if (arg.substring(arg.length - 1) == 's') {
            arg = arg.substring(0, arg.length - 1);
            args.shift();
            i -= 1;
        }
        arg = arg.toLowerCase();

        if (commands.hasOwnProperty(arg)) {
            call.command = arg;
            args.shift();
            i -= 1;
        }

        if (commands[call.command] != null) {
            if (commands[call.command].parameters.hasOwnProperty(arg)) {
                call.parameter = arg;
                args.shift();
                i -= 1;
            }
        }

        if (commands[call.command] != null && commands[call.command].parameters[call.parameter] != null) {
            if (commands[call.command].parameters[call.parameter].keys.hasOwnProperty(arg)) {
                call.key = arg;
                args.shift();
                i -= 1;
            }
        }
    }

    if (call.key == '') {
        return call;
    }

    if (args.length > 0) {
        call.query = args[0];
    }

    return call;
}

function lookup(user, call) {

    var response = '';
    var options = [];
    var keys = [];

    if (call.parameter == '') {
        logger.info('No command given');
        response = 'Hi ' + user.username + '. What would you like to search for? '
        keys = Object.keys(commands[call.command].parameters);
        options = commands[call.command].parameters;
    }
    else if (call.key == '') {
        logger.info('Command present but no parameters given');
        response = 'What do you want to search by? ';
        keys = Object.keys(commands[call.command].parameters[call.parameter].keys);
        options = commands[call.command].parameters[call.parameter].keys;
    }
    else if (call.query == '') {
        var code = commands[call.command].parameters[call.parameter].keys[call.key].code;
        return 'What is the ' + code + ' you want to look up?';
    }

    if (keys.length == 1) {
        response += 'I can only look up ' + options[keys[0]].plural + ' at the moment.';
        return response;
    }
    else if (keys.length > 1) {
        response += 'I can look things up by ';

        for(var i = 0; i < keys.length; i++) {
            if (i == keys.length - 1) {
                response += 'or ' + options[keys[i]].code;
                continue;
            }

            response += options[keys[i]].code + ', '
        }
        return response;
    }

    var iata = (call.key == 'iata' ? call.query : '');
    var icao = (call.key == 'icao' ? call.query : '');
    var name = (call.key == 'name' ? call.query : '');

    return airportSearch(iata, icao, name);
}

function airportSearch(iata, icao, name) {
    var query = '';
    var possibleIatas = [];
    var possibleIcaos = [];
    var possibleNames = [];

    if (iata.length > 0) {
        iata = iata.toUpperCase();
        query += 'an IATA like "' + iata + '"';

        possibleIatas = airportObjects.filter(airport => isPartialMatch(iata, airport.iata));
    }

    if (icao.length > 0) {
        if (query.length > 0) {
            query += ' and '
        }

        icao = icao.toUpperCase();
        query += 'an ICAO like "' + icao + '"';

        possibleIcaos = airportObjects.filter(airport => isPartialMatch(icao, airport.icao));
    }

    if (name.length > 0) {
        if (query.length > 0) {
            query += ' and '
        }

        query += 'a name like "' + name + '"';
        possibleNames = airportObjects.filter(airport => isPartialMatch(name, airport.name));
    }

    var response = 'OK, searching for ' + query + ' I found: ';

    if (possibleIatas.length + possibleIcaos.length + possibleNames.length == 0) {
        response += 'nothing';

        return response;
    }

    for (var i = 0; i < possibleIatas.length; i++) {
        response += additionalAirportResponse(possibleIatas[i]);
    }

    for (var i = 0; i < possibleIcaos.length; i++) {
        response += additionalAirportResponse(possibleIcaos[i]);
    }

    for (var i = 0; i < possibleNames.length; i++) {
        response += additionalAirportResponse(possibleNames[i]);
    }

    return response;
}

function isPartialMatch(query, value) {
    return value.toLowerCase().includes(query.toLowerCase());
}

function additionalAirportResponse(airport) {
    return '\n' + airport.name + ' (IATA: ' + airport.iata + ', ICAO: ' + airport.icao + ')';
}

function speak(channelId, message) {
    bot.sendMessage({
        to: channelId,
        message: message
    });
}