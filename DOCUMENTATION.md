# 📖 DevOps Task Manager — Technical Documentation

> Deep-dive explanation of the system design, code structure, and data flows.  
> Intended for DevOps engineers, developers, or anyone maintaining this project.

---

## Table of Contents

1. [System Design Decisions](#1-system-design-decisions)
2. [Service Internals](#2-service-internals)
   - [API Gateway](#api-gateway)
   - [User Service](#user-service)
   - [Task Service](#task-service)
   - [Notification Service](#notification-service)
3. [Database Design](#3-database-design)
4. [Authentication Flow](#4-authentication-flow)
5. [Service-to-Service Communication](#5-service-to-service-communication)
6. [Frontend Architecture](#6-frontend-architecture)
7. [Data Flow — End to End](#7-data-flow--end-to-end)
8. [Error Handling Strategy](#8-error-handling-strategy)
9. [Environment Variable Reference](#9-environment-variable-reference)
10. [Known Limitations & Improvement Ideas](#10-known-limitations--improvement-ideas)

---

## 1. System Design Decisions

### Why Microservices?
Each service owns exactly one responsibility:
- **User Service** → identity only
- **Task Service** → task data only
- **Notification Service** → event log only
- **API Gateway** → routing + security only

This means services can be deployed, scaled, or replaced independently.

### Why a Shared Database?
For simplicity in local development, all services share the same PostgreSQL instance (`devops_tasks` DB) but use **separate tables**. In production, each service would ideally own its own DB schema or instance.

### Why JWT over Sessions?
JWT is stateless — the gateway can validate tokens without talking to the User Service on every request. Tokens expire in 24 hours and are stored in the browser's `localStorage`.

### Why `http-proxy-middleware`?
The gateway acts as a **transparent reverse proxy**. Services don't need to be aware of each other — only the gateway knows their URLs. The `pathRewrite` option strips the `/api/tasks` prefix so the Task Service receives clean `/tasks` paths.

---

## 2. Service Internals

### API Gateway

**File:** `api-gateway/index.js`  
**Port:** `3000`

The gateway is the **only service exposed to the client**. It:

1. Runs a JWT `authenticate` middleware on all routes **except** `/api/users/register` and `/api/users/login`
2. Proxies requests using `http-proxy-middleware` with path rewriting:

```
/api/users/*        →  http://localhost:3001/*       (no JWT check)
/api/tasks/*        →  http://localhost:3002/tasks/* (JWT required)
/api/notifications/*→  http://localhost:3003/*       (JWT required)
```

3. Returns `502 Bad Gateway` if a downstream service is unreachable
4. Exposes a `/health` endpoint listing all configured service URLs

**Key code pattern:**
```js
app.use('/api/tasks', authenticate, createProxyMiddleware({
  target: process.env.TASK_SERVICE_URL,
  pathRewrite: { '^/api/tasks': '/tasks' }
}));
```

---

### User Service

**File:** `user-service/index.js`  
**Port:** `3001`

Handles all user identity operations.

#### Register (`POST /register`)
1. Validates `username`, `email`, `password` are present
2. Hashes password with `bcrypt` (10 salt rounds)
3. Inserts into `users` table
4. Returns the new user object (without password)
5. Returns `409 Conflict` if username/email already exists (`pg` error code `23505`)

#### Login (`POST /login`)
1. Finds user by `email`
2. Compares submitted password against stored hash using `bcrypt.compare()`
3. Signs a JWT with `{ id, username, email }` payload, 24h expiry
4. Returns `{ token, user }` on success

#### Get User (`GET /users/:id`)
Internal-use route for other services to fetch user details by ID. No auth required.

#### DB Init
On startup, runs `CREATE TABLE IF NOT EXISTS users (...)`. This means the DB just needs to **exist** — the schema is self-healing.

---

### Task Service

**File:** `task-service/index.js`  
**Port:** `3002`

Handles all task CRUD and triggers notifications.

#### Auth Middleware (local copy)
The Task Service re-validates the JWT itself — it does not trust the gateway to have already verified it. This provides **defence in depth**: even if the gateway is bypassed, tasks are still protected.

```js
function authenticate(req, res, next) {
  req.user = jwt.verify(token, process.env.JWT_SECRET);
  next();
}
```

#### Notify Helper
After every mutating operation, a fire-and-forget function posts to the Notification Service:

```js
async function notify(event, payload) {
  try {
    await axios.post(`${process.env.NOTIFICATION_SERVICE_URL}/notify`, { event, payload });
  } catch (err) {
    console.warn('Notification delivery failed:', err.message);
    // Failure is non-fatal — task operation still succeeds
  }
}
```

> Notification failure **does not fail the task operation**. It logs a warning and continues.

#### Task Ownership
Every query includes `AND user_id = $N` to ensure users can only see and modify their own tasks. A user cannot access tasks belonging to another user even if they know the task ID.

#### Partial Updates (`PUT /tasks/:id`)
Uses `COALESCE` so only provided fields are updated:
```sql
SET title = COALESCE($1, title),
    status = COALESCE($3, status),
    ...
```
This means you can update only the status without touching the title.

---

### Notification Service

**File:** `notification-service/index.js`  
**Port:** `3003`

A simple event logger. Receives structured events and stores them.

#### POST `/notify` (Internal)
Called by Task Service. Stores the event name and a flexible `JSONB` payload:

```json
{
  "event": "task_created",
  "payload": { "taskId": 12, "title": "Deploy to prod", "userId": 3 }
}
```

The `JSONB` column means the payload structure is flexible — different events can carry different data without a schema change.

#### GET `/notifications`
Returns the last 100 events ordered newest-first. Exposed via the gateway at `/api/notifications` (JWT protected).

> **Note:** This endpoint is NOT protected internally. Protection is handled entirely by the API Gateway. The internal `POST /notify` route is also unprotected — it is **not** exposed through the gateway, only reachable service-to-service on the internal network.

---

## 3. Database Design

All three services connect to the same database using a shared `pg.Pool`. Tables are created independently by each service.

### `users` table
```sql
id          SERIAL PRIMARY KEY
username    VARCHAR(100) UNIQUE NOT NULL
email       VARCHAR(150) UNIQUE NOT NULL
password    VARCHAR(255) NOT NULL          -- bcrypt hash
created_at  TIMESTAMPTZ DEFAULT NOW()
```

### `tasks` table
```sql
id           SERIAL PRIMARY KEY
title        VARCHAR(255) NOT NULL
description  TEXT
status       VARCHAR(50) DEFAULT 'pending'   -- pending | in_progress | done
priority     VARCHAR(20) DEFAULT 'medium'    -- low | medium | high
user_id      INTEGER NOT NULL               -- references users(id) in init.sql only
created_at   TIMESTAMPTZ DEFAULT NOW()
updated_at   TIMESTAMPTZ DEFAULT NOW()
```

> `user_id` is a foreign key in `init.sql` (`REFERENCES users(id) ON DELETE CASCADE`) but not enforced in the service's `CREATE TABLE IF NOT EXISTS` — this is a trade-off for service independence.

### `notifications` table
```sql
id          SERIAL PRIMARY KEY
event       VARCHAR(100) NOT NULL           -- event name
payload     JSONB                           -- flexible event data
created_at  TIMESTAMPTZ DEFAULT NOW()
```

### Indexes
```sql
idx_tasks_user_id     ON tasks(user_id)       -- fast user task lookups
idx_tasks_status      ON tasks(status)        -- filter by status
idx_notif_event       ON notifications(event) -- filter by event type
idx_notif_created_at  ON notifications(created_at DESC)  -- sort by recency
```

---

## 4. Authentication Flow

```
[1] User submits email + password to POST /api/users/login
         │
         ▼
[2] API Gateway proxies to User Service (no JWT check on login)
         │
         ▼
[3] User Service: bcrypt.compare(password, stored_hash)
         │
         ├─ FAIL → 401 Invalid credentials
         │
         └─ OK  → jwt.sign({ id, username, email }, JWT_SECRET, { expiresIn: '24h' })
                       │
                       ▼
[4] Token returned to browser → stored in localStorage

[5] Subsequent requests:
    Authorization: Bearer <token>
         │
         ▼
[6] API Gateway: jwt.verify(token, JWT_SECRET)
         │
         ├─ FAIL → 401 (not forwarded)
         │
         └─ OK  → forward request to service
                       │
                       ▼
[7] Task Service also verifies JWT independently (defence in depth)
    req.user = { id, username, email }
    All queries scoped: WHERE user_id = req.user.id
```

**Token expiry:** 24 hours. The frontend decodes the token payload (`atob(token.split('.')[1])`) on page load to check expiry and restore the session — without making a network call.

---

## 5. Service-to-Service Communication

Communication between services is **synchronous HTTP** (using `axios`). There is no message queue in this implementation.

### Task Service → Notification Service

Triggered after: `task_created`, `task_updated`, `task_deleted`

```
Task Service ──POST http://localhost:3003/notify──▶ Notification Service
              { event: "task_created",
                payload: { taskId, title, userId } }
```

This call is:
- **Direct** (bypasses the API Gateway)
- **Non-blocking** if it fails (errors are caught and logged, not thrown)
- **Idempotent from the task's perspective** — the task response is sent after the notification is fired

### Why Not Go Through the Gateway?
Internal service-to-service calls should use direct addresses. Going through the gateway would add latency, require token management between services, and create a circular dependency.

---

## 6. Frontend Architecture

Built with **React 18** and **Vite**, served on port `5173`.

### Vite Dev Proxy
All `/api` requests from the browser are intercepted by Vite and forwarded to the API Gateway:

```js
// vite.config.js
proxy: {
  '/api': { target: 'http://localhost:3000', changeOrigin: true }
}
```

This avoids CORS issues during development and means the frontend only ever talks to one host.

### Component Tree

```
App.jsx
├── Toast System (global)
├── Auth.jsx          (when logged out)
│   ├── Login tab
│   └── Register tab
└── Dashboard.jsx     (when logged in)
    ├── Navbar
    ├── Stats Row      (total / pending / in_progress / done counts)
    ├── Tab: Tasks
    │   ├── AddTaskForm
    │   └── TaskCard[]  (status change dropdown + delete)
    └── Tab: Notifications
        └── NotifPanel  (last 10 events)
```

### State Management
No external state library (Redux, Zustand, etc.). React `useState` is used at the component level:

- `App.jsx` owns `user` state (null = logged out)
- `Dashboard.jsx` owns `tasks[]` array
- `TaskCard` owns its local `status` state for optimistic UI

### Session Persistence
On page load, `App.jsx` reads `localStorage.getItem('token')`, parses the JWT payload, checks `exp`, and re-hydrates the user session. No server call is made for session restore.

### Axios Interceptor
`api.js` attaches the token automatically to every outgoing request:

```js
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});
```

---

## 7. Data Flow — End to End

### Creating a Task

```
1. User fills form in frontend → clicks "Create Task"
2. React: POST /api/tasks  { title, description, priority }
        (axios attaches Authorization: Bearer <jwt>)

3. Vite proxy → forwards to API Gateway :3000/api/tasks

4. API Gateway:
   - Extracts Bearer token
   - jwt.verify(token)  ✓
   - Proxies → Task Service :3002/tasks

5. Task Service:
   - Re-verifies JWT independently
   - INSERTs into tasks table
   - Calls notify('task_created', { taskId, title, userId })

6. Notification Service:
   - INSERTs into notifications(event, payload)
   - Logs to console
   - Returns 201 to Task Service

7. Task Service → returns 201 + task JSON to Gateway
8. Gateway → returns to Vite proxy
9. Vite → returns to browser
10. React: adds task to UI list, shows success toast
```

### Viewing Notifications

```
1. User clicks Notifications tab
2. React: GET /api/notifications  (with JWT)
3. Vite proxy → Gateway
4. Gateway verifies JWT → proxies → Notification Service
5. Notification Service: SELECT * FROM notifications ORDER BY created_at DESC LIMIT 100
6. Returns array of events to frontend
7. React renders each event: event name + JSON payload + timestamp
```

---

## 8. Error Handling Strategy

| Scenario | Behaviour |
|---|---|
| Missing JWT | Gateway returns `401 No token provided` |
| Expired/invalid JWT | Gateway returns `401 Invalid or expired token` |
| Service down | Gateway returns `502 Bad Gateway` |
| Duplicate username/email | User Service returns `409 Conflict` |
| Task not found or wrong user | Task Service returns `404 Not found` |
| Missing required fields | Services return `400 Bad Request` |
| Notification failure | Task Service logs warning, **task operation still succeeds** |
| DB connection error | Service logs error and exits `process.exit(1)` |

All error responses are JSON: `{ "error": "message" }`.

---

## 9. Environment Variable Reference

| Variable | Used In | Description |
|---|---|---|
| `PORT` | All services | Port the service listens on |
| `DB_HOST` | User, Task, Notification | PostgreSQL host |
| `DB_PORT` | User, Task, Notification | PostgreSQL port (default 5432) |
| `DB_NAME` | User, Task, Notification | Database name (`devops_tasks`) |
| `DB_USER` | User, Task, Notification | PostgreSQL username |
| `DB_PASSWORD` | User, Task, Notification | PostgreSQL password |
| `JWT_SECRET` | API Gateway, User, Task | Shared secret for signing/verifying JWTs |
| `USER_SERVICE_URL` | API Gateway | URL of User Service |
| `TASK_SERVICE_URL` | API Gateway | URL of Task Service |
| `NOTIFICATION_SERVICE_URL` | API Gateway, Task Service | URL of Notification Service |

> `JWT_SECRET` **must be identical** across User Service and any service that verifies tokens (API Gateway, Task Service). A mismatch will cause all requests to fail with `401`.

---

## 10. Known Limitations & Improvement Ideas

### Security
- [ ] `JWT_SECRET` is hardcoded in `.env` — use a secrets manager (Vault, AWS SSM) in production
- [ ] Passwords: bcrypt with 10 rounds is fine; consider argon2 for higher security
- [ ] Rate limiting is not implemented — add `express-rate-limit` to the gateway
- [ ] The internal `POST /notify` endpoint has no auth — fine for a trusted internal network, but add service tokens in production

### Architecture
- [ ] Add a message queue (RabbitMQ, Redis Streams) between Task and Notification services for resilience
- [ ] Add a service registry / health check orchestration (Consul, or simple `/health` polling)
- [ ] Separate DB instances per service for true microservice isolation
- [ ] Add `docker-compose.yml` to spin up all services + PostgreSQL in one command

### Features
- [ ] Password reset flow
- [ ] Task assignment to other users
- [ ] Task due dates / deadlines
- [ ] Real-time updates via WebSockets or SSE (currently requires manual refresh)
- [ ] Pagination for tasks and notifications
- [ ] Task search and filtering

### Observability
- [ ] Structured logging (Winston / pino) instead of `console.log`
- [ ] Distributed tracing (OpenTelemetry)
- [ ] Metrics endpoint (Prometheus format)
- [ ] Centralised log shipping (ELK / Loki)
