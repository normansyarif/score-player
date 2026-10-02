FROM node:18-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
COPY redist/osmd-1.7.1.tgz redist/osmd-1.7.1.tgz
RUN npm ci --legacy-peer-deps

COPY angular.json tsconfig*.json postcss.config.js tailwind.config.js ./
COPY src ./src
RUN npm run build

FROM nginx:stable-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/www /usr/share/nginx/html
EXPOSE 80
