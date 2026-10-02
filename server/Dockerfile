FROM node:20-bookworm-slim

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY index.js ./

ENV PORT=3000 UPLOAD_DIR=/app/uploads
EXPOSE 3000
CMD ["npm", "start"]
