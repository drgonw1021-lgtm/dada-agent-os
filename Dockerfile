FROM node:22-slim

WORKDIR /usr/src/app

# Install only production deps first for layer caching
COPY package.json ./
RUN npm install

# Copy source and build
COPY . .
RUN npm run build

# Remove devDependencies after build to keep image lean
RUN npm prune --omit=dev

ENV PORT=9877
EXPOSE 9877

CMD ["node", "dist/server.js"]
