-- DevOps Task Manager - DB Initialization
-- Run this once before starting services, OR let services auto-create tables on startup

CREATE DATABASE devops_tasks;

\c devops_tasks;

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id         SERIAL PRIMARY KEY,
  username   VARCHAR(100) UNIQUE NOT NULL,
  email      VARCHAR(150) UNIQUE NOT NULL,
  password   VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tasks table
CREATE TABLE IF NOT EXISTS tasks (
  id          SERIAL PRIMARY KEY,
  title       VARCHAR(255) NOT NULL,
  description TEXT,
  status      VARCHAR(50)  DEFAULT 'pending',   -- pending | in_progress | done
  priority    VARCHAR(20)  DEFAULT 'medium',     -- low | medium | high
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Notifications table
CREATE TABLE IF NOT EXISTS notifications (
  id         SERIAL PRIMARY KEY,
  event      VARCHAR(100) NOT NULL,
  payload    JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_tasks_user_id    ON tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status     ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_notif_event      ON notifications(event);
CREATE INDEX IF NOT EXISTS idx_notif_created_at ON notifications(created_at DESC);
