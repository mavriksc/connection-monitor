const app = require('express')();
const http = require('http').Server(app);
const io = require('socket.io')(http);
const ping = require('ping');
const fs = require('fs');
const JSZip = require('jszip');
const cron = require('node-cron');


const port = process.env.PORT || 3000;
const hosts = process.env.HOSTS ? process.env.HOSTS.split(',') : ['8.8.8.8'];
const pollingRate = (process.env.POLL_RATE ? process.env.POLL_RATE : 5) * 1000;
const minUserCount = process.env.ALWAYS_ON === 'true' ? 1 : 0;
const uncompressedLogDays = process.env.UNCOMPRESSED_LOG_DAYS ? process.env.UNCOMPRESSED_LOG_DAYS : 0;
const logsPath = `${__dirname}/logs/`;
const logArchiveFileName = 'logs.zip';
const intervalMap = new Map();
const pingCache = new Map();

let logs = logsList();
let usersCount = minUserCount;
hosts.forEach(h => pingCache.set(h, new Map()));
loadCache();

if (usersCount) startPolling();
io.on('connection', (socket) => {
  usersCount++;
  console.log('user connected');
  socket.emit('hosts', hosts);
  socket.emit('files', logs);
  socket.emit('historicalData', getTodaysLoggedData());
  socket.emit('statistics', calculateStats());
  if (usersCount === 1) startPolling();
  socket.on('disconnect', () => {
    console.log('user disconnected');
    usersCount--;
    if (usersCount === 0) stopPolling();
  });
});

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});
app.get('/health', (req, res) => {
  res.status(200).send();
});
app.get('/template.js', (req, res) => {
  res.sendFile(__dirname + '/template.js');

});app.get('/favicon.ico', (req, res) => {
  res.sendFile(__dirname + '/favicon.ico');
});

app.get('/:filename', (req, res) => {
  if (logs.indexOf(req.params.filename) >= 0)
    res.download(`${logsPath}${req.params.filename}`);
  else {
    console.error(`bad path sent ${req.params.filename}`);
    res.status(404).send({error: 'no log file here ¯\\_(ツ)_/¯'});
  }
});

http.listen(port, () => {
  console.log(`Socket.IO server running at http://localhost:${port}/`);
});

process.on('exit', function () {
  console.log('About to exit.');
});

cron.schedule('0 2 * * *', () => {
  archiveOldLogs();
});

cron.schedule('0 * * * *', () => {
  console.log('12 hour sweep.')
  clearOldPingData();
  if (usersCount > minUserCount) io.emit(calculateStats());
});

function calculateStats() {
  console.log('Calculating stats');
  return hosts.map(host => {
    const pings = Array.from(pingCache.get(host).values());
    let avg = 0;
    let stdDev;
    let overHundred = 0;
    let overThousand = 0;
    let zeroesCount = 0;
    pings.forEach(ping => {
      if (ping > 0) {
        avg += ping;
        if (ping >= 100) overHundred++
        if (ping >= 1000) overThousand++
      } else zeroesCount++
    });
    avg = avg / (pings.length - zeroesCount);
    stdDev = Math.sqrt(pings.filter(p => p > 0).reduce((partialSum, p) => partialSum + (p - avg) ** 2, 0) / (pings.length - zeroesCount));
    return [host, avg, stdDev, overHundred, overThousand, zeroesCount]
  });
}

function clearOldPingData() {
  const cutoffDate = new Date();
  cutoffDate.setTime(cutoffDate.getTime() - (12 * 60 * 60 * 1000));
  hosts.forEach(host => {
    pingCache.set(host, filterDates(pingCache.get(host), cutoffDate));
  })
}

function filterDates(map, date) {
  return new Map([...map].filter(value => value[0].getTime() > date.getTime()));
}

function loadCache() {
  const day = new Date().toISOString().slice(0, 10);
  hosts.forEach(host => {
    let list = readFileToList(`${logsPath}${host}-${day}.log`);
    list.forEach(value => pingCache.get(host).set(value[0], value[1]));
  });
}

function getTodaysLoggedData() {
  return hosts.map(host => {
    return [...pingCache.get(host)];
  });
}

function writeToFile(host, timestamp, ping) {
  const dayString = timestamp.toISOString().slice(0, 10);
  const filename = `logs/${host}-${dayString}.log`;
  const newDay = !fs.existsSync(filename);
  const output = `\n${timestamp.toISOString()} | ${ping}`
  fs.appendFile(filename, output, err => {
    if (err) console.log("writing error")
  });
  if (newDay) updateFileListAndEmit();
}

function readFileToList(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8')
    .split('\n')
    .filter(l => l.length > 0)
    .map(l => [new Date(l.substring(0, 24)), parseInt(l.substring(27))]) : [];
}

function updateFileListAndEmit() {
  logs = logsList();
  if (usersCount > minUserCount) io.emit('files', logs);
}

function logsList() {
  return fs.readdirSync(logsPath);
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
            writeToFile(host, time, ping);
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

function archiveOldLogs() {
  console.log('Starting Archive cron job');
  let cutoffDate = new Date(new Date().toISOString().slice(0, 10));
  cutoffDate.setDate(cutoffDate.getDate() - uncompressedLogDays);
  const logsToArchive = logs.filter(s => cutoffDate > (new Date(s.slice(s.length - 14, s.length - 4))));
  if (logsToArchive.length) zipLogs(logsToArchive);
}

function zipLogs(fileList) {
  if (logs.indexOf(logArchiveFileName) >= 0) {
    //exists
    console.log('Archive exists')
    const zipData = fs.readFileSync(`${logsPath}${logArchiveFileName}`);
    JSZip.loadAsync(zipData).then(zip => zipLogsWork(zip, fileList));
  } else {
    console.log('Creating new archive')
    zipLogsWork(new JSZip(), fileList);
  }
}

function addFiles(zip, fileList) {
  fileList.forEach(filename => {
    console.log(`Adding ${filename} to the archive`)
    // need to check for file conflicts.
    // cat files that already exist
    // could maybe be smart and append new lines or something
    // but na blast current archived file and just add the one still in the dir

    if (zip.file(filename) === null)
      zip.file(filename, fs.createReadStream(`${logsPath}${filename}`));
    else {
      console.log(`File ${filename} already exists in log archive`);
      zip.remove(filename);
      zip.file(filename, fs.createReadStream(`${logsPath}${filename}`));
    }
  });
}

function saveZip(zip, fileList) {
  zip.generateNodeStream({type: 'nodebuffer', streamFiles: true, compression: 'DEFLATE'})
    .pipe(fs.createWriteStream(`${logsPath}${logArchiveFileName}`))
    .on('finish', function () {
      console.log(`${logsPath}${logArchiveFileName} written`);
      deleteArchivedFiles(fileList);
    });
}

function deleteArchivedFiles(fileList) {
  console.log(fileList);
  fileList.forEach(file => fs.rm(`${logsPath}${file}`, err => {
    if (err) {
      // File deletion failed
      console.error(err.message);
      return;
    }
    console.log("File deleted successfully");
    updateFileListAndEmit();
  }));
}

function zipLogsWork(zip, fileList) {
  addFiles(zip, fileList);
  saveZip(zip, fileList);
}
