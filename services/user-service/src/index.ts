import cors from 'cors';
import express from 'express';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import pool, { ensureUserSchema } from './db.js';
import { authMiddleware, signToken, type AuthRequest } from './middleware.js';

const app = express();
const port = Number(process.env.PORT ?? 3001);
const googleClientId = process.env.GOOGLE_CLIENT_ID;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
const appBaseUrl = process.env.APP_BASE_URL ?? 'http://localhost';
const serverPublicUrl = process.env.SERVER_PUBLIC_URL ?? appBaseUrl;
const googleRedirectUri =
  process.env.GOOGLE_REDIRECT_URI ?? `${serverPublicUrl}/api/user/google/callback`;
const googleStateCookie = 'notes_google_oauth_state';

interface GoogleUserInfo {
  sub: string;
  email: string;
  email_verified?: boolean;
  name?: string;
  given_name?: string;
}

app.use(cors());
app.use(express.json());

function readCookie(cookieHeader: string | undefined, name: string) {
  const cookies = cookieHeader?.split(';') ?? [];
  for (const cookie of cookies) {
    const [key, ...valueParts] = cookie.trim().split('=');
    if (key === name) {
      return decodeURIComponent(valueParts.join('='));
    }
  }
  return undefined;
}

function getConfiguredGoogleClient() {
  if (!googleClientId || !googleClientSecret) {
    return undefined;
  }

  return {
    clientId: googleClientId,
    clientSecret: googleClientSecret,
    redirectUri: googleRedirectUri
  };
}

function redirectToLoginError(res: express.Response, message: string) {
  const url = new URL('/login', appBaseUrl);
  url.searchParams.set('error', message);
  res.redirect(url.toString());
}

function redirectToOAuthCallback(res: express.Response, token: string) {
  const callbackUrl = new URL('/auth/callback', appBaseUrl);
  res.redirect(`${callbackUrl.toString()}#token=${encodeURIComponent(token)}`);
}

app.get('/health', (_req, res) => {
  res.json({
    service: 'user-service',
    status: 'ok',
    timestamp: new Date().toISOString()
  });
});

app.post('/register', async (req, res) => {
  try {
    const { email, displayName, password } = req.body ?? {};

    if (!email || !password || !displayName) {
      return res.status(400).json({ error: '请填写所有必填字段（email, displayName, password）' });
    }

    const [existing] = await pool.query(
      'SELECT id FROM users WHERE email = ?',
      [email]
    );

    if ((existing as any[]).length > 0) {
      return res.status(409).json({ error: '该邮箱已被注册' });
    }

    const id = uuidv4();
    const passwordHash = await bcrypt.hash(password, 10);

    await pool.query(
      'INSERT INTO users (id, email, display_name, password_hash) VALUES (?, ?, ?, ?)',
      [id, email, displayName, passwordHash]
    );

    const token = signToken({ id, email });

    res.status(201).json({
      token,
      user: { id, email, displayName, role: 'user' }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: '注册失败，请稍后重试' });
  }
});

app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body ?? {};

    if (!email || !password) {
      return res.status(400).json({ error: '请输入邮箱和密码' });
    }

    const [rows] = await pool.query(
      'SELECT id, email, display_name, password_hash, role FROM users WHERE email = ?',
      [email]
    );

    const users = rows as any[];
    if (users.length === 0) {
      return res.status(401).json({ error: '邮箱或密码错误' });
    }

    const user = users[0];
    if (!user.password_hash) {
      return res.status(401).json({ error: '该账号已绑定 Google 登录，请使用 Google 登录' });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);

    if (!isMatch) {
      return res.status(401).json({ error: '邮箱或密码错误' });
    }

    const token = signToken({ id: user.id, email: user.email });

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: '登录失败，请稍后重试' });
  }
});

