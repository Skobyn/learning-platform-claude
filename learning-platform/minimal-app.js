// Minimal Express.js application for quick deployment
const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

// Middleware for JSON parsing
app.use(express.json());

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'learning-platform',
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development'
  });
});

// Home page
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Learning Platform - Live on GCP</title>
        <style>
            body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                margin: 0;
                padding: 0;
                min-height: 100vh;
                display: flex;
                align-items: center;
                justify-content: center;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
            }
            .container {
                text-align: center;
                padding: 2rem;
                max-width: 800px;
                background: rgba(255, 255, 255, 0.1);
                border-radius: 20px;
                backdrop-filter: blur(10px);
                box-shadow: 0 25px 45px rgba(0, 0, 0, 0.1);
            }
            h1 {
                font-size: 3rem;
                margin-bottom: 1rem;
                text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.3);
            }
            .subtitle {
                font-size: 1.2rem;
                margin-bottom: 2rem;
                opacity: 0.9;
            }
            .status {
                background: rgba(34, 197, 94, 0.2);
                border: 2px solid rgba(34, 197, 94, 0.5);
                border-radius: 10px;
                padding: 1rem;
                margin: 2rem 0;
                font-size: 1.1rem;
            }
            .features {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                gap: 1rem;
                margin-top: 2rem;
            }
            .feature {
                background: rgba(255, 255, 255, 0.1);
                padding: 1rem;
                border-radius: 10px;
                border: 1px solid rgba(255, 255, 255, 0.2);
            }
            .footer {
                margin-top: 2rem;
                font-size: 0.9rem;
                opacity: 0.7;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>🎓 Learning Platform</h1>
            <p class="subtitle">Enterprise Learning Management System</p>

            <div class="status">
                🎉 Successfully deployed to Google Cloud Platform!
                <br><br>
                <strong>Status:</strong> <span style="color: #22c55e;">Live</span> |
                <strong>Environment:</strong> Production |
                <strong>Region:</strong> us-central1
            </div>

            <div class="features">
                <div class="feature">
                    <h3>☁️ Cloud Run</h3>
                    <p>Serverless container platform</p>
                </div>
                <div class="feature">
                    <h3>🔒 Secure</h3>
                    <p>Enterprise-grade security</p>
                </div>
                <div class="feature">
                    <h3>📈 Scalable</h3>
                    <p>Auto-scaling infrastructure</p>
                </div>
                <div class="feature">
                    <h3>⚡ Fast</h3>
                    <p>Optimized performance</p>
                </div>
            </div>

            <div class="footer">
                <p>Deployed on ${new Date().toLocaleString()}</p>
                <p><a href="/api/health" style="color: #60a5fa;">Health Check</a></p>
            </div>
        </div>
    </body>
    </html>
  `);
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// Start the server
app.listen(port, '0.0.0.0', () => {
  console.log(`Learning Platform is running on port ${port}`);
  console.log(`Health check available at: http://localhost:${port}/api/health`);
});

module.exports = app;