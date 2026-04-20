# DevOps Task Manager — Complete System Architecture & Technical Deep Dive

> **Written by:** Senior DevOps + Backend Architect Analysis  
> **Project:** `devops-task-manager`  
> **Stack:** Node.js · PostgreSQL · React (Vite) · Docker · Nginx  
> **Pattern:** Microservices with API Gateway

---

## Table of Contents

1. [Project Architecture (High Level)](#1-project-architecture-high-level)
2. [Request Flow](#2-request-flow-very-important)
3. [API Structure](#3-api-structure)
4. [Database Flow](#4-database-flow)
5. [Service Communication](#5-service-communication)
6. [Authentication Flow](#6-authentication-flow)
7. [Important Files Explanation](#7-important-files-explanation)
8. [DevOps Perspective](#8-devops-perspective)

---

## 1. Project Architecture (High Level)

### Components Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Docker Network                               │
│                                                                     │
│   ┌───────────┐   frontend   ┌─────────────────┐                   │
│   │  Browser  │ ──────────── │  Frontend (React)│  Port 80         │
│   └───────────┘   network    │  Served by Nginx │                  │
│                              └────────┬─────────┘                  │
│                                       │ /api/* proxied             │
│                              ┌────────▼─────────┐                  │
│                              │   API Gateway     │  Port 3000       │
│                              │  (http-proxy-mid) │                  │
│                              └──┬──────┬─────┬──┘                  │
│                      backend    │      │     │   network            │
│               ┌─────────────────┘      │     └─────────────────┐   │
│               │                        │                        │   │
│   ┌───────────▼──────┐   ┌────────────▼────────┐  ┌───────────▼──┐│
│   │  User Service     │   │   Task Service       │  │ Notification ││
│   │  Port 3001        │   │   Port 3002          │  │ Service      ││
│   │  (Auth/Users)     │   │   (CRUD + Notify)    │  │ Port 3003    ││
│   └───────────┬──────┘   └────────────┬─────────┘  └───────────┬──┘│
│               │                        │                        │   │
│               └────────────┬───────────┘                        │   │
│                            │ SQL queries (pg pool)               │   │
│                   ┌────────▼──────────────────────────────────┐ │   │
│                   │         PostgreSQL (port 5432)             │─┘   │
│                   │         DB: devops_tasks                   │     │
│                   │  Tables: users | tasks | notifications     │     │
│                   └────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────────────┘
```

### Component Summary

| Component            | Tech Stack             | Port | Role                                        |
|----------------------|------------------------|------|---------------------------------------------|
| **Frontend**         | React (Vite) + Nginx   | 80   | User interface; SPA served by Nginx         |
| **API Gateway**      | Node.js + Express      | 3000 | Single entry point; JWT validation; routing |
| **User Service**     | Node.js + Express + pg | 3001 | Registration, Login, JWT issuance           |
| **Task Service**     | Node.js + Express + pg | 3002 | Task CRUD operations; sends notifications   |
| **Notification Svc** | Node.js + Express + pg | 3003 | Logs all events to DB; audit trail          |
| **PostgreSQL**       | PostgreSQL 16 Alpine   | 5432 | Single shared database for all services     |

### How They Are Connected

- **Frontend ↔ Nginx**: React app is compiled to static files and served by Nginx.
- **Nginx ↔ API Gateway**: Nginx proxies all `/api/*` requests to the API Gateway container via Docker's internal DNS (`api-gateway:3000`).
- **API Gateway ↔ Microservices**: The gateway uses `http-proxy-middleware` to forward requests to the appropriate backend service using Docker internal hostnames (`user-svc`, `task-svc`, `notification-svc`).
- **Task Service ↔ Notification Service**: The task service calls the notification service directly via HTTP (`axios.post`) whenever a task is created, updated, or deleted.
- **All Services ↔ PostgreSQL**: User, Task, and Notification services all connect to the **same single PostgreSQL container** using `node-postgres` (`pg`) connection pools, via the `DB_HOST=postgres` Docker DNS name.

---

## 2. Request Flow (VERY IMPORTANT)

### Flow A: User Registration

```
Browser (http://localhost)
  │
  ▼
[Nginx] receives POST /api/users/register
  │  (nginx.conf: location /api/ → proxy_pass http://api-gateway:3000)
  ▼
[API Gateway] :3000
  │  Route: app.use('/api/users', createProxyMiddleware({target: USER_SVC_URL}))
  │  Path rewritten: /api/users/register → /register
  │  ⚠ No JWT check for /api/users/register (whitelisted)
  ▼
[User Service] :3001 → POST /register
  │  1. Validate: username, email, password required
  │  2. bcrypt.hash(password, 10) — bcrypt with salt rounds 10
  │  3. INSERT INTO users (...) RETURNING id, username, email, created_at
  │  4. On duplicate: PostgreSQL error code 23505 → HTTP 409
  ▼
Response: { message: 'User registered', user: { id, username, email, created_at } }
```

---

### Flow B: User Login

```
Browser → POST /api/users/login  { email, password }
  │
  ▼
[Nginx] proxies → [API Gateway] :3000
  │  /api/users/login → whitelisted (no JWT check)
  ▼
[User Service] :3001 → POST /login
  │  1. SELECT * FROM users WHERE email = $1
  │  2. If not found → 401 'Invalid credentials'
  │  3. bcrypt.compare(password, user.password)
  │  4. If invalid → 401 'Invalid credentials'
  │  5. jwt.sign({ id, username, email }, JWT_SECRET, { expiresIn: '24h' })
  ▼
Response: { message: 'Login successful', token: '<JWT>', user: { id, username, email } }
  │
  ▼
[Frontend] stores token → localStorage.getItem('token')
  └── All future requests: Authorization: Bearer <token>
```

---

### Flow C: Create a Task (Protected Route)

```
Browser → POST /api/tasks  { title, description, priority }
  Headers: Authorization: Bearer <JWT>
  │
  ▼
[Nginx] proxies → [API Gateway] :3000
  │
  ▼
[API Gateway] authenticate() middleware runs:
  │  1. Checks path: NOT /api/users/register or /api/users/login
  │  2. Extracts token from Authorization header
  │  3. jwt.verify(token, JWT_SECRET) → decodes { id, username, email }
  │  4. Attaches to req.user
  │  5. If invalid → 401 immediately (request NEVER reaches task-svc)
  │
  │  Path rewritten: /api/tasks → /tasks (task-svc prefix)
  ▼
[Task Service] :3002 → POST /tasks
  │  1. authenticate() middleware ALSO runs (second JWT check, defense-in-depth)
  │  2. Validate: title required
  │  3. INSERT INTO tasks (title, description, priority, user_id) RETURNING *
  │  4. await notify('task_created', { taskId, title, userId })
  │     └── axios.post('http://notification-svc:3003/notify', { event, payload })
  │         └── [Notification Service] :3003 → POST /notify
  │               INSERT INTO notifications (event, payload) VALUES (...)
  │
  ▼
Response: Full task object { id, title, description, status, priority, user_id, created_at, updated_at }
```

---

### Flow D: Get All Tasks

```
Browser → GET /api/tasks
  Headers: Authorization: Bearer <JWT>
  │
  [API Gateway] → validates JWT → proxies to task-svc /tasks
  │
  [Task Service] authenticate() → SELECT * FROM tasks WHERE user_id = $1
  │  (User sees ONLY their own tasks — row-level isolation via user_id filter)
  ▼
Response: Array of task objects
```

---

### Flow E: Update a Task

```
Browser → PUT /api/tasks/:id  { status: 'in_progress' }
  │
  [API Gateway] → JWT validation → proxy to task-svc /tasks/:id
  │
  [Task Service] → UPDATE tasks SET ... WHERE id = $1 AND user_id = $2
  │  (user_id check prevents cross-user tampering)
  │  → notify('task_updated', { taskId, title, status, userId })
  ▼
Response: Updated task object
```

---

## 3. API Structure

### API Gateway Routes (Public Entry Points)

All requests must go through `http://localhost:3000` (or `http://localhost` via nginx proxy).

| Gateway Path               | Method   | Auth Required | Forwarded To             | Rewritten Path          |
|----------------------------|----------|---------------|--------------------------|-------------------------|
| `GET  /health`             | GET      | ❌ No          | Gateway itself           | —                       |
| `POST /api/users/register` | POST     | ❌ No          | user-svc:3001            | `/register`             |
| `POST /api/users/login`    | POST     | ❌ No          | user-svc:3001            | `/login`                |
| `GET  /api/users/users/:id`| GET      | ✅ Yes (JWT)   | user-svc:3001            | `/users/:id`            |
| `GET  /api/tasks`          | GET      | ✅ Yes (JWT)   | task-svc:3002            | `/tasks`                |
| `POST /api/tasks`          | POST     | ✅ Yes (JWT)   | task-svc:3002            | `/tasks`                |
| `GET  /api/tasks/:id`      | GET      | ✅ Yes (JWT)   | task-svc:3002            | `/tasks/:id`            |
| `PUT  /api/tasks/:id`      | PUT      | ✅ Yes (JWT)   | task-svc:3002            | `/tasks/:id`            |
| `DELETE /api/tasks/:id`    | DELETE   | ✅ Yes (JWT)   | task-svc:3002            | `/tasks/:id`            |
| `GET  /api/notifications`  | GET      | ✅ Yes (JWT)   | notification-svc:3003    | `/notifications`        |

### Internal Service Endpoints (Not exposed externally)

| Service              | Endpoint              | Method | Description                         |
|----------------------|-----------------------|--------|-------------------------------------|
| User Service         | `/health`             | GET    | Docker health check                 |
| User Service         | `/register`           | POST   | Create user account                 |
| User Service         | `/login`              | POST   | Authenticate and return JWT         |
| User Service         | `/users/:id`          | GET    | Fetch user by ID (for other svcs)   |
| Task Service         | `/health`             | GET    | Docker health check                 |
| Task Service         | `/tasks`              | GET    | List authenticated user's tasks     |
| Task Service         | `/tasks`              | POST   | Create task                         |
| Task Service         | `/tasks/:id`          | GET    | Get one task (ownership enforced)   |
| Task Service         | `/tasks/:id`          | PUT    | Update task (ownership enforced)    |
| Task Service         | `/tasks/:id`          | DELETE | Delete task (ownership enforced)    |
| Notification Service | `/health`             | GET    | Docker health check                 |
| Notification Service | `/notify`             | POST   | Receive and persist event logs      |
| Notification Service | `/notifications`      | GET    | Return last 100 notification logs   |

### How Routing Works

```
User Request URL  →  Nginx  →  API Gateway  →  Path Rewrite  →  Target Service
/api/users/login  →  :3000  →    pathRewrite '^/api/users' = ''  →  user-svc:3001/login
/api/tasks        →  :3000  →    pathRewrite '^/api/tasks' = '/tasks'  →  task-svc:3002/tasks
/api/notifications→  :3000  →    pathRewrite '^/api/notifications' = '/notifications'  →  notification-svc:3003/notifications
```

**Key design:** The API Gateway uses `pathRewrite` to strip the gateway-specific prefix before forwarding. This means services have no knowledge of the `/api/*` prefix—each service only sees its own internal paths like `/tasks`, `/register`, `/notify`.

---

## 4. Database Flow

### Database Used

**PostgreSQL 16 (Alpine)** — a single shared instance for all microservices.

> **Architecture Note:** In production microservices, each service typically has its own database. Here, a single PostgreSQL instance is used with separate tables — this is a pragmatic choice for simpler deployments.

### Connection Pattern

Each backend service (User, Task, Notification) uses `node-postgres` (`pg`) with a **connection pool**:

```javascript
// db.js (same pattern in all 3 services)
const pool = new Pool({
  host: process.env.DB_HOST,    // 'postgres' (Docker DNS)
  port: process.env.DB_PORT,    // 5432
  database: process.env.DB_NAME,// 'devops_tasks'
  user: process.env.DB_USER,    // 'postgres'
  password: process.env.DB_PASSWORD,
});
```

The connection pool handles connection reuse and concurrency automatically.

### Database Initialization

The DB schema is created in **two ways** (idempotent):

1. **`docker-init.sql`** — Mounted at `/docker-entrypoint-initdb.d/init.sql`. PostgreSQL automatically runs this when the container first starts. Creates all tables and indexes upfront.
2. **`CREATE TABLE IF NOT EXISTS`** — Each service also runs `initDB()` on startup, so they self-heal if the table wasn't created by the SQL script.

### Tables

#### `users` (owned by User Service)

```sql
CREATE TABLE IF NOT EXISTS users (
  id         SERIAL PRIMARY KEY,
  username   VARCHAR(100) UNIQUE NOT NULL,   -- must be unique
  email      VARCHAR(150) UNIQUE NOT NULL,   -- must be unique (login key)
  password   VARCHAR(255) NOT NULL,           -- bcrypt hash (never plain text)
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

- **Purpose:** Stores registered accounts.
- **Security:** Passwords stored as bcrypt hash (10 salt rounds).
- **Constraints:** `UNIQUE` on `username` and `email`; triggers 409 on duplicate.

---

#### `tasks` (owned by Task Service)

```sql
CREATE TABLE IF NOT EXISTS tasks (
  id          SERIAL PRIMARY KEY,
  title       VARCHAR(255) NOT NULL,
  description TEXT,
  status      VARCHAR(50)  DEFAULT 'pending',    -- pending | in_progress | done
  priority    VARCHAR(20)  DEFAULT 'medium',      -- low | medium | high
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_tasks_user_id ON tasks(user_id);
CREATE INDEX idx_tasks_status  ON tasks(status);
```

- **Purpose:** Stores task data. Each task is **owned by a user** (`user_id` FK).
- **Row-Level Security (app-level):** All queries include `WHERE user_id = $req.user.id` — a user can never read or modify another user's tasks.
- **CASCADE DELETE:** If a user is deleted, their tasks are automatically deleted.
- **Indexes:** `user_id` index speeds up per-user task queries; `status` index speeds up status-based filtering.

---

#### `notifications` (owned by Notification Service)

```sql
CREATE TABLE IF NOT EXISTS notifications (
  id         SERIAL PRIMARY KEY,
  event      VARCHAR(100) NOT NULL,   -- e.g. 'task_created', 'task_deleted'
  payload    JSONB,                    -- flexible JSON blob
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_notif_event      ON notifications(event);
CREATE INDEX idx_notif_created_at ON notifications(created_at DESC);
```

- **Purpose:** Audit log / event trail for every task mutation.
- **JSONB:** Payload is stored as binary JSON, enabling future JSON-based querying.
- **Events logged:** `task_created`, `task_updated`, `task_deleted`

---

### Data Flow Diagram

```
Register user:      Browser → user-svc → INSERT users
Login:              Browser → user-svc → SELECT users WHERE email → verify hash
Create task:        Browser → task-svc → INSERT tasks → notify → INSERT notifications
Get tasks:          Browser → task-svc → SELECT tasks WHERE user_id
Update task:        Browser → task-svc → UPDATE tasks WHERE id AND user_id → INSERT notifications
Delete task:        Browser → task-svc → DELETE tasks WHERE id AND user_id → INSERT notifications
View notif logs:    Browser → notification-svc → SELECT notifications LIMIT 100
```

---

## 5. Service Communication

### Communication Pattern

| Communication Path                | Protocol     | Method    | Library           |
|-----------------------------------|--------------|-----------|-------------------|
| Browser → Nginx                   | HTTP/HTTPS   | REST      | Browser fetch/Axios |
| Nginx → API Gateway               | HTTP          | Reverse Proxy | nginx proxy_pass |
| API Gateway → User/Task/Notif Svc | HTTP          | HTTP Proxy | `http-proxy-middleware` |
| Task Service → Notification Svc   | HTTP          | REST POST  | `axios`           |
| Services → PostgreSQL             | TCP           | SQL       | `node-postgres` (pg) |

### How the API Gateway Proxies

The gateway uses **`http-proxy-middleware`** — it acts as a transparent HTTP reverse proxy. When a request comes in for `/api/tasks`, it:

1. Runs `authenticate()` middleware (JWT check)
2. Creates a new HTTP request to `http://task-svc:3002/tasks`
3. Streams the response back to the client

The gateway **does not parse or modify the request body** — it passes it through transparently (except path rewriting).

### Task → Notification: Fire-and-Forget

```javascript
// task-service/index.js
async function notify(event, payload) {
  try {
    await axios.post(`${NOTIFICATION_SERVICE_URL}/notify`, { event, payload });
  } catch (err) {
    console.warn('Notification delivery failed:', err.message);
    // ⚠ Failure is SILENTLY IGNORED — task operation still succeeds
  }
}
```

**Key design decisions:**
- **Non-blocking:** If notification service is down, tasks still work (warn, don't fail).
- **Synchronous but wrapped in try/catch:** It's `await`-ed but errors are swallowed.
- **No message queue (e.g., RabbitMQ/Kafka):** This is a direct HTTP call, not event-driven. In production, this should ideally be a queue for guaranteed delivery.

---

## 6. Authentication Flow

### How Login Works

```
1. Client sends: POST /api/users/login { email, password }
2. User Service: SELECT * FROM users WHERE email = $1
3. bcrypt.compare(plainPassword, storedHash) → boolean
4. On success: jwt.sign({ id, username, email }, JWT_SECRET, { expiresIn: '24h' })
5. Returns: { token: "eyJhbG...", user: { id, username, email } }
6. Client: localStorage.setItem('token', token)
```

### JWT Token Structure

The JWT payload (decoded) contains:

```json
{
  "id": 1,
  "username": "john",
  "email": "john@example.com",
  "iat": 1720000000,
  "exp": 1720086400
}
```

- **`iat`** — Issued At timestamp
- **`exp`** — Expiry timestamp (24h from issue)
- **Signed with** `JWT_SECRET` — must be the **same across all 3 services** (gateway, user-svc, task-svc)

### Token Validation (Double Validation)

```
Layer 1: API Gateway
  authenticate() → jwt.verify(token, JWT_SECRET)
  ✅ Valid: req.user = decoded payload, request forwarded
  ❌ Invalid: HTTP 401 returned immediately

Layer 2: Task Service
  authenticate() → jwt.verify(token, JWT_SECRET)  [same check again]
  ✅ Valid: req.user available for user_id filtering in queries
  ❌ Invalid: HTTP 401
```

**Why double validation?** Defense-in-depth. If the task service is ever exposed directly (port 3002 is open to host!), it still protects itself independently.

### How Protected Routes Work

```javascript
// api-gateway/index.js
app.use('/api/users', createProxyMiddleware({ ... }));         // NO auth (open)
app.use('/api/tasks', authenticate, createProxyMiddleware({...})); // ✅ JWT required
app.use('/api/notifications', authenticate, createProxyMiddleware({...})); // ✅ JWT required
```

- **Public routes:** `/api/users/register`, `/api/users/login` — explicitly whitelisted in `authenticate()` using `req.path.startsWith(...)`.
- **Protected routes:** `/api/tasks/*`, `/api/notifications/*` — `authenticate` middleware runs before the proxy.

### Frontend Token Attachment

```javascript
// frontend/src/api.js
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});
```

Axios interceptor automatically adds `Authorization: Bearer <token>` to every outgoing API request. This is centralized — no component needs to manually attach the header.

---

## 7. Important Files Explanation

### Root Level

```
devops-task-manager/
├── docker-compose.yml     ← Defines all 6 containers, networks, volumes, env vars
├── docker-init.sql        ← SQL run by PostgreSQL on first container start (schema creation)
├── init.sql               ← Manual/dev alternative to docker-init.sql (includes CREATE DATABASE)
├── .dockerignore          ← Excludes node_modules, .env, .git from Docker build context
├── README.md              ← Setup and usage guide
├── DOCUMENTATION.md       ← Detailed API and architecture docs
└── RUNBOOK.md             ← Operational runbook (troubleshooting, scaling)
```

---

### `docker-compose.yml`

The **master orchestration file**. Defines:
- **6 services:** postgres, notification-svc, user-svc, task-svc, api-gateway, frontend
- **Startup order via `depends_on`:** postgres → notification-svc → user-svc → task-svc → api-gateway → frontend
- **Health checks:** Each service has `/health` endpoint polled by Docker every 15s
- **`condition: service_healthy`:** Services only start when their dependency is healthy (not just running)
- **2 Docker networks:** `backend` (internal) and `frontend` (connects nginx → gateway)
- **1 named volume:** `postgres_data` (persists DB across restarts)

---

### `api-gateway/index.js`

The **single entry point** for all API traffic. Key responsibilities:
- **CORS:** `app.use(cors())` — allows cross-origin requests from frontend
- **JWT Authentication Middleware:** `authenticate()` — validates Bearer tokens
- **`/health` endpoint:** Returns gateway status + known service URLs
- **3 proxy routes:** Uses `http-proxy-middleware` with `pathRewrite` for routing
- **Error forwarding:** 502 Bad Gateway if a downstream service is unreachable

---

### `user-service/index.js`

Handles **all user identity operations**:
- `initDB()` — Creates `users` table on startup
- `POST /register` — Hashes password with bcrypt, inserts user, returns 409 on duplicate
- `POST /login` — Queries by email, compares bcrypt hash, issues JWT
- `GET /users/:id` — For internal use by other services to look up a user

---

### `task-service/index.js`

The **core business logic service**:
- `initDB()` — Creates `tasks` table on startup
- `authenticate()` — Local JWT validation (second layer of defense)
- `notify(event, payload)` — Fire-and-forget HTTP call to notification-svc
- **All task CRUD routes** (`GET`, `POST`, `PUT`, `DELETE`) with user ownership enforcement
- Every mutating operation (create/update/delete) triggers a notification event

---

### `notification-service/index.js`

An **event logger / audit trail** service:
- `initDB()` — Creates `notifications` table on startup
- `POST /notify` — Receives event name + JSONB payload, persists to DB
- `GET /notifications` — Returns last 100 logged events (sorted DESC)
- No authentication on internal `/notify` (intended for internal service calls only)

---

### `user-service/db.js` (same pattern in all 3 services)

**Database connection pool factory**:
- Creates a `pg.Pool` using environment variables
- Logs connection and error events
- Exported as a singleton module — the same pool instance is reused across all route handlers
- Connection pooling means multiple requests can share DB connections efficiently

---

### `frontend/src/api.js`

**Axios HTTP client singleton** for the React app:
- Sets `baseURL: '/api'` — all calls are relative to the nginx proxy path
- Axios request interceptor auto-attaches the JWT from `localStorage`
- Centralizes auth token management — no duplication across components

---

### `frontend/nginx.conf`

**Nginx configuration** for the frontend container:
- Serves React static files from `/usr/share/nginx/html`
- **Proxy rule:** `location /api/ → proxy_pass http://api-gateway:3000` — bridges frontend network to backend
- **SPA fallback:** `try_files $uri $uri/ /index.html` — enables React Router client-side routing
- **Static asset caching:** `.js`, `.css`, etc. cached for 1 year with `Cache-Control: public, immutable`
- **Gzip compression:** Reduces response size for text-based assets

---

### `frontend/Dockerfile`

**Multi-stage build** for optimal image size:
- **Stage 1 (builder):** `node:18-alpine` — runs `npm install` + `npm run build` → outputs `/app/dist`
- **Stage 2 (runtime):** `nginx:1.25-alpine` — copies only the built static files + nginx config
- Result: A tiny production image (~30MB) with no Node.js runtime

---

### `api-gateway/Dockerfile` (same pattern for all Node.js services)

**2-stage Node.js build:**
- **Stage 1 (deps):** Installs only production dependencies (`--omit=dev`)
- **Stage 2 (runtime):** Copies `node_modules` + source, exposes port, runs `node index.js`

---

## 8. DevOps Perspective

### Containers Needed

| Container Name       | Base Image           | Dockerfile Location          | Port (host:container) |
|----------------------|----------------------|------------------------------|-----------------------|
| `dtm-postgres`       | `postgres:16-alpine` | *(official image, no custom Dockerfile)* | 5432:5432 |
| `dtm-notification`   | `node:18-alpine`     | `notification-service/Dockerfile` | 3003:3003 |
| `dtm-user`           | `node:18-alpine`     | `user-service/Dockerfile`    | 3001:3001 |
| `dtm-task`           | `node:18-alpine`     | `task-service/Dockerfile`    | 3002:3002 |
| `dtm-gateway`        | `node:18-alpine`     | `api-gateway/Dockerfile`     | 3000:3000 |
| `dtm-frontend`       | `node:18-alpine` → `nginx:1.25-alpine` | `frontend/Dockerfile` | 80:80 |

**Total: 5 Dockerfiles + 1 official image = 6 containers**

---

### How Many Dockerfiles Are Needed

**5 Dockerfiles** — one per service (postgres uses the official image without customization):

```
api-gateway/Dockerfile          ← 2-stage Node.js (deps + runtime)
user-service/Dockerfile         ← 2-stage Node.js (deps + runtime)
task-service/Dockerfile         ← 2-stage Node.js (deps + runtime)
notification-service/Dockerfile ← 2-stage Node.js (deps + runtime)
frontend/Dockerfile             ← 2-stage (Node build → nginx serve)
```

---

### What Goes Into `docker-compose.yml`

```yaml
# Already implemented — summary of what's configured:

services:
  postgres:            # DB — uses healthcheck, mounts init SQL, persists via named volume
  notification-svc:    # Starts AFTER postgres is healthy
  user-svc:            # Starts AFTER postgres is healthy
  task-svc:            # Starts AFTER postgres is healthy AND notification-svc is healthy
  api-gateway:         # Starts AFTER user-svc, task-svc, notification-svc are ALL healthy
  frontend:            # Starts AFTER api-gateway is healthy

networks:
  backend:   bridge    # Internal: postgres, notification, user, task, gateway
  frontend:  bridge    # External edge: frontend (nginx) ↔ api-gateway

volumes:
  postgres_data: local # Persists PostgreSQL data directory across restarts
```

**Startup guarantee chain:**
```
postgres (healthy) 
  → notification-svc (healthy) + user-svc (healthy) 
    → task-svc (healthy) 
      → api-gateway (healthy) 
        → frontend
```

---

### Environment Variables

#### PostgreSQL

| Variable            | Value          | Description                       |
|---------------------|----------------|-----------------------------------|
| `POSTGRES_USER`     | `postgres`     | DB superuser username             |
| `POSTGRES_PASSWORD` | `postgres`     | ⚠ Change in production!           |
| `POSTGRES_DB`       | `devops_tasks` | Auto-created database name        |

#### User Service, Task Service, Notification Service (shared DB vars)

| Variable       | Value          | Description                          |
|----------------|----------------|--------------------------------------|
| `PORT`         | `3001/3002/3003` | Service listening port              |
| `DB_HOST`      | `postgres`     | Docker DNS name of the DB container  |
| `DB_PORT`      | `5432`         | PostgreSQL port                      |
| `DB_NAME`      | `devops_tasks` | Database name                        |
| `DB_USER`      | `postgres`     | DB username                          |
| `DB_PASSWORD`  | `postgres`     | DB password                          |
| `JWT_SECRET`   | `supersecretjwtkey123` | ⚠ **MUST be identical** across user-svc, task-svc, api-gateway |

#### Task Service (extra)

| Variable                  | Value                            | Description                       |
|---------------------------|----------------------------------|-----------------------------------|
| `NOTIFICATION_SERVICE_URL`| `http://notification-svc:3003`   | Internal URL to notify service    |

#### API Gateway

| Variable                  | Value                        | Description                       |
|---------------------------|------------------------------|-----------------------------------|
| `JWT_SECRET`              | `supersecretjwtkey123`       | ⚠ Must match user-svc & task-svc  |
| `USER_SERVICE_URL`        | `http://user-svc:3001`       | Proxy target for /api/users       |
| `TASK_SERVICE_URL`        | `http://task-svc:3002`       | Proxy target for /api/tasks       |
| `NOTIFICATION_SERVICE_URL`| `http://notification-svc:3003`| Proxy target for /api/notifications|

---

### Production Security Recommendations

> ⚠ The following are **development defaults** that MUST be changed before going to production:

1. **`JWT_SECRET`** — Replace `supersecretjwtkey123` with a cryptographically random 256-bit secret.
   ```bash
   openssl rand -hex 32
   ```
2. **`DB_PASSWORD`** — Replace `postgres` with a strong password; use Docker secrets or a secrets manager.
3. **Port Exposure** — In production:
   - Close ports 3001, 3002, 3003 (only the gateway should be externally accessible)
   - Only expose port 80 (nginx) and optionally 3000 (gateway)
   - Do NOT expose port 5432 (PostgreSQL) to the public internet
4. **HTTPS** — Add TLS termination at nginx or a load balancer (e.g., Traefik, Caddy, AWS ALB).
5. **`DATABASE_URL`** — Consider switching to a managed DB (AWS RDS, Supabase) instead of containerized Postgres.
6. **`.env` files** — Never commit `.env` to git. Use `.env.example` + environment injection via CI/CD.

---

### Quick Commands Reference

```bash
# Build and start all services
docker compose up --build

# Run in detached (background) mode
docker compose up -d

# View logs for a specific service
docker compose logs -f task-svc

# Stop all services and remove volumes
docker compose down -v

# Rebuild only one service
docker compose up --build task-svc

# Access PostgreSQL directly
docker exec -it dtm-postgres psql -U postgres -d devops_tasks

# Check health of all containers
docker compose ps

# Scale a service (e.g., run 3 task-svc replicas)
docker compose up --scale task-svc=3
```

---

*End of Architecture Document — DevOps Task Manager*
