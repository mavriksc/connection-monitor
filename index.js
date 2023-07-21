const app = require('express')();
const http = require('http').Server(app);
const io = require('socket.io')(http);
const port = process.env.PORT || 3000;
const ping = require('ping');
const fs = require('fs');
const JSZip = require('jszip');
const cron = require('node-cron');


const hosts = process.env.HOSTS ? process.env.HOSTS.split(',') : ['8.8.8.8'];
const pollingRate = (process.env.POLL_RATE ? process.env.POLL_RATE : 5) * 1000;
const minUserCount = process.env.ALWAYS_ON === 'true' ? 1 : 0;
const uncompressedLogDays = process.env.UNCOMPRESSED_LOG_DAYS ? process.env.UNCOMPRESSED_LOG_DAYS : 0;
const logsPath = `${__dirname}/logs/`;
const logArchiveFileName = 'logs.zip';
const intervalMap = new Map();
const pingCache = new Map();

let logs = logsList();
hosts.forEach(h => pingCache.set(h, new Map()));
let usersCount = minUserCount;

if (usersCount) startPolling();

io.on('connection', (socket) => {
  usersCount++;
  console.log('user connected');
  hosts.forEach(host => writeToFile(host));
  socket.emit('hosts', hosts);
  socket.emit('files', logs);
  socket.emit('historicalData', getTodaysLoggedData())
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
  hosts.forEach(host => writeToFile(host));
});

cron.schedule('0 2 * * *', () => {
  archiveOldLogs();
});

function getTodaysLoggedData() {
  const day = new Date().toISOString().slice(0, 10);
  return hosts.map(host => readFileToList(`${logsPath}${host}-${day}.log`));
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

    if (zip.file(filename)===null)
      zip.file(filename, fs.createReadStream(`${logsPath}${filename}`));
    else{
      console.log(`File ${filename} already exists in log archive`);
      zip.remove(filename);
      zip.file(filename, fs.createReadStream(`${logsPath}${filename}`));
    }
  });
}

function saveZip(zip, fileList) {
  zip.generateNodeStream({type: 'nodebuffer', streamFiles: true})
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

function writeToFile(host) {
  console.log(`outputting to file for host:${host}`);
  const timestamps = new Map([...pingCache.get(host)]
    .sort((a, b) => a[0].getTime() - b[0].getTime()));
  const days = timestampDays(timestamps);
  days.forEach(day => {
    const dayKeys = [...timestamps.keys()].filter(value => value.toISOString().slice(0, 10) === day);
    let output = '';
    dayKeys.forEach(timestamp => {
      output = output.concat(`\n${timestamp.toISOString()} | ${timestamps.get(timestamp)}`);
    });
    const filename = `logs/${host}-${day}.log`;
    fs.appendFile(filename, output, err => {
      if (err) console.log("writing error")
    });
  });
  pingCache.get(host).clear();
  updateFileListAndEmit();
}

function readFileToList(file) {
  return fs.readFileSync(file, 'utf8')
    .split('\n')
    .filter(l => l.length > 0)
    .map(l => [new Date(l.substring(0, 24)), parseInt(l.substring(27))]);
}

function updateFileListAndEmit() {
  logs = logsList();
  if (usersCount > minUserCount) io.emit('files', logs);
}

function timestampDays(timestamps) {
  return new Set([...timestamps.keys()].map(value => value.toISOString().slice(0, 10)));
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

