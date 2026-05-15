FROM node:18-alpine

WORKDIR /app

# Install OpenSSL for Prisma
RUN apk add --no-cache openssl

# Install dependencies
COPY package*.json ./
RUN npm install

# Copy application
COPY . .

# Generate Prisma client
RUN npx prisma generate

# Expose port
EXPOSE 8000

# Start application
CMD ["npm", "start"]
