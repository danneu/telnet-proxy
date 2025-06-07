FROM node:24-alpine

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install dependencies
RUN pnpm install --frozen-lockfile --prod

# Copy source code
COPY src ./src
COPY bin ./bin

# Expose port
EXPOSE 8080

# Start the application
CMD ["npm", "run", "start"]