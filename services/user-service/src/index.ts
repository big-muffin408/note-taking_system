import cors from 'cors';
import express from 'express';
import bcrypt from 'bcryptjs';
import nodemailer from 'nodemailer';
import { createHash, randomBytes, randomInt } from 'node:crypto';
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
const verificationCodeTtlMinutes = Number(process.env.EMAIL_VERIFICATION_TTL_MINUTES ?? 10);
const verificationSendCooldownSeconds = Number(process.env.EMAIL_VERIFICATION_COOLDOWN_SECONDS ?? 60);
const smtpHost = process.env.SMTP_HOST;
const smtpPort = Number(process.env.SMTP_PORT ?? 587);
const smtpUser = process.env.SMTP_USER;
const smtpPass = process.env.SMTP_PASS;
const smtpSecure = process.env.SMTP_SECURE === 'true';
const mailFrom = process.env.MAIL_FROM;

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

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function hashVerificationCode(email: string, code: string) {
  return createHash('sha256')
    .update(`${normalizeEmail(email)}:${code}:${process.env.JWT_SECRET ?? 'dev-jwt-secret-change-in-production'}`)
    .digest('hex');
}

function hasMailConfig() {
  return Boolean(smtpHost && mailFrom);
}

function createMailTransport() {
  if (!hasMailConfig()) {
    return undefined;
  }

  return nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpSecure,
    auth: smtpUser && smtpPass ? { user: smtpUser, pass: smtpPass } : undefined
  });
}

async function sendVerificationEmail(email: string, code: string) {
  const transport = createMailTransport();
  if (!transport) {
    throw new Error('SMTP is not configured');
  }

  await transport.sendMail({
    from: mailFrom,
    to: email,
    subject: 'AI 协作笔记系统邮箱验证码',
    text: `你的注册验证码是：${code}\n\n验证码 ${verificationCodeTtlMinutes} 分钟内有效。如果不是你本人操作，请忽略这封邮件。`,
    html: `<p>你的注册验证码是：</p><p style="font-size:24px;font-weight:700;letter-spacing:4px;">${code}</p><p>验证码 ${verificationCodeTtlMinutes} 分钟内有效。如果不是你本人操作，请忽略这封邮件。</p>`
  });
}

async function verifyEmailCode(email: string, code: string) {
  const normalizedEmail = normalizeEmail(email);
  const codeHash = hashVerificationCode(normalizedEmail, code.trim());

  const [rows] = await pool.query(
    `SELECT id, code_hash, attempts
     FROM email_verification_codes
     WHERE email = ?
       AND consumed_at IS NULL
       AND expires_at > CURRENT_TIMESTAMP
     ORDER BY created_at DESC
     LIMIT 1`,
    [normalizedEmail]
  );

  const record = (rows as any[])[0];
  if (!record) {
    return { ok: false, reason: '验证码已过期，请重新获取' };
  }

  if (record.attempts >= 5) {
    return { ok: false, reason: '验证码错误次数过多，请重新获取' };
  }

  if (record.code_hash !== codeHash) {
    await pool.query(
      'UPDATE email_verification_codes SET attempts = attempts + 1 WHERE id = ?',
      [record.id]
    );
    return { ok: false, reason: '验证码错误' };
  }

  await pool.query(
    'UPDATE email_verification_codes SET consumed_at = CURRENT_TIMESTAMP WHERE id = ?',
    [record.id]
  );
  return { ok: true };
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

app.post('/verification-code', async (req, res) => {
  try {
    const rawEmail = typeof req.body?.email === 'string' ? req.body.email : '';
    const email = normalizeEmail(rawEmail);

    if (!email) {
      return res.status(400).json({ error: '请输入邮箱' });
    }

    if (!hasMailConfig()) {
      return res.status(503).json({ error: '邮件服务尚未配置' });
    }

    const [existing] = await pool.query(
      'SELECT id FROM users WHERE email = ?',
      [email]
    );

    if ((existing as any[]).length > 0) {
      return res.status(409).json({ error: '该邮箱已被注册' });
    }

    const [recentRows] = await pool.query(
      `SELECT id
       FROM email_verification_codes
       WHERE email = ?
         AND created_at > DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ? SECOND)
       LIMIT 1`,
      [email, verificationSendCooldownSeconds]
    );

    if ((recentRows as any[]).length > 0) {
      return res.status(429).json({ error: '验证码发送过于频繁，请稍后再试' });
    }

    const code = String(randomInt(100000, 1000000));
    await pool.query(
      `INSERT INTO email_verification_codes (id, email, code_hash, expires_at)
       VALUES (?, ?, ?, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? MINUTE))`,
      [uuidv4(), email, hashVerificationCode(email, code), verificationCodeTtlMinutes]
    );

    await sendVerificationEmail(email, code);
    res.json({ message: '验证码已发送' });
  } catch (error) {
    console.error('Send verification code error:', error);
    if (error instanceof Error && error.message === 'SMTP is not configured') {
      return res.status(503).json({ error: '邮件服务尚未配置' });
    }
    res.status(500).json({ error: '验证码发送失败，请稍后重试' });
  }
});

app.post('/register', async (req, res) => {
  try {
    const { displayName, password, verificationCode } = req.body ?? {};
    const email = normalizeEmail(typeof req.body?.email === 'string' ? req.body.email : '');

    if (!email || !password || !displayName || !verificationCode) {
      return res.status(400).json({ error: '请填写所有必填字段（email, displayName, password, verificationCode）' });
    }

    const [existing] = await pool.query(
      'SELECT id FROM users WHERE email = ?',
      [email]
    );

    if ((existing as any[]).length > 0) {
      return res.status(409).json({ error: '该邮箱已被注册' });
    }

    const verification = await verifyEmailCode(email, String(verificationCode));
    if (!verification.ok) {
      return res.status(400).json({ error: verification.reason });
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
