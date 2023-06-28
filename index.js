const app = require('express')();
const http = require('http').Server(app);
const io = require('socket.io')(http);
const port = process.env.PORT || 3000;
const ping = require('ping');
const fs = require('fs');

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});


const hosts = process.env.HOSTS ? process.env.HOSTS.split(',') : ['8.8.8.8'];
const pollingRate = (process.env.POLL_RATE ? process.env.POLL_RATE : 5) * 1000;
const minUserCount = process.env.ALWAYS_ON === 'true' ? 1 : 0;
const intervalMap = new Map();
const pingCache = new Map();
hosts.forEach(h => pingCache.set(h, new Map()));
let usersCount = minUserCount;

function writeToFile(host) {
  console.log(`outputting to file for host:${host}`);
  const timestamps = new Map([...pingCache.get(host)]
    .sort((a, b) => a[0].getTime() - b[0].getTime()));
  let output = '';
  timestamps.forEach((value, key) =>
    output = output.concat(`\n${key.toISOString()} : ${value}`));
  const date = new Date().toISOString().slice(0, 10);
  const filename = `logs/${host}-${date}.log`;
  fs.appendFile(filename, output, err => {
    if (err) console.log("writing error")
  });
  pingCache.get(host).clear();
}

function startPolling() {
  hosts.forEach(function (host) {
      console.log('Start polling host ' + host);
      intervalMap.set(host, setInterval(function () {
          ping.promise.probe(host).then(function (res) {
            const time = new Date();
            const ping = res.alive ? res.time : 0;
            if (usersCount > minUserCount) {
              const resJson = '{"time":"' + time + '","ping":' + ping + '}';
              io.emit(res.inputHost, resJson);
            }
            pingCache.get(host).set(time, ping);
            if (pingCache.get(host).size > 99) {
              writeToFile(host);
            }
          });
        }, pollingRate)
      );
    }
  );
}

function stopPolling() {
  intervalMap.forEach((value, key) => {
    console.log('stop polling: ' + key);
    clearInterval(value);
  });
}

if (usersCount) startPolling();
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
