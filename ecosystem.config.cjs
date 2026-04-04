// ecosystem.config.cjs
// PM2 process definition for tax-assistant Express server
// Usage:
//   Production start:  pm2 start ecosystem.config.cjs --env production
//   Check status:      pm2 status
//   View logs:         pm2 logs tax-assistant-api
//   Restart:           pm2 restart tax-assistant-api

module.exports = {
  apps: [
    {
      name: 'tax-assistant-api',
      script: 'server/index.ts',
      interpreter: 'tsx',         // tsx handles TypeScript execution directly
      env_production: {
        NODE_ENV: 'production',
        PORT: 4001,
        // GEMINI_API_KEY must be set in the server's .env file — NOT here
      },
      // Auto-restart on crash with exponential backoff
      watch: false,               // disable in production (watch is for dev)
      max_memory_restart: '256M', // restart if memory exceeds 256MB
      error_file: 'logs/pm2-error.log',
      out_file: 'logs/pm2-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