app.get('/google', (_req, res) => {
  const client = getConfiguredGoogleClient();
  if (!client) {
    return res.status(503).json({ error: 'Google 登录尚未配置' });
  }

  const state = randomBytes(24).toString('hex');
  const secureCookie = client.redirectUri.startsWith('https://');
  res.cookie(googleStateCookie, state, {
    httpOnly: true,
    maxAge: 10 * 60 * 1000,
    sameSite: 'lax',
    secure: secureCookie,
    path: '/'
  });

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', client.clientId);
  authUrl.searchParams.set('redirect_uri', client.redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'openid email profile');
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('prompt', 'select_account');

  res.redirect(authUrl.toString());
});

app.get('/google/callback', async (req, res) => {
  try {
    const client = getConfiguredGoogleClient();
    if (!client) {
      return redirectToLoginError(res, 'Google 登录尚未配置');
    }

    const code = typeof req.query.code === 'string' ? req.query.code : undefined;
    const state = typeof req.query.state === 'string' ? req.query.state : undefined;
    const expectedState = readCookie(req.headers.cookie, googleStateCookie);

    res.clearCookie(googleStateCookie, { path: '/' });

    if (!code || !state || !expectedState || state !== expectedState) {
      return redirectToLoginError(res, 'Google 登录状态已失效，请重试');
    }

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: client.clientId,
        client_secret: client.clientSecret,
        redirect_uri: client.redirectUri,
        grant_type: 'authorization_code'
      })
    });

    if (!tokenResponse.ok) {
      throw new Error(`Google token exchange failed: ${tokenResponse.status}`);
    }

    const tokenData = await tokenResponse.json() as { access_token?: string };
    if (!tokenData.access_token) {
      throw new Error('Google token exchange did not return an access token');
    }

    const userInfoResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });

    if (!userInfoResponse.ok) {
      throw new Error(`Google userinfo request failed: ${userInfoResponse.status}`);
    }

    const googleUser = await userInfoResponse.json() as GoogleUserInfo;
    if (!googleUser.sub || !googleUser.email || googleUser.email_verified === false) {
      return redirectToLoginError(res, '无法验证 Google 邮箱');
    }

    const [existingRows] = await pool.query(
      `SELECT id, email, display_name, role
       FROM users
       WHERE oauth_provider = 'google' AND oauth_subject = ?`,
      [googleUser.sub]
    );

    let user = (existingRows as any[])[0];

    if (!user) {
      const [emailRows] = await pool.query(
        'SELECT id, email, display_name, role FROM users WHERE email = ?',
        [googleUser.email]
      );

      user = (emailRows as any[])[0];
      if (user) {
        await pool.query(
          `UPDATE users
           SET oauth_provider = 'google', oauth_subject = ?
           WHERE id = ?`,
          [googleUser.sub, user.id]
        );
      } else {
        user = {
          id: uuidv4(),
          email: googleUser.email,
          display_name: googleUser.name ?? googleUser.given_name ?? googleUser.email.split('@')[0],
          role: 'user'
        };

        await pool.query(
          `INSERT INTO users (id, email, display_name, password_hash, role, oauth_provider, oauth_subject)
           VALUES (?, ?, ?, NULL, 'user', 'google', ?)`,
          [user.id, user.email, user.display_name, googleUser.sub]
        );
      }
    }

    const token = signToken({ id: user.id, email: user.email });
    redirectToOAuthCallback(res, token);
  } catch (error) {
    console.error('Google login error:', error);
    redirectToLoginError(res, 'Google 登录失败，请稍后重试');
  }
});

app.get('/me', authMiddleware, (req: AuthRequest, res) => {
  (async () => {
    try {
      const [rows] = await pool.query(
        'SELECT id, email, display_name, role FROM users WHERE id = ?',
        [req.userId]
      );

      const users = rows as any[];
      if (users.length === 0) {
        return res.status(404).json({ error: '用户不存在' });
      }

      const user = users[0];
      res.json({
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        role: user.role
      });
    } catch (error) {
      console.error('Get user error:', error);
      res.status(500).json({ error: '获取用户信息失败' });
    }
  })();
});

await ensureUserSchema();

app.listen(port, () => {
  console.log(`user-service listening on ${port}`);
});
