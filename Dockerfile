FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

RUN mkdir -p public/uploads/servers data

EXPOSE 3000

CMD ["node", "server.js"]
