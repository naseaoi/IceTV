FROM node:22-alpine

RUN apk add --no-cache docker-cli docker-cli-compose
WORKDIR /app
COPY logic.js docker.js service.js server.js ./
USER root
EXPOSE 9330
CMD ["node", "server.js"]
