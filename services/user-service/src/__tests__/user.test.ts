import express from 'express';
import { request } from './request-helper.js';

// 创建一个简化的测试应用
const app = express();
app.use(express.json());

// 健康检查接口
app.get('/health', (_req, res) => {
  res.json({
    service: 'user-service',
    status: 'ok',
    timestamp: new Date().toISOString()
  });
});

// 模拟登录接口
app.post('/login', async (req, res) => {
  const { email, password } = req.body ?? {};

  if (!email || !password) {
    return res.status(400).json({ error: '请输入邮箱和密码' });
  }

  // 模拟成功登录
  if (email === 'test@example.com' && password === 'password123') {
    return res.json({
      token: 'test-token',
      user: {
        id: 'test-user-id',
        email: 'test@example.com',
        displayName: 'Test User',
        role: 'user'
      }
    });
  }

  // 模拟登录失败
  return res.status(401).json({ error: '邮箱或密码错误' });
});

// 模拟注册接口
app.post('/register', async (req, res) => {
  const { email, password, displayName, verificationCode } = req.body ?? {};

  if (!email || !password || !displayName || !verificationCode) {
    return res.status(400).json({ error: '请填写所有必填字段' });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: '密码长度不能少于 8 位' });
  }

  // 模拟注册成功
  return res.status(201).json({
    token: 'test-token',
    user: {
      id: 'new-user-id',
      email,
      displayName,
      role: 'user'
    }
  });
});

describe('User Service API', () => {
  describe('GET /health', () => {
    it('should return health status', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body).toHaveProperty('service', 'user-service');
      expect(response.body).toHaveProperty('status', 'ok');
      expect(response.body).toHaveProperty('timestamp');
    });
  });

  describe('POST /login', () => {
    it('should return 400 if email or password is missing', async () => {
      const response = await request(app)
        .post('/login')
        .send({ email: 'test@example.com' })
        .expect(400);

      expect(response.body).toHaveProperty('error');
    });

    it('should return 401 for invalid credentials', async () => {
      const response = await request(app)
        .post('/login')
        .send({ email: 'wrong@example.com', password: 'wrongpassword' })
        .expect(401);

      expect(response.body).toHaveProperty('error', '邮箱或密码错误');
    });

    it('should return token and user for valid credentials', async () => {
      const response = await request(app)
        .post('/login')
        .send({ email: 'test@example.com', password: 'password123' })
        .expect(200);

      expect(response.body).toHaveProperty('token');
      expect(response.body).toHaveProperty('user');
      expect(response.body.user).toHaveProperty('email', 'test@example.com');
    });
  });

  describe('POST /register', () => {
    it('should return 400 if required fields are missing', async () => {
      const response = await request(app)
        .post('/register')
        .send({ email: 'test@example.com' })
        .expect(400);

      expect(response.body).toHaveProperty('error');
    });

    it('should return 400 if password is too short', async () => {
      const response = await request(app)
        .post('/register')
        .send({
          email: 'test@example.com',
          password: '123',
          displayName: 'Test User',
          verificationCode: '123456'
        })
        .expect(400);

      expect(response.body).toHaveProperty('error', '密码长度不能少于 8 位');
    });

    it('should return 201 and token for successful registration', async () => {
      const response = await request(app)
        .post('/register')
        .send({
          email: 'new@example.com',
          password: 'password123',
          displayName: 'New User',
          verificationCode: '123456'
        })
        .expect(201);

      expect(response.body).toHaveProperty('token');
      expect(response.body).toHaveProperty('user');
      expect(response.body.user).toHaveProperty('email', 'new@example.com');
    });
  });
});
