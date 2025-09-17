# Deployment Checklist - Learning Platform

## ✅ Pre-Deployment Completed

- [x] Fixed Redis server-only imports for client compatibility
- [x] Created Redis fallback with in-memory LRU cache
- [x] Added Vercel deployment configuration
- [x] Updated .gitignore for build artifacts
- [x] Created production environment template

## 📋 Vercel Deployment Steps

### 1. Database Setup
- [ ] Sign up for database service (Supabase/Neon/PlanetScale)
- [ ] Create PostgreSQL database
- [ ] Copy connection string
- [ ] Add `?sslmode=require` to connection string

### 2. Redis Setup (Optional but Recommended)
- [ ] Sign up for Upstash Redis
- [ ] Create Redis database
- [ ] Copy connection URL

### 3. Environment Variables in Vercel
Required:
- [ ] `DATABASE_URL` - PostgreSQL connection string
- [ ] `NEXTAUTH_URL` - https://your-app.vercel.app
- [ ] `NEXTAUTH_SECRET` - Generate with: `openssl rand -base64 32`
- [ ] `ENCRYPTION_KEY` - Generate with: `node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"`
- [ ] `NEXT_PUBLIC_APP_URL` - https://your-app.vercel.app

Optional:
- [ ] `REDIS_URL` - Upstash Redis URL (if using Redis)
- [ ] Email configuration (SMTP settings)

### 4. Deploy
- [ ] Go to [vercel.com/new](https://vercel.com/new)
- [ ] Import GitHub repository
- [ ] Add environment variables
- [ ] Click "Deploy"

### 5. Post-Deployment
- [ ] Run database migrations
- [ ] Test authentication flow
- [ ] Verify course functionality
- [ ] Check Redis connection (if configured)

## 🚀 Quick Commands

```bash
# Generate secrets
openssl rand -base64 32  # For NEXTAUTH_SECRET
node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"  # For ENCRYPTION_KEY

# Database migration (after deployment)
DATABASE_URL="your_connection_string" npx prisma migrate deploy

# Monitor deployment
vercel logs --follow
```

## 📝 Notes

- The platform now gracefully handles Redis unavailability with in-memory fallback
- Build process automatically generates Prisma client
- Authentication works without Redis (sessions stored in JWT)
- File uploads will use local storage unless cloud storage is configured

## 🔗 Resources

- [Detailed Vercel Guide](./docs/DEPLOYMENT_VERCEL.md)
- [Environment Variables Template](./.env.production)
- [Vercel Configuration](./vercel.json)

## ⚠️ Important

1. **Database SSL**: Always use `?sslmode=require` in production DATABASE_URL
2. **Secrets**: Never commit actual secrets to Git
3. **Redis**: Optional but improves performance significantly
4. **Domain**: Update all URL environment variables when using custom domain

---

Ready for deployment! Follow the checklist above to deploy to Vercel.