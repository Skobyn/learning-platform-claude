import { NextApiRequest, NextApiResponse } from 'next';
import passport from 'passport';
import { samlService } from '@/services/sso/samlService';
import { totpService } from '@/services/mfa/totpService';
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
  const { saml } = req.query;
  const [provider, action] = Array.isArray(saml) ? saml : [saml, ''];

  if (!provider) {
    return res.status(400).json({ error: 'Provider not specified' });
  }

  const ipAddress = req.ip || req.connection.remoteAddress || '';
  const userAgent = req.headers['user-agent'] || '';

  try {
    switch (action) {
      case 'login':
        await handleSAMLLogin(req, res, provider);
        break;
      case 'callback':
        await handleSAMLCallback(req, res, provider);
        break;
      case 'logout':
        await handleSAMLLogout(req, res, provider);
        break;
      case 'metadata':
        await handleSAMLMetadata(req, res, provider);
        break;
      default:
        res.status(404).json({ error: 'Not found' });
    }
  } catch (error) {
    console.error('SAML handler error:', error);

    await auditService.logAuthenticationEvent({
      event: 'saml_error',
      provider: provider,
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

async function handleSAMLLogin(req: NextApiRequest, res: NextApiResponse, provider: string) {
  const ipAddress = req.ip || req.connection.remoteAddress || '';

  // Check if provider exists
  const strategy = samlService.getStrategy(provider);
  if (!strategy) {
    await auditService.logAuthenticationEvent({
      event: 'saml_provider_not_found',
      provider: provider,
      ipAddress,
      userAgent: req.headers['user-agent'] || '',
      success: false,
      metadata: { requestedProvider: provider }
    });
    return res.status(404).json({ error: 'SAML provider not found' });
  }

  // IP whitelist check (if organization requires it)
  const config = samlService.getProviderConfig(provider);
  if (config?.organizationId) {
    const ipValidation = await ipWhitelistMiddleware.checkIPWhitelist(
      req as any,
      config.organizationId
    );

    if (!ipValidation.allowed) {
      await auditService.logAuthenticationEvent({
        event: 'saml_ip_blocked',
        provider: provider,
        ipAddress,
        userAgent: req.headers['user-agent'] || '',
        success: false,
        metadata: {
          reason: ipValidation.reason,
          riskLevel: ipValidation.riskLevel
        }
      });
      return res.status(403).json({ error: 'Access denied' });
    }
  }

  // Store state information
  if (req.query.returnUrl) {
    req.session = req.session || {};
    req.session.returnUrl = req.query.returnUrl as string;
  }

  // Initiate SAML authentication
  passport.authenticate(`saml-${provider}`, {
    additionalParams: {},
    additionalAuthorizeParams: {}
  })(req, res);
}

async function handleSAMLCallback(req: NextApiRequest, res: NextApiResponse, provider: string) {
  const ipAddress = req.ip || req.connection.remoteAddress || '';
  const userAgent = req.headers['user-agent'] || '';

  return new Promise((resolve, reject) => {
    passport.authenticate(`saml-${provider}`, async (err: any, authResult: any) => {
      if (err) {
        await auditService.logAuthenticationEvent({
          event: 'saml_callback_error',
          provider: provider,
          ipAddress,
          userAgent,
          success: false,
          metadata: { error: err.message }
        });
        return res.status(500).json({ error: 'Authentication failed' });
      }

      if (!authResult) {
        await auditService.logAuthenticationEvent({
          event: 'saml_callback_no_result',
          provider: provider,
          ipAddress,
          userAgent,
          success: false
        });
        return res.status(401).json({ error: 'Authentication failed' });
      }

      try {
        const { user, isNewUser, requiresMFA, deviceTrusted, organizationSettings } = authResult;

        // Log successful SAML authentication
        await auditService.logAuthenticationEvent({
          userId: user.email,
          event: 'saml_login_success',
          provider: provider,
          ipAddress,
          userAgent,
          success: true,
          metadata: {
            userId: user.id,
            isNewUser,
            requiresMFA,
            deviceTrusted,
            nameID: user.nameID
          }
        });

        // If MFA is required, redirect to MFA challenge
        if (requiresMFA) {
          // Store pending session
          const pendingSessionId = await storePendingSession(user.id, {
            samlProvider: provider,
            samlNameID: user.nameID,
            samlSessionIndex: user.sessionIndex,
            deviceTrusted,
            ipAddress,
            userAgent
          });

          return res.redirect(`/auth/mfa?session=${pendingSessionId}`);
        }

        // Create session
        const session = await sessionManagementService.createSession(
          user.id,
          req as any,
          `SAML-${provider}`,
          false // MFA not verified if we reach here
        );

        // Set session cookie
        setSessionCookie(res, session.sessionId);

        // Redirect to return URL or dashboard
        const returnUrl = req.session?.returnUrl || '/dashboard';
        delete req.session?.returnUrl;

        res.redirect(returnUrl);
        resolve(true);

      } catch (error) {
        await auditService.logAuthenticationEvent({
          event: 'saml_session_error',
          provider: provider,
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

async function handleSAMLLogout(req: NextApiRequest, res: NextApiResponse, provider: string) {
  const sessionId = getSessionIdFromCookie(req);
  const ipAddress = req.ip || req.connection.remoteAddress || '';
  const userAgent = req.headers['user-agent'] || '';

  if (!sessionId) {
    return res.redirect('/auth/login');
  }

  try {
    // Get session info
    const sessionValidation = await sessionManagementService.validateSession(
      sessionId,
      req as any
    );

    if (sessionValidation.valid && sessionValidation.session) {
      const userId = sessionValidation.session.userId;

      // Get user info
      const user = await prisma.user.findUnique({
        where: { id: userId }
      });

      // Initiate SAML logout if possible
      const logoutUrl = await samlService.initiateSAMLLogout(userId, provider);

      // Invalidate session
      await sessionManagementService.invalidateSession(sessionId, 'USER_LOGOUT');

      // Clear session cookie
      clearSessionCookie(res);

      // Log logout
      await auditService.logAuthenticationEvent({
        userId: user?.email || userId,
        event: 'saml_logout',
        provider: provider,
        ipAddress,
        userAgent,
        success: true,
        metadata: { sessionId }
      });

      // Redirect to SAML logout URL or local logout page
      if (logoutUrl) {
        res.redirect(logoutUrl);
      } else {
        res.redirect('/auth/logout-success');
      }
    } else {
      res.redirect('/auth/login');
    }

  } catch (error) {
    await auditService.logAuthenticationEvent({
      event: 'saml_logout_error',
      provider: provider,
      ipAddress,
      userAgent,
      success: false,
      metadata: { error: error instanceof Error ? error.message : 'Unknown error' }
    });

    res.redirect('/auth/login');
  }
}

async function handleSAMLMetadata(req: NextApiRequest, res: NextApiResponse, provider: string) {
  try {
    const metadata = samlService.generateMetadata(provider);

    if (!metadata) {
      return res.status(404).json({ error: 'Metadata not available' });
    }

    res.setHeader('Content-Type', 'application/xml');
    res.send(metadata);

  } catch (error) {
    console.error('SAML metadata error:', error);
    res.status(500).json({ error: 'Failed to generate metadata' });
  }
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

function clearSessionCookie(res: NextApiResponse) {
  res.setHeader('Set-Cookie', `session=; HttpOnly; Secure; SameSite=lax; Path=/; Max-Age=0`);
}

function getSessionIdFromCookie(req: NextApiRequest): string | null {
  const cookies = req.headers.cookie;
  if (!cookies) return null;

  const sessionCookie = cookies
    .split(';')
    .find(cookie => cookie.trim().startsWith('session='));

  return sessionCookie ? sessionCookie.split('=')[1] : null;
}