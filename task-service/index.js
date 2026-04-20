require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const pool = require('./db');

const app = express();
app.use(cors());
app.use(express.json());

// ─── DB Init ──────────────────────────────────────────────────────────────────
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tasks (
      id          SERIAL PRIMARY KEY,
      title       VARCHAR(255) NOT NULL,
      description TEXT,
      status      VARCHAR(50) DEFAULT 'pending',
      priority    VARCHAR(20) DEFAULT 'medium',
      user_id     INTEGER NOT NULL,
      created_at  TIMESTAMPTZ DEFAULT NOW(),
      updated_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  console.log('[Task Service] Tasks table ready');
}

// ─── Auth Middleware ───────────────────────────────────────────────────────────
function authenticate(req, res, next) {
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

// ─── Notify Helper ────────────────────────────────────────────────────────────
async function notify(event, payload) {
  try {
    await axios.post(`${process.env.NOTIFICATION_SERVICE_URL}/notify`, { event, payload });
  } catch (err) {
    console.warn('[Task Service] Notification delivery failed:', err.message);
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'task-service' }));

// Create task
app.post('/tasks', authenticate, async (req, res) => {
  const { title, description, priority } = req.body;
  if (!title) return res.status(400).json({ error: 'title is required' });

  try {
    const result = await pool.query(
      `INSERT INTO tasks (title, description, priority, user_id)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [title, description || '', priority || 'medium', req.user.id]
    );
    const task = result.rows[0];
    await notify('task_created', { taskId: task.id, title: task.title, userId: task.user_id });
    res.status(201).json(task);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all tasks for current user
app.get('/tasks', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM tasks WHERE user_id = $1 ORDER BY created_at DESC',
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get single task
app.get('/tasks/:id', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM tasks WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Task not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update task
app.put('/tasks/:id', authenticate, async (req, res) => {
  const { title, description, status, priority } = req.body;
  try {
    const result = await pool.query(
      `UPDATE tasks
       SET title = COALESCE($1, title),
           description = COALESCE($2, description),
           status = COALESCE($3, status),
           priority = COALESCE($4, priority),
           updated_at = NOW()
       WHERE id = $5 AND user_id = $6
       RETURNING *`,
      [title, description, status, priority, req.params.id, req.user.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Task not found' });
    const task = result.rows[0];
    await notify('task_updated', { taskId: task.id, title: task.title, status: task.status, userId: task.user_id });
    res.json(task);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete task
app.delete('/tasks/:id', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM tasks WHERE id = $1 AND user_id = $2 RETURNING *',
      [req.params.id, req.user.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Task not found' });
    await notify('task_deleted', { taskId: req.params.id, userId: req.user.id });
    res.json({ message: 'Task deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3002;
initDB().then(() => {
  app.listen(PORT, () => console.log(`[Task Service] Running on port ${PORT}`));
}).catch(err => {
  console.error('[Task Service] DB init failed:', err.message);
  process.exit(1);
});
