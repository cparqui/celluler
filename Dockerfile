FROM node:20-slim

# Install build tools and dependencies for native modules
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    git \
    && rm -rf /var/lib/apt/lists/*

# Create app directory and non-root user
WORKDIR /app
RUN mkdir -p /app /data /var/log/cell \
    && chown -R node:node /app /data /var/log/cell

# Install dependencies
COPY package*.json ./
RUN npm install

# Copy source code
COPY . .

# Switch to non-root user
USER node

# Expose ports
EXPOSE 3000

# Start the application
CMD ["node", "src/cli.js", "start", "-c", "config/docker.config.yaml"] 