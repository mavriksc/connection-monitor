# connection-monitor

Runs pings at specified interval against list of hosts and logs the results
0 = failed 
Environment:
HOSTS: 8.8.8.8,google.com,amazon.com #Coma separated list of hosts to ping
POLL_RATE: 5 # in seconds
ALWAYS_ON: true #true : polling runs all the time false: polling only runs when user has UI open
UNCOMPRESSED_LOG_DAYS: 0 #logs created yesterday or before are archived. 1 keeps yesterday's logs uncompressed...

Run  `npm start`

build for deploy `npm ci`


Create image 
docker `build . -t smcarlisle/connection-monitor:{version}`
