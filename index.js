const app = require('express')();
const http = require('http').Server(app);
const io = require('socket.io')(http);
const port = process.env.PORT || 3000;
const ping = require('ping');

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

const hosts = ['8.8.8.8', 'google.com', 'amazon.com'];//
const intervalMap = new Map();
let usersCount = 0;

function startPolling() {
  hosts.forEach(function (host) {
    console.log('Start polling host ' + host);
    intervalMap.set(host, setInterval(function () {
      ping.promise.probe(host).then(function (res) {
        io.emit(res.inputHost, res.time)
      });
    }, 1000));
  });
}

function stopPolling() {
  intervalMap.forEach( (value, key) => {
    console.log('stop polling: ' + key);
    clearInterval(value);
  });
}

io.on('connection', (socket) => {
  usersCount++;
  console.log('user connected');
  io.emit('hosts', hosts);
  if (usersCount === 1) startPolling();
  socket.on('disconnect', () => {
    console.log('user disconnected');
    usersCount--;
    if (usersCount === 0) stopPolling();
  });
});

http.listen(port, () => {
  console.log(`Socket.IO server running at http://localhost:${port}/`);
});
