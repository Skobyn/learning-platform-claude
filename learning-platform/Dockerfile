# Minimal Dockerfile for Express.js deployment
FROM node:18-alpine

WORKDIR /app

# Install Express.js
RUN npm init -y && npm install express

# Copy the minimal app
COPY minimal-app.js .

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

# Start the application
CMD ["node", "minimal-app.js"]