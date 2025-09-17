# Use pre-built base with Next.js
FROM node:18

WORKDIR /app

# Copy only essential files
COPY package*.json ./
COPY .env ./
COPY .next ./.next
COPY public ./public
COPY node_modules ./node_modules
COPY prisma ./prisma

# Set production environment
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# Start Next.js in production mode
CMD ["npm", "start"]