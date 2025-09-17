import { NextApiRequest, NextApiResponse } from 'next';
import passport from 'passport';
import { oauthService } from '@/services/sso/oauthProviders';
import { sessionManagementService } from '@/services/sessionManagement';
import { ipWhitelistMiddleware } from '@/middleware/ipWhitelist';
import { auditService } from '@/services/auditService';
import { prisma } from '@/lib/db';

// Configure passport
passport.serializeUser((user: any, done) => {
  done(null, user.user.id);
});

passport.deserializeUser(async (id: string, done) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id },
      include: {
        organization: true,
        mfaSettings: true
      }
    });
    done(null, user);
  } catch (error) {
    done(error);
  }
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { provider } = req.query;
  const action = req.query.action as string || 'login';

  if (!provider || typeof provider !== 'string') {
    return res.status(400).json({ error: 'Provider not specified' });
  }

  if (!['google', 'microsoft', 'linkedin'].includes(provider)) {
    return res.status(400).json({ error: 'Invalid provider' });
  }

  const ipAddress = req.ip || req.connection.remoteAddress || '';
  const userAgent = req.headers['user-agent'] || '';

  try {
    switch (action) {
      case 'login':
        await handleOAuthLogin(req, res, provider as 'google' | 'microsoft' | 'linkedin');
        break;
      case 'callback':
        await handleOAuthCallback(req, res, provider as 'google' | 'microsoft' | 'linkedin');
        break;
      case 'disconnect':
        await handleOAuthDisconnect(req, res, provider as 'google' | 'microsoft' | 'linkedin');
        break;
      case 'refresh':
        await handleTokenRefresh(req, res, provider as 'google' | 'microsoft' | 'linkedin');
        break;
      default:
        res.status(404).json({ error: 'Action not found' });
    }
  } catch (error) {
    console.error(`OAuth ${provider} handler error:`, error);

    await auditService.logAuthenticationEvent({
      event: 'oauth_error',
      provider: provider.toUpperCase(),
      ipAddress,
      userAgent,
      success: false,
      metadata: {
        error: error instanceof Error ? error.message : 'Unknown error',
        action
      }
    });

    res.status(500).json({ error: 'Authentication error' });
  }
}

async function handleOAuthLogin(
  req: NextApiRequest,
  res: NextApiResponse,
  provider: 'google' | 'microsoft' | 'linkedin'
) {
  const ipAddress = req.ip || req.connection.remoteAddress || '';

  // Check if OAuth strategy exists
  const strategy = oauthService.getStrategy(provider);
  if (!strategy) {
    await auditService.logAuthenticationEvent({
      event: 'oauth_provider_not_configured',
      provider: provider.toUpperCase(),
      ipAddress,
      userAgent: req.headers['user-agent'] || '',
      success: false,
      metadata: { requestedProvider: provider }
    });
    return res.status(404).json({ error: `${provider} OAuth not configured` });
  }

  // Basic IP validation (organization-specific IP whitelist would be checked after user identification)
  const suspiciousIPs = ['127.0.0.1']; // Add known malicious IPs
  if (suspiciousIPs.includes(ipAddress)) {
    await auditService.logAuthenticationEvent({
      event: 'oauth_suspicious_ip',
      provider: provider.toUpperCase(),
      ipAddress,
      userAgent: req.headers['user-agent'] || '',
      success: false,
      metadata: { reason: 'Suspicious IP detected' }
    });
    return res.status(403).json({ error: 'Access denied' });
  }

  // Store state information
  if (req.query.returnUrl) {
    req.session = req.session || {};
    req.session.returnUrl = req.query.returnUrl as string;
  }

  // Store CSRF token to prevent attacks
  const state = generateStateToken();
  req.session = req.session || {};
  req.session.oauthState = state;

  // Add state to OAuth parameters
  const authOptions: any = {
    scope: getProviderScopes(provider),
    state: state
  };

  // Add additional parameters based on provider
  switch (provider) {
    case 'microsoft':
      authOptions.prompt = 'select_account';
      break;
    case 'google':
      authOptions.accessType = 'offline';
      authOptions.prompt = 'consent';
      break;
  }

  // Initiate OAuth authentication
  passport.authenticate(provider, authOptions)(req, res);
}

