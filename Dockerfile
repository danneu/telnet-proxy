FROM node:24-alpine

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install dependencies (including dev deps for build)
RUN pnpm install --frozen-lockfile

# Copy source code
COPY src ./src
COPY bin ./bin
COPY tsconfig.json ./

# Build the project
RUN pnpm run build

# Remove dev dependencies
RUN pnpm prune --prod

# Expose port
EXPOSE 8080

# Start the application
CMD ["npm", "run", "start"]