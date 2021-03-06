try{
// Package requirements

const express   = require('express');
const hbs       = require('express-handlebars').create();
const http      = require('http');
const socket    = require('socket.io');

const chat      = require('./classes.js');
const config    = require('./server-config.json');
const randoms   = {
    names   : require('./defaults/randomNames.js'),
    joins   : require('./defaults/joinMessages.js'),
    leaves  : require('./defaults/leaveMessages.js')
};


// Caches Setup

let cached_users = require('./cache_users.js');
let cached_channels = require('./cache_channels.js');

cached_users.set(config.adminToken, new chat.User('administrator', 'admin', [['color', 'red; background: linear-gradient(124deg, #ff2400, #e81d1d, #e8b71d, #e3e81d, #1de840, #1ddde8, #2b1de8, #dd00f3, #dd00f3);-webkit-background-clip: text;-webkit-text-fill-color: transparent;'], ['verified', 'true'], ['token', config.adminToken]])); // Yeah fuck this line but who doesn't want a cool rainbow username for his admin account

let new_channel = [
    new chat.Channel('announcements', 'news'),
    new chat.Channel(config.defaultChannel),
    new chat.Channel('memes'),
    new chat.Channel('nsfw', 'nsfw')
];

new_channel.forEach(c => {
    cached_channels.set(c.id, c);
});


// Express initialization

let app = express();

app.engine('handlebars', hbs.engine);
app.set('view engine', 'handlebars');
app.use('/resources', express.static(__dirname + '/views/resources'));
app.use('/css', express.static(__dirname + '/views/css'));
app.use('/js', express.static(__dirname + '/views/js'));


// Webserver initialization

let server = http.Server(app);


// Socket.io initialization

let io = socket(server);
module.exports = io;


// Socket.io responses

/*
 * Planned Emittable Event types:
 *
 * Message
 * System (Banner in chat)
 * User Join/Leave
 * Alert (shows a client popup)
 */

io.on('connection', (sock) => {
    console.log('User connected. SocketID ' + sock.id + ', IP ' + sock.handshake.address);

    sock.on('login', data => {
        if(cached_users.has(data) && cached_users.get(data).banned == 'none'){
            sock.user = cached_users.get(data);
    
            sock.emit('system', '<b>Welcome to the chat!</b><br>The server time is ' + new Date() + '.<br>Use <b>/help</b> in chat to see a list of chat commands.');
            setTimeout(() => io.emit('system', randoms.joins[Math.round(Math.random() * (randoms.joins.length - 1))].replace(/%username%/g, `<b style="color: ${sock.user.color}">${sock.user.name}</b>`)), 500); // Give the client time to parse the old messages
        }
        else sock.emit('alert', ['Your login failed.', 'That\'s all we know.']);
    });


    sock.on('disconnect', () => {
        
        if(sock.user && cached_users.has(sock.user.token)){
            io.emit('typing', {
                state: false,
                data: sock.user.safeUser()
            });
            io.emit('system', randoms.leaves[Math.round(Math.random() * (randoms.leaves.length - 1))].replace(/%username%/g, `<b>${sock.user.name}</b>`));
        } 
    });

    sock.on('typing', state => {
        if(sock.user &&sock.user.banned == 'none' && sock.user.typing != state){
            sock.user.typing = state;
            io.emit('typing', {
                state,
                data: sock.user.safeUser()
            });
        }
    });

    sock.on('message', message => {

        if(sock.user && cached_users.has(sock.user.token) && cached_users.get(sock.user.token)){
    
            let user = cached_users.get(sock.user.token);
            if(user.banned.status) sock.emit('alert', [
                user.banned.executor.name + ' banned you from the chatroom.', 
                 user.banned.reason
            ]);
            else if(message.content == '' || !message.content.match(/([^ ])/g)) sock.emit('alert', [
                'Your message is too short.', 
                'Please don\'t send empty messages.'
            ]);
            else if(message.content.length > 2000) sock.emit('alert', [
                'Your message is too long.', 
                'Your message must be less than 2000 characters.'
            ]);
            else {
                let safeUser = Object.assign({}, sock.user);
        
                delete safeUser.token;
                delete safeUser.lastSocket;
                delete safeUser.signUpAddress;
                let msg = new chat.Message(message.content, safeUser, message.channel);

                // Preparation for chat commands
                /*
                 * Implemented Commands:
                 * /system <message>: Sends a join/leave-like message banner
                 * /color <user> <color>: Applies the given color to the given user.
                 *
                 * Planned commands:
                 * /eval <code>: Evals JavaScript code from the chat
                 * /ban <user> <reason>: Bans the given user for the given reason.
                 * 
                 */
                if(msg.content.startsWith('/')) {
                    let invoke = msg.content.substr(1).split(' ')[0];
                    let args = msg.content.substr(1).split(' ');
                    args.shift();
                    switch(invoke){
                        case('help'):
                            sock.emit('system', 'Available commands: help, system, color, ban');
                            break;
                        case('system'): 
                            if(user.perms.announce || user.perms.admin) io.emit('system', msg.content.replace('/system ', ''));
                            else sock.emit('system', 'To do that, you need to be an <b>admin</b> or <b>announcer</b>.');
                            break;
                            case('color'): 
                                if(user.perms.channels || user.perms.admin){
                                    let target = cached_users.filter(u => u.id == args[0]);
                                    if(target){
                                        target.prop('color', args[1]);
                                        io.emit('system', `${target.name} has been assigned the color <span style="color: ${args[1]}">${args[1]}</span> by ${msg.author.name}`);
                                    }
                                    else sock.emit('system', 'Please give a valid user ID.');
                                }
                                else sock.emit('system', 'To do that, you need to be an <b>admin</b> or <b>channel manager</b>.');
                                break;
                            case('ban'): 
                                if(user.perms.ban || user.perms.admin){
                                    let target = cached_users.filter(u => u.id == args[0]);
                                    if(target){
                                        args.shift();
                                        target.ban(args.join(' '), user);
                                        io.emit('system', `${target.name} has been banned by ${msg.author.name}. Reason: ${args.join(' ')}`);
                                    }
                                    else sock.emit('system', 'Please give a valid user ID.');
                                }
                                else sock.emit('system', 'To do that, you need to be an <b>admin</b> or <b>channel manager</b>.');
                                break;
                        default:
                            sock.emit('system', 'Not a valid command.');
                            break;
                    }
                }

                else {
                    if(!cached_channels.get(message.channel)){
                        message.channel = cached_channels.find(f=>f.name=='general');
                        sock.emit('alert', ['Your message was delivered to an invalid channel.', 'It will be delivered to #general.'])
                    }
                    cached_channels.get(message.channel).messages.push(msg);
                    if(cached_channels.get(message.channel).messages.length > 50) cached_channels.get(message.channel).messages.shift();
                    io.emit('message', msg);
                }
            }
        }
        else{
            sock.emit('alert', ['You\'re not logged in.', 'That\'s all we know.']);
        }
    });

});


// Express response for main page

require('./routes.js')(app);


// listen

server.listen(config.port, () => {
    console.log('Webserver listening on port ' + config.port);
});
}
catch(err){
    console.log('Thank you has-binary2 for causing this nice little error which forced me to use the legendary try-catch around the entire code: ' + err);
}