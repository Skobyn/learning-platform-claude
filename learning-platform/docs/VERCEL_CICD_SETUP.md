# Vercel CI/CD Pipeline Setup Guide

## Overview

This guide explains how to set up the CI/CD pipeline for automatic deployments to Vercel with GitHub Actions.

## Features

- ✅ Automatic testing before deployment
- 🔄 Preview deployments for pull requests
- 🚀 Production deployments on merge to master/main
- 📊 Performance monitoring with Lighthouse
- 🔒 Security scanning
- 💬 Automatic PR comments with preview URLs

## Setup Steps

### 1. Connect GitHub to Vercel

1. Go to [vercel.com/new](https://vercel.com/new)
2. Import your GitHub repository
3. Configure initial environment variables
4. Complete the first deployment

### 2. Get Vercel Credentials

#### Get Vercel Token:
```bash
# Install Vercel CLI
npm i -g vercel

# Login to Vercel
vercel login

# Get your token from: https://vercel.com/account/tokens
# Create a new token with full access
```

#### Get Project and Org IDs:
```bash
# In your project directory
vercel link

# This creates .vercel/project.json with:
# - orgId
# - projectId
```

### 3. Add GitHub Secrets

Go to your GitHub repository → Settings → Secrets and variables → Actions

Add these secrets:

| Secret Name | Description | How to Get |
|------------|-------------|------------|
| `VERCEL_TOKEN` | Vercel authentication token | [vercel.com/account/tokens](https://vercel.com/account/tokens) |
| `VERCEL_ORG_ID` | Your Vercel organization ID | From `.vercel/project.json` |
| `VERCEL_PROJECT_ID` | Your Vercel project ID | From `.vercel/project.json` |
| `SNYK_TOKEN` | (Optional) Snyk security scanning | [snyk.io](https://snyk.io) |

### 4. Configure Branch Protection

1. Go to Settings → Branches
2. Add rule for `master` or `main`
3. Enable:
   - Require pull request reviews
   - Require status checks (select "Test & Lint")
   - Require branches to be up to date

## Workflow Triggers

### Pull Requests
- Runs tests and linting
- Deploys preview to Vercel
- Comments PR with preview URL
- Runs Lighthouse performance checks

### Push to master/main
- Runs full test suite
- Deploys to production
- Creates GitHub release (if commit message contains `[release]`)

### Manual Deployment
```bash
# Deploy preview
vercel

# Deploy to production
vercel --prod
```

## Environment Variables

### Required for CI/CD
These are automatically handled by the workflow:
- `DATABASE_URL` - Test database (PostgreSQL)
- `NEXTAUTH_SECRET` - Test secret for builds
- `NEXTAUTH_URL` - Test URL for builds

### Required in Vercel Dashboard
Configure these in Vercel Dashboard → Settings → Environment Variables:

Production:
- `DATABASE_URL` - Your production database
- `NEXTAUTH_SECRET` - Production secret (generate with `openssl rand -base64 32`)
- `NEXTAUTH_URL` - Your production URL
- `ENCRYPTION_KEY` - 32-character encryption key
- `REDIS_URL` - (Optional) Redis connection

## Pipeline Stages

### 1. Test Stage
- Installs dependencies
- Runs Prisma migrations
- Executes linting
- Runs type checking
- Executes unit tests
- Builds application

### 2. Deploy Stage
**Preview (PR)**:
- Deploys to unique preview URL
- Comments on PR with URL
- Non-blocking deployment

**Production (master/main)**:
- Deploys to production domain
- Updates production environment
- Creates release tag (optional)

### 3. Post-Deploy
- Lighthouse performance tests
- Security scanning
- Monitoring setup

## Customization

### Skip CI
Add `[skip ci]` to commit message:
```bash
git commit -m "Update readme [skip ci]"
```

### Create Release
Add `[release]` to commit message:
```bash
git commit -m "Add new feature [release]"
```

### Environment-Specific Builds
In `vercel.json`:
```json
{
  "build": {
    "env": {
      "NEXT_PUBLIC_API_URL": "$VERCEL_ENV === 'production' ? 'https://api.prod.com' : 'https://api.dev.com'"
    }
  }
}
```

## Monitoring

### Vercel Dashboard
- View deployments: [vercel.com/dashboard](https://vercel.com/dashboard)
- Check function logs
- Monitor performance metrics

### GitHub Actions
- View workflows: GitHub → Actions tab
- Check test results
- Review deployment logs

## Troubleshooting

### Build Fails
1. Check GitHub Actions logs
2. Verify environment variables in Vercel
3. Ensure Prisma client generation

### Preview URL Not Working
1. Check Vercel token is valid
2. Verify org and project IDs
3. Check branch protection rules

### Tests Failing
1. Review test logs in GitHub Actions
2. Run tests locally: `npm test`
3. Check database migrations

## Best Practices

1. **Always test locally first**
   ```bash
   npm run build
   npm test
   ```

2. **Use preview deployments**
   - Test features in preview before merging
   - Share preview URLs for review

3. **Monitor performance**
   - Check Lighthouse scores
   - Review Vercel Analytics

4. **Keep secrets secure**
   - Never commit secrets
   - Rotate tokens regularly
   - Use environment-specific values

## Advanced Features

### Custom Domains
Configure in Vercel Dashboard → Settings → Domains

### Edge Functions
Add to API routes:
```typescript
export const runtime = 'edge';
```

### Incremental Static Regeneration
```typescript
export const revalidate = 60; // seconds
```

## Support

- [Vercel Documentation](https://vercel.com/docs)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Project Issues](https://github.com/your-repo/issues)