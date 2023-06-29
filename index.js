const app = require('express')();
const http = require('http').Server(app);
const io = require('socket.io')(http);
const port = process.env.PORT || 3000;
const ping = require('ping');
const fs = require('fs');

let logs = logsList();
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});
app.get('/:filename', (req, res) => {
  if (logs.indexOf(req.params.filename) >= 0)
    res.download(`${__dirname}/logs/${req.params.filename}`);
  else {
    console.error(`bad path sent ${req.params.filename}`);
    res.status(404).send({error: 'no log file here ¯\\_(ツ)_/¯'});
  }
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
  const days = timestampDays(timestamps);
  days.forEach(day => {
    const dayKeys = [...timestamps.keys()].filter(value => value.toISOString().slice(0, 10) === day);
    let output = '';
    dayKeys.forEach(timestamp => {
      output = output.concat(`\n${timestamp.toISOString()} : ${timestamps.get(timestamp)}`);
    });
    const filename = `logs/${host}-${day}.log`;
    fs.appendFile(filename, output, err => {
      if (err) console.log("writing error")
    });
  });
  pingCache.get(host).clear();
  if (days.size > 0) updateFileListAndEmit();
}

function updateFileListAndEmit() {
  logs = logsList();
  io.emit('files', logs);
}


function timestampDays(timestamps) {
  // DIDN'T WORK TESTING NOW
  return new Set([...timestamps.keys()].map(value => value.toISOString().slice(0, 10)));
}


function logsList() {
  const files = fs.readdirSync(`${__dirname}/logs/`);
  console.log(files);
  return files;
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
  hosts.forEach(host => writeToFile(host));
}

if (usersCount) startPolling();
io.on('connection', (socket) => {
  usersCount++;
  console.log('user connected');
  socket.emit('hosts', hosts);
  socket.emit('files', logs);
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
process.on('exit', function () {
  console.log('About to exit.');
  hosts.forEach(host => writeToFile(host));
});
