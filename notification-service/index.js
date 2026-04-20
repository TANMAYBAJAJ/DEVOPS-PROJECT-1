require('dotenv').config();
const express = require('express');
const cors = require('cors');
const pool = require('./db');

const app = express();
app.use(cors());
app.use(express.json());

// ─── DB Init ──────────────────────────────────────────────────────────────────
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id         SERIAL PRIMARY KEY,
      event      VARCHAR(100) NOT NULL,
      payload    JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  console.log('[Notification Service] Notifications table ready');
}

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'notification-service' }));

// Receive notification from other services
app.post('/notify', async (req, res) => {
  const { event, payload } = req.body;
  if (!event) return res.status(400).json({ error: 'event is required' });

  try {
    const result = await pool.query(
      'INSERT INTO notifications (event, payload) VALUES ($1, $2) RETURNING *',
      [event, JSON.stringify(payload)]
    );
    const notif = result.rows[0];
    console.log(`[Notification] [${notif.created_at.toISOString()}] EVENT: ${event}`, payload);
    res.status(201).json({ message: 'Notification logged', notification: notif });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all notification logs
app.get('/notifications', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM notifications ORDER BY created_at DESC LIMIT 100');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3003;
initDB().then(() => {
  app.listen(PORT, () => console.log(`[Notification Service] Running on port ${PORT}`));
}).catch(err => {
  console.error('[Notification Service] DB init failed:', err.message);
  process.exit(1);
});
