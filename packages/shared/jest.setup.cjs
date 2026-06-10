// 在任何模块导入前注入测试环境变量（服务的 middleware 包装在导入时即读取 JWT_SECRET）
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.INTERNAL_SERVICE_SECRET = process.env.INTERNAL_SERVICE_SECRET || '';
