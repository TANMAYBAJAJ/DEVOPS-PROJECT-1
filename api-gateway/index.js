require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();

// NOTE: Do NOT add express.json() here — it consumes the request body stream
// which prevents http-proxy-middleware from forwarding the body to backend services.
app.use(cors());

// ─── Auth Middleware ───────────────────────────────────────────────────────────
function authenticate(req, res, next) {
  // Skip auth for login/register
  if (req.path.startsWith('/api/users/register') || req.path.startsWith('/api/users/login')) {
    return next();
  }
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ─── Health ───────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'api-gateway',
    routes: {
      users: process.env.USER_SERVICE_URL,
      tasks: process.env.TASK_SERVICE_URL,
      notifications: process.env.NOTIFICATION_SERVICE_URL,
    }
  });
});

// ─── Proxy Routes ─────────────────────────────────────────────────────────────
app.use('/api/users', createProxyMiddleware({
  target: process.env.USER_SERVICE_URL,
  changeOrigin: true,
  pathRewrite: { '^/api/users': '' },
  on: {
    error: (err, req, res) => {
      console.error('[Gateway] User service error:', err.message);
      res.status(502).json({ error: 'User service unavailable' });
    }
  }
}));

app.use('/api/tasks', authenticate, createProxyMiddleware({
  target: process.env.TASK_SERVICE_URL,
  changeOrigin: true,
  pathRewrite: { '^/api/tasks': '/tasks' },
  on: {
    error: (err, req, res) => {
      console.error('[Gateway] Task service error:', err.message);
      res.status(502).json({ error: 'Task service unavailable' });
    }
  }
}));

app.use('/api/notifications', authenticate, createProxyMiddleware({
  target: process.env.NOTIFICATION_SERVICE_URL,
  changeOrigin: true,
  pathRewrite: { '^/api/notifications': '/notifications' },
  on: {
    error: (err, req, res) => {
      console.error('[Gateway] Notification service error:', err.message);
      res.status(502).json({ error: 'Notification service unavailable' });
    }
  }
}));

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[API Gateway] Running on port ${PORT}`);
  console.log(`  → /api/users        → ${process.env.USER_SERVICE_URL}`);
  console.log(`  → /api/tasks        → ${process.env.TASK_SERVICE_URL}`);
  console.log(`  → /api/notifications→ ${process.env.NOTIFICATION_SERVICE_URL}`);
});
