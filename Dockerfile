FROM node:16-alpine

# Create app directory
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm ci
COPY . .
EXPOSE 3000

HEALTHCHECK --interval=5s --timeout=3s CMD wget localhost:3000/health -q -O - > /dev/null 2>&1
CMD [ "node", "index.js" ]
