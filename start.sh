#!/bin/sh
set -e

echo "Generating Prisma Client..."
npx prisma generate || echo "Prisma generate failed, continuing..."

echo "Running Prisma DB Push..."
npx prisma db push --accept-data-loss --skip-generate || echo "DB Push failed, continuing..."

echo "Starting server..."
node server.js
