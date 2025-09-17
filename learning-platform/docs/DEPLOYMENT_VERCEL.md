# Vercel Deployment Guide

## Prerequisites

1. **Vercel Account**: Sign up at [vercel.com](https://vercel.com)
2. **GitHub Repository**: Your code should be pushed to GitHub
3. **Database**: Set up a PostgreSQL database (recommended providers below)
4. **Redis**: Set up Redis for caching (optional but recommended)

## Recommended Services for Production

### Database Providers (PostgreSQL)
- **Supabase**: Free tier available, great for getting started
- **Neon**: Serverless PostgreSQL, scales to zero
- **PlanetScale**: MySQL-compatible, excellent scaling
- **Railway**: Simple PostgreSQL hosting

### Redis Providers
- **Upstash**: Serverless Redis, perfect for Vercel
- **Redis Cloud**: Fully managed Redis

### Email Providers
- **Resend**: Developer-friendly, great for transactional emails
- **SendGrid**: Reliable, extensive features
- **Postmark**: Focus on transactional emails

## Step-by-Step Deployment

### 1. Prepare Your Database

```bash
# Example with Supabase
# 1. Create a project at supabase.com
# 2. Get your connection string from Settings > Database
# Format: postgresql://postgres:[PASSWORD]@[HOST]:5432/postgres
```

### 2. Set Up Redis (Optional)

```bash
# Example with Upstash
# 1. Create a database at upstash.com
# 2. Get your connection details from the dashboard
# REDIS_URL format: redis://default:[PASSWORD]@[ENDPOINT].upstash.io:6379
```

### 3. Deploy to Vercel

#### Option A: Via Vercel Dashboard

1. Go to [vercel.com/new](https://vercel.com/new)
2. Import your GitHub repository
3. Configure environment variables (see below)
4. Click "Deploy"

#### Option B: Via Vercel CLI

```bash
# Install Vercel CLI
npm i -g vercel

# Login to Vercel
vercel login

# Deploy
vercel

# Deploy to production
vercel --prod
```

### 4. Configure Environment Variables

In Vercel Dashboard > Settings > Environment Variables, add:

#### Required Variables

```env
# Database
DATABASE_URL=your_database_connection_string

# Authentication
NEXTAUTH_URL=https://your-app.vercel.app
NEXTAUTH_SECRET=generate_32_char_secret_here
ENCRYPTION_KEY=generate_32_byte_key_here

# Application
NEXT_PUBLIC_APP_URL=https://your-app.vercel.app
```

#### Optional but Recommended

```env
# Redis (for caching and sessions)
REDIS_URL=your_upstash_redis_url

# Email
EMAIL_FROM=noreply@yourdomain.com
SMTP_HOST=smtp.resend.com
SMTP_PORT=587
SMTP_USER=resend
SMTP_PASSWORD=your_api_key

# Monitoring
SENTRY_DSN=your_sentry_dsn
LOG_LEVEL=info
```

### 5. Run Database Migrations

After deployment, run migrations:

```bash
# Option 1: Via Vercel CLI
vercel env pull .env.local
npx prisma migrate deploy

# Option 2: Direct connection
DATABASE_URL=your_connection_string npx prisma migrate deploy
```

### 6. Configure Custom Domain (Optional)

1. Go to Vercel Dashboard > Settings > Domains
2. Add your custom domain
3. Follow DNS configuration instructions

## Environment Variable Generation

### Generate NEXTAUTH_SECRET

```bash
# Option 1: Using OpenSSL
openssl rand -base64 32

# Option 2: Using Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

### Generate ENCRYPTION_KEY

```bash
# Must be exactly 32 characters
node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"
```

## Troubleshooting

### Build Errors

1. **Prisma Client Issues**
   ```bash
   # Ensure prisma generates before build
   # This is handled in vercel.json
   ```

2. **Module Not Found**
   ```bash
   # Clear cache and redeploy
   vercel --force
   ```

3. **Database Connection Issues**
   - Ensure DATABASE_URL includes `?sslmode=require` for production
   - Check if your database allows connections from Vercel IPs

### Performance Optimization

1. **Enable Edge Functions** (for API routes)
   ```typescript
   export const runtime = 'edge'; // Add to API routes
   ```

2. **Image Optimization**
   - Use `next/image` component
   - Configure external image domains in `next.config.js`

3. **Caching Strategy**
   - Redis is optional but highly recommended
   - Upstash works seamlessly with Vercel

## Monitoring

### Vercel Analytics
- Enable in Vercel Dashboard > Analytics
- No additional configuration needed

### External Monitoring
- **Sentry**: Error tracking
- **LogRocket**: Session replay
- **DataDog**: APM and logs

## Security Checklist

- [ ] All environment variables are set
- [ ] NEXTAUTH_SECRET is unique and secure
- [ ] Database has SSL enabled
- [ ] CORS is properly configured
- [ ] Rate limiting is enabled
- [ ] CSP headers are configured

## Post-Deployment

1. **Test Authentication Flow**
   - Register new account
   - Login/logout
   - Password reset

2. **Test Core Features**
   - Course enrollment
   - Video streaming
   - File uploads

3. **Monitor Performance**
   - Check Vercel Analytics
   - Monitor database queries
   - Review error logs

## Support

- **Vercel Documentation**: [vercel.com/docs](https://vercel.com/docs)
- **Next.js on Vercel**: [nextjs.org/docs/deployment](https://nextjs.org/docs/deployment)
- **Troubleshooting**: Check Vercel Dashboard > Functions > Logs

## Cost Optimization

### Free Tier Limits
- **Vercel**: 100GB bandwidth, unlimited deployments
- **Supabase**: 500MB database, 2 projects
- **Upstash**: 10,000 commands/day
- **Resend**: 100 emails/day

### When to Upgrade
- More than 1000 daily active users
- Need guaranteed uptime SLA
- Require team collaboration features
- Need advanced monitoring

---

For additional help, check the [main deployment guide](./DEPLOYMENT.md) or open an issue on GitHub.