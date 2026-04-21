const http = require('http');
const fs = require('fs');
const path = require('path');
const {spawn} = require('child_process');

const port = Number(process.env.PORT || 3000);
const hosts = process.env.HOSTS ? process.env.HOSTS.split(',').map(h => h.trim()).filter(Boolean) : ['8.8.8.8'];
const pollingRate = Number(process.env.POLL_RATE || 5) * 1000;
const minUserCount = process.env.ALWAYS_ON === 'true' ? 1 : 0;
const uncompressedLogDays = Number(process.env.UNCOMPRESSED_LOG_DAYS || 0);
const logsPath = path.join(__dirname, 'logs');
const logArchiveFileName = 'logs.zip';
const intervalMap = new Map();
const pingCache = new Map();
const eventClients = new Set();

let logs = [];
let usersCount = minUserCount;
let stats = [];

ensureLogsDir();
hosts.forEach(host => pingCache.set(host, new Map()));
logs = logsList();
loadCache();
stats = calculateStats();
scheduleHourly(() => {
  console.log('Purge cache of data older than 12 hours and calculate statistics');
  clearOldPingData();
  stats = calculateStats();
  emitEvent('statistics', stats);
  emitEvent('historicalData', cacheToGraphData());
});
scheduleDaily(2, 0, archiveOldLogs);
if (usersCount) startPolling();

const server = http.createServer((req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(requestUrl.pathname);

  if (pathname === '/') return sendFile(res, path.join(__dirname, 'index.html'), 'text/html; charset=utf-8');
  if (pathname === '/health') return sendText(res, 200, '');
  if (pathname === '/events') return openEventStream(req, res);
  if (pathname === '/api/hosts') return sendJson(res, hosts);
  if (pathname === '/api/logs') return sendJson(res, logsList());
  if (pathname === '/api/history') return sendJson(res, cacheToGraphData());
  if (pathname === '/api/statistics') {
    stats = calculateStats();
    return sendJson(res, stats);
  }
  if (pathname === '/template.js') return sendFile(res, path.join(__dirname, 'template.js'), 'application/javascript; charset=utf-8');
  if (pathname === '/favicon.ico') return sendFile(res, path.join(__dirname, 'favicon.ico'), 'image/x-icon');
  if (pathname === '/public/plotly-basic.min.js') {
    return sendFile(res, path.join(__dirname, 'public', 'plotly-basic.min.js'), 'application/javascript; charset=utf-8');
  }
  if (pathname.startsWith('/logs/')) return sendLogFile(res, pathname.slice('/logs/'.length));
  return sendJson(res, {error: 'not found'}, 404);
});

server.listen(port, () => {
  console.log(`Connection monitor running at http://localhost:${port}/`);
});

function sendText(res, statusCode, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(statusCode, {'Content-Type': contentType});
  res.end(body);
}

function sendJson(res, body, statusCode = 200) {
  res.writeHead(statusCode, {'Content-Type': 'application/json; charset=utf-8'});
  res.end(JSON.stringify(body));
}

function sendFile(res, filePath, contentType) {
  fs.readFile(filePath, (err, data) => {
    if (err) return sendJson(res, {error: 'not found'}, 404);
    res.writeHead(200, {'Content-Type': contentType});
    res.end(data);
  });
}

function sendLogFile(res, filename) {
  if (!logs.includes(filename)) {
    console.error(`bad path sent ${filename}`);
    return sendJson(res, {error: 'no log file here'}, 404);
  }

  const filePath = safeLogPath(filename);
  if (!filePath) return sendJson(res, {error: 'bad log path'}, 400);

  res.writeHead(200, {
    'Content-Type': filename.endsWith('.zip') ? 'application/zip' : 'text/plain; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename.replace(/"/g, '')}"`
  });
  fs.createReadStream(filePath)
    .on('error', () => sendJson(res, {error: 'not found'}, 404))
    .pipe(res);
}

function openEventStream(req, res) {
  usersCount++;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.write(': connected\n\n');
  eventClients.add(res);
  sendEvent(res, 'hosts', hosts);
  sendEvent(res, 'files', logs);
  sendEvent(res, 'historicalData', cacheToGraphData());
  stats = calculateStats();
  sendEvent(res, 'statistics', stats);
  if (usersCount === 1) startPolling();

  req.on('close', () => {
    eventClients.delete(res);
    usersCount--;
    if (usersCount === 0) stopPolling();
  });
}