async function handleOAuthCallback(
  req: NextApiRequest,
  res: NextApiResponse,
  provider: 'google' | 'microsoft' | 'linkedin'
) {
  const ipAddress = req.ip || req.connection.remoteAddress || '';
  const userAgent = req.headers['user-agent'] || '';

  // Verify CSRF token
  const receivedState = req.query.state as string;
  const expectedState = req.session?.oauthState;

  if (!receivedState || receivedState !== expectedState) {
    await auditService.logAuthenticationEvent({
      event: 'oauth_csrf_mismatch',
      provider: provider.toUpperCase(),
      ipAddress,
      userAgent,
      success: false,
      metadata: { receivedState, expectedState }
    });
    return res.status(400).json({ error: 'Invalid state parameter' });
  }

  // Clear CSRF token
  if (req.session) {
    delete req.session.oauthState;
  }

  return new Promise((resolve, reject) => {
    passport.authenticate(provider, async (err: any, authResult: any) => {
      if (err) {
        await auditService.logAuthenticationEvent({
          event: 'oauth_callback_error',
          provider: provider.toUpperCase(),
          ipAddress,
          userAgent,
          success: false,
          metadata: { error: err.message }
        });
        return res.status(500).json({ error: 'Authentication failed' });
      }

      if (!authResult) {
        await auditService.logAuthenticationEvent({
          event: 'oauth_callback_no_result',
          provider: provider.toUpperCase(),
          ipAddress,
          userAgent,
          success: false
        });
        return res.status(401).json({ error: 'Authentication failed' });
      }

      try {
        const { user, isNewUser, requiresMFA, deviceTrusted, organizationSettings } = authResult;

        // Check organization IP whitelist if user belongs to an organization
        if (organizationSettings?.id) {
          const ipValidation = await ipWhitelistMiddleware.checkIPWhitelist(
            req as any,
            organizationSettings.id,
            user.id
          );

          if (!ipValidation.allowed) {
            await auditService.logAuthenticationEvent({
              userId: user.email,
              event: 'oauth_ip_blocked',
              provider: provider.toUpperCase(),
              ipAddress,
              userAgent,
              success: false,
              metadata: {
                reason: ipValidation.reason,
                riskLevel: ipValidation.riskLevel
              }
            });
            return res.status(403).json({ error: 'Access denied from this location' });
          }
        }

        // Log successful OAuth authentication
        await auditService.logAuthenticationEvent({
          userId: user.email,
          event: 'oauth_login_success',
          provider: provider.toUpperCase(),
          ipAddress,
          userAgent,
          success: true,
          metadata: {
            userId: user.id,
            isNewUser,
            requiresMFA,
            deviceTrusted,
            providerId: user.providerId
          }
        });

        // If MFA is required, redirect to MFA challenge
        if (requiresMFA) {
          const pendingSessionId = await storePendingSession(user.id, {
            oauthProvider: provider,
            oauthProviderId: user.providerId,
            deviceTrusted,
            ipAddress,
            userAgent,
            accessToken: user.accessToken,
            refreshToken: user.refreshToken
          });

          return res.redirect(`/auth/mfa?session=${pendingSessionId}`);
        }

        // Create session
        const session = await sessionManagementService.createSession(
          user.id,
          req as any,
          provider.toUpperCase(),
          false // MFA not verified if we reach here
        );

        // Set session cookie
        setSessionCookie(res, session.sessionId);

        // Send welcome email for new users
        if (isNewUser) {
          await sendWelcomeEmail(user.email, user.firstName);
        }

        // Redirect to return URL or dashboard
        const returnUrl = req.session?.returnUrl || '/dashboard';
        if (req.session) {
          delete req.session.returnUrl;
        }

        res.redirect(returnUrl);
        resolve(true);

      } catch (error) {
        await auditService.logAuthenticationEvent({
          event: 'oauth_session_error',
          provider: provider.toUpperCase(),
          ipAddress,
          userAgent,
          success: false,
          metadata: { error: error instanceof Error ? error.message : 'Unknown error' }
        });

        res.status(500).json({ error: 'Session creation failed' });
        reject(error);
      }
    })(req, res);
  });
}

