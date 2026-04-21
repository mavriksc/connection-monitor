# connection-monitor

Lightweight connection monitor that pings configured hosts, logs the results, and serves a live browser graph.

`0ms` means the ping failed or timed out.

## Run with Docker

```powershell
docker compose up --build
```

Open <http://localhost:3000/>.

Logs are written to `./docker-logs` through the Compose volume.

## Environment

Configure these values in `docker-compose.yml` or as container environment variables:

- `HOSTS`: comma-separated hosts to ping. Example: `8.8.8.8,google.com,amazon.com`
- `POLL_RATE`: polling interval in seconds. Default: `5`
- `ALWAYS_ON`: `true` keeps polling even when the UI is closed; `false` polls only while a browser is connected. Default: `false`
- `UNCOMPRESSED_LOG_DAYS`: number of prior days to keep as loose `.log` files before archiving. Default: `0`
- `PORT`: HTTP port inside the container. Default: `3000`

## Local Run

No npm dependencies are required.

Prerequisites:

- Node.js
- `ping` available on `PATH`
- `zip` available on `PATH` for log archival

```powershell
node index.js
```

## HTTP Endpoints

- `/`: browser UI
- `/health`: container health check
- `/events`: Server-Sent Events stream for live updates
- `/api/hosts`: configured hosts
- `/api/logs`: available log files
- `/api/history`: in-memory history loaded from today's logs
- `/api/statistics`: current statistics
- `/logs/<filename>`: safe log download route

## Archiving

At 2:00 AM, logs older than `UNCOMPRESSED_LOG_DAYS` are added to `logs.zip` with the system `zip` command. Source log files are deleted only after `zip` exits successfully.