function sendEvent(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function emitEvent(event, data) {
  for (const client of eventClients) sendEvent(client, event, data);
}

function ensureLogsDir() {
  fs.mkdirSync(logsPath, {recursive: true});
}

function calculateStats() {
  console.log('Calculating stats');
  return hosts.map(host => {
    const pings = Array.from(pingCache.get(host).values());
    const successful = pings.filter(ping => ping > 0);
    const avg = successful.length ? successful.reduce((sum, ping) => sum + ping, 0) / successful.length : 0;
    const stdDev = successful.length
      ? Math.sqrt(successful.reduce((sum, ping) => sum + (ping - avg) ** 2, 0) / successful.length)
      : 0;
    const overHundred = successful.filter(ping => ping >= 100).length;
    const overThousand = successful.filter(ping => ping >= 1000).length;
    const zeroesCount = pings.length - successful.length;
    return [host, avg, stdDev, overHundred, overThousand, zeroesCount];
  });
}

function clearOldPingData() {
  const cutoffDate = new Date(Date.now() - (12 * 60 * 60 * 1000));
  hosts.forEach(host => pingCache.set(host, filterDates(pingCache.get(host), cutoffDate)));
}

function filterDates(map, date) {
  return new Map([...map].filter(value => value[0].getTime() > date.getTime()));
}

function loadCache() {
  const day = new Date().toISOString().slice(0, 10);
  hosts.forEach(host => {
    const list = readFileToList(path.join(logsPath, `${host}-${day}.log`));
    list.forEach(value => pingCache.get(host).set(value[0], value[1]));
  });
}

function cacheToGraphData() {
  return hosts.map(host => [...pingCache.get(host)]);
}

function writeToFile(host, timestamp, ping) {
  const dayString = timestamp.toISOString().slice(0, 10);
  const filename = `${host}-${dayString}.log`;
  const filePath = safeLogPath(filename);
  if (!filePath) return console.error(`Refusing unsafe log filename ${filename}`);

  const newDay = !fs.existsSync(filePath);
  fs.appendFile(filePath, `\n${timestamp.toISOString()} | ${ping}`, err => {
    if (err) console.log('writing error', err.message);
  });
  if (newDay) updateFileListAndEmit();
}

function readFileToList(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8')
    .split('\n')
    .filter(line => line.length > 0)
    .map(line => [new Date(line.substring(0, 24)), parseInt(line.substring(27), 10)])
    .filter(pair => !Number.isNaN(pair[1]) && !Number.isNaN(pair[0].getTime())) : [];
}

function updateFileListAndEmit() {
  logs = logsList();
  emitEvent('files', logs);
}

function logsList() {
  ensureLogsDir();
  return fs.readdirSync(logsPath)
    .filter(filename => fs.statSync(path.join(logsPath, filename)).isFile())
    .sort();
}

function startPolling() {
  hosts.forEach(host => {
    if (intervalMap.has(host)) return;
    console.log(`Start polling host ${host}`);
    intervalMap.set(host, setInterval(() => pollHost(host), pollingRate));
    pollHost(host);
  });
}

function stopPolling() {
  intervalMap.forEach((value, key) => {
    console.log(`stop polling: ${key}`);
    clearInterval(value);
  });
  intervalMap.clear();
}

function pollHost(host) {
  pingHost(host).then(ping => {
    const time = new Date();
    emitEvent('ping', {host, time: time.toISOString(), ping});
    pingCache.get(host).set(time, ping);
    writeToFile(host, time, ping);
  }).catch(err => {
    console.error(`ping failed for ${host}: ${err.message}`);
    const time = new Date();
    emitEvent('ping', {host, time: time.toISOString(), ping: 0});
    pingCache.get(host).set(time, 0);
    writeToFile(host, time, 0);
  });
}

function pingHost(host) {
  const args = process.platform === 'win32' ? ['-n', '1', '-w', '1000', host] : ['-c', '1', '-W', '1', host];
  return new Promise((resolve, reject) => {
    const child = spawn('ping', args);
    let output = '';
    child.stdout.on('data', chunk => output += chunk);
    child.stderr.on('data', chunk => output += chunk);
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) return resolve(0);
      resolve(parsePingTime(output));
    });
  });
}

function parsePingTime(output) {
  const match = output.match(/time[=<]([0-9.]+)\s*ms/i);
  return match ? Number(match[1]) : 0;
}

function archiveOldLogs() {
  console.log('Starting archive job');
  logs = logsList();
  const cutoffDate = new Date(new Date().toISOString().slice(0, 10));
  cutoffDate.setDate(cutoffDate.getDate() - uncompressedLogDays);
  const logsToArchive = logs.filter(filename => filename !== logArchiveFileName && cutoffDate > logDate(filename));
  if (logsToArchive.length) zipLogs(logsToArchive);
}

function logDate(filename) {
  const match = filename.match(/(\d{4}-\d{2}-\d{2})\.log$/);
  return match ? new Date(match[1]) : new Date(NaN);
}

function zipLogs(fileList) {
  const archivePath = safeLogPath(logArchiveFileName);
  const absoluteFiles = fileList.map(safeLogPath);
  if (!archivePath || absoluteFiles.some(filePath => !filePath)) {
    return console.error('Refusing to archive unsafe log path');
  }

  console.log(`Adding ${fileList.length} logs to ${logArchiveFileName}`);
  const child = spawn('zip', ['-j', archivePath, ...absoluteFiles], {stdio: 'inherit'});
  child.on('error', err => console.error(`zip failed: ${err.message}`));
  child.on('close', code => {
    if (code !== 0) return console.error(`zip exited with status ${code}`);
    deleteArchivedFiles(fileList);
  });
}

function deleteArchivedFiles(fileList) {
  fileList.forEach(filename => {
    const filePath = safeLogPath(filename);
    if (!filePath) return;
    fs.rm(filePath, err => {
      if (err) return console.error(err.message);
      console.log(`Archived log deleted: ${filename}`);
      updateFileListAndEmit();
    });
  });
}

function safeLogPath(filename) {
  const resolved = path.resolve(logsPath, filename);
  return resolved.startsWith(path.resolve(logsPath) + path.sep) ? resolved : null;
}

function scheduleHourly(callback) {
  setInterval(callback, 60 * 60 * 1000);
}

function scheduleDaily(hour, minute, callback) {
  const scheduleNext = () => {
    const now = new Date();
    const next = new Date(now);
    next.setHours(hour, minute, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    setTimeout(() => {
      callback();
      scheduleNext();
    }, next.getTime() - now.getTime());
  };
  scheduleNext();
}