async function handleOAuthDisconnect(
  req: NextApiRequest,
  res: NextApiResponse,
  provider: 'google' | 'microsoft' | 'linkedin'
) {
  const sessionId = getSessionIdFromCookie(req);
  const ipAddress = req.ip || req.connection.remoteAddress || '';
  const userAgent = req.headers['user-agent'] || '';

  if (!sessionId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    // Validate session
    const sessionValidation = await sessionManagementService.validateSession(
      sessionId,
      req as any
    );

    if (!sessionValidation.valid || !sessionValidation.session) {
      return res.status(401).json({ error: 'Invalid session' });
    }

    const userId = sessionValidation.session.userId;

    // Revoke OAuth token
    const success = await oauthService.revokeToken(userId, provider);

    if (success) {
      await auditService.logAuthenticationEvent({
        userId,
        event: 'oauth_disconnected',
        provider: provider.toUpperCase(),
        ipAddress,
        userAgent,
        success: true,
        metadata: { provider }
      });

      res.json({ success: true, message: `${provider} account disconnected successfully` });
    } else {
      await auditService.logAuthenticationEvent({
        userId,
        event: 'oauth_disconnect_failed',
        provider: provider.toUpperCase(),
        ipAddress,
        userAgent,
        success: false,
        metadata: { provider }
      });

      res.status(500).json({ error: 'Failed to disconnect account' });
    }

  } catch (error) {
    await auditService.logAuthenticationEvent({
      event: 'oauth_disconnect_error',
      provider: provider.toUpperCase(),
      ipAddress,
      userAgent,
      success: false,
      metadata: { error: error instanceof Error ? error.message : 'Unknown error' }
    });

    res.status(500).json({ error: 'Disconnect operation failed' });
  }
}

async function handleTokenRefresh(
  req: NextApiRequest,
  res: NextApiResponse,
  provider: 'google' | 'microsoft' | 'linkedin'
) {
  const sessionId = getSessionIdFromCookie(req);
  const ipAddress = req.ip || req.connection.remoteAddress || '';
  const userAgent = req.headers['user-agent'] || '';

  if (!sessionId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    // Validate session
    const sessionValidation = await sessionManagementService.validateSession(
      sessionId,
      req as any
    );

    if (!sessionValidation.valid || !sessionValidation.session) {
      return res.status(401).json({ error: 'Invalid session' });
    }

    const userId = sessionValidation.session.userId;

    // Refresh OAuth token
    const newAccessToken = await oauthService.refreshToken(userId, provider);

    if (newAccessToken) {
      await auditService.logAuthenticationEvent({
        userId,
        event: 'oauth_token_refreshed',
        provider: provider.toUpperCase(),
        ipAddress,
        userAgent,
        success: true,
        metadata: { provider }
      });

      res.json({ success: true, accessToken: newAccessToken });
    } else {
      await auditService.logAuthenticationEvent({
        userId,
        event: 'oauth_token_refresh_failed',
        provider: provider.toUpperCase(),
        ipAddress,
        userAgent,
        success: false,
        metadata: { provider }
      });

      res.status(500).json({ error: 'Failed to refresh token' });
    }

  } catch (error) {
    await auditService.logAuthenticationEvent({
      event: 'oauth_refresh_error',
      provider: provider.toUpperCase(),
      ipAddress,
      userAgent,
      success: false,
      metadata: { error: error instanceof Error ? error.message : 'Unknown error' }
    });

    res.status(500).json({ error: 'Token refresh failed' });
  }
}

function getProviderScopes(provider: 'google' | 'microsoft' | 'linkedin'): string[] {
  switch (provider) {
    case 'google':
      return ['profile', 'email'];
    case 'microsoft':
      return ['user.read'];
    case 'linkedin':
      return ['r_emailaddress', 'r_liteprofile'];
    default:
      return ['profile', 'email'];
  }
}

function generateStateToken(): string {
  return require('crypto').randomBytes(32).toString('hex');
}

async function storePendingSession(userId: string, data: any): Promise<string> {
  const pendingSessionId = generatePendingSessionId();

  await prisma.pendingSession.create({
    data: {
      id: pendingSessionId,
      userId,
      data: data as any,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000) // 10 minutes
    }
  });

  return pendingSessionId;
}

function generatePendingSessionId(): string {
  return require('crypto').randomBytes(32).toString('hex');
}

function setSessionCookie(res: NextApiResponse, sessionId: string) {
  const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge: 8 * 60 * 60, // 8 hours
    path: '/'
  };

  res.setHeader('Set-Cookie', `session=${sessionId}; ${Object.entries(cookieOptions)
    .map(([key, value]) => `${key}=${value}`)
    .join('; ')}`);
}

function getSessionIdFromCookie(req: NextApiRequest): string | null {
  const cookies = req.headers.cookie;
  if (!cookies) return null;

  const sessionCookie = cookies
    .split(';')
    .find(cookie => cookie.trim().startsWith('session='));

  return sessionCookie ? sessionCookie.split('=')[1] : null;
}

async function sendWelcomeEmail(email: string, firstName?: string): Promise<void> {
  // This would integrate with your email service
  // For now, just log the action
  await auditService.logAuthenticationEvent({
    userId: email,
    event: 'welcome_email_sent',
    provider: 'EMAIL',
    success: true,
    metadata: { email, firstName }
  });
}