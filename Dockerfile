FROM node:22.22.3-alpine

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN chown -R node:node /app
USER node

ENTRYPOINT ["npm", "run", "start", "--"]
