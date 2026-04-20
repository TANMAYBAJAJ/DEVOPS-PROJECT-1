# ⚙️ DevOps Task Manager

A lightweight **microservices-based task management system** built for DevOps teams.
Users can register, log in, create and manage tasks, and view a live notification log of every action taken across the system.

---

## 1. Project Overview

| What it does | How |
|---|---|
| User registration & login | JWT-based auth with bcrypt password hashing |
| Task management (CRUD) | Create, read, update, delete tasks per user |
| Status & priority tracking | Status: `pending / in_progress / done` · Priority: `low / medium / high` |
| Notification logging | Every task event is recorded automatically in the DB |
| Web UI | Dark-themed React dashboard accessible at `http://localhost:5173` |

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────┐
│             Browser  (React + Vite :5173)            │
└─────────────────────┬───────────────────────────────┘
                      │  /api/*  (proxied by Vite)
                      ▼
┌─────────────────────────────────────────────────────┐
│              API Gateway  (:3000)                    │
│   • JWT validation on all protected routes          │
│   • Routes requests to the correct service          │
└──────┬───────────────────┬──────────────────┬───────┘
       │                   │                  │
       ▼                   ▼                  ▼
┌────────────┐   ┌───────────────┐   ┌──────────────────────┐
│ User Svc   │   │  Task Svc     │   │  Notification Svc    │
│  (:3001)   │   │   (:3002)     │   │      (:3003)          │
│            │   │               │   │                      │
│ • register │   │ • CRUD tasks  │──▶│ • POST /notify       │
│ • login    │   │ • auth check  │   │ • GET  /notifications│
│ • get user │   │ • fires events│   │ • logs to DB (JSONB) │
└─────┬──────┘   └───────┬───────┘   └──────────┬───────────┘
      │                  │                       │
      └──────────────────┴───────────────────────┘
                         │
              ┌──────────▼──────────┐
              │    PostgreSQL DB     │
              │  (devops_tasks DB)   │
              │  • users table       │
              │  • tasks table       │
              │  • notifications tbl │
              └─────────────────────┘
```

---

## 3. How Services Communicate

### Client → Backend
The React frontend sends all requests to `/api/*`.  
Vite dev server proxies these to the **API Gateway at `:3000`**.

### API Gateway → Services
The gateway validates the JWT token (except `/register` and `/login`), then **reverse-proxies** to the correct service:

| Gateway Route | Forwards To | Auth Required |
|---|---|---|
| `POST /api/users/register` | User Service `:3001/register` | ❌ |
| `POST /api/users/login` | User Service `:3001/login` | ❌ |
| `GET /api/users/:id` | User Service `:3001/users/:id` | ❌ |
| `GET/POST /api/tasks` | Task Service `:3002/tasks` | ✅ JWT |
| `GET/PUT/DELETE /api/tasks/:id` | Task Service `:3002/tasks/:id` | ✅ JWT |
| `GET /api/notifications` | Notification Service `:3003/notifications` | ✅ JWT |

### Task Service → Notification Service
After every create, update, or delete, the Task Service calls `POST http://localhost:3003/notify` **directly** (internal HTTP — does not go through the gateway).

```
Task Service  ──[POST /notify]──▶  Notification Service  ──▶  PostgreSQL
```

Events fired: `task_created`, `task_updated`, `task_deleted`

---

## 4. Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite 4, Axios |
| Styling | Vanilla CSS (dark design system) |
| Backend | Node.js, Express.js |
| Auth | JSON Web Tokens (JWT), bcryptjs |
| Database | PostgreSQL 14+ |
| DB Client | `pg` (node-postgres) |
| Proxy | `http-proxy-middleware` |
| Config | `dotenv` |
| Dev runner | `nodemon` |

---

## 5. Folder Structure

```
devops-task-manager/
│
├── init.sql                    # DB schema + indexes (optional manual run)
├── README.md
│
├── api-gateway/                # Entry point for all client traffic
│   ├── index.js                # JWT guard + http-proxy-middleware routing
│   ├── package.json
│   └── .env
│
├── user-service/               # Handles all user identity logic
│   ├── index.js                # Register, login, get-user routes
│   ├── db.js                   # pg Pool connection setup
│   ├── package.json
│   └── .env
│
├── task-service/               # Task CRUD + notification trigger
│   ├── index.js                # All task routes, JWT middleware, notify()
│   ├── db.js                   # pg Pool connection setup
│   ├── package.json
│   └── .env
│
├── notification-service/       # Event logger (receives & stores events)
│   ├── index.js                # POST /notify + GET /notifications
│   ├── db.js                   # pg Pool connection setup
│   ├── package.json
│   └── .env
│
└── frontend/                   # React SPA
    ├── index.html
    ├── vite.config.js          # Dev proxy: /api → localhost:3000
    ├── package.json
    └── src/
        ├── main.jsx            # React entry point
        ├── App.jsx             # Root: session restore, toast system, routing
        ├── Auth.jsx            # Login / Register form (tab-based)
        ├── Dashboard.jsx       # Task board, stats, notification panel
        ├── api.js              # Axios instance with JWT interceptor
        └── index.css           # Full dark CSS design system
```

---

## 6. Environment Variables

> ⚠️ Change `DB_PASSWORD` and `JWT_SECRET` before running in any shared environment.

### `api-gateway/.env`
```env
PORT=3000
USER_SERVICE_URL=http://localhost:3001
TASK_SERVICE_URL=http://localhost:3002
NOTIFICATION_SERVICE_URL=http://localhost:3003
JWT_SECRET=supersecretjwtkey123
```

### `user-service/.env`
```env
PORT=3001
DB_HOST=localhost
DB_PORT=5432
DB_NAME=devops_tasks
DB_USER=postgres
DB_PASSWORD=yourpassword
JWT_SECRET=supersecretjwtkey123
```

### `task-service/.env`
```env
PORT=3002
DB_HOST=localhost
DB_PORT=5432
DB_NAME=devops_tasks
DB_USER=postgres
DB_PASSWORD=yourpassword
JWT_SECRET=supersecretjwtkey123
NOTIFICATION_SERVICE_URL=http://localhost:3003
```

### `notification-service/.env`
```env
PORT=3003
DB_HOST=localhost
DB_PORT=5432
DB_NAME=devops_tasks
DB_USER=postgres
DB_PASSWORD=yourpassword
```

> The frontend has **no `.env`** — it uses a Vite dev proxy configured in `vite.config.js`.

---

## 7. How to Run Locally

### Prerequisites

- [Node.js v18+](https://nodejs.org)
- [PostgreSQL v14+](https://www.postgresql.org)
- npm v9+

---

### Step 1 — Create the Database

```bash
# Option A: Quick (services auto-create tables on first run)
psql -U postgres -c "CREATE DATABASE devops_tasks;"

# Option B: Full schema with indexes
psql -U postgres -f init.sql
```

---

### Step 2 — Set Your DB Password

Open each `.env` file and replace `yourpassword` with your actual PostgreSQL password:

- `user-service/.env`
- `task-service/.env`
- `notification-service/.env`

Also update `JWT_SECRET` to something secret in all services and the gateway.

---

### Step 3 — Start All Services (5 Terminals)

> **Start Notification Service first** — Task Service calls it on startup events.

```powershell
# Terminal 1 — Notification Service
cd devops-task-manager\notification-service
npm install
npm run dev

# Terminal 2 — User Service
cd devops-task-manager\user-service
npm install
npm run dev

# Terminal 3 — Task Service
cd devops-task-manager\task-service
npm install
npm run dev

# Terminal 4 — API Gateway
cd devops-task-manager\api-gateway
npm install
npm run dev

# Terminal 5 — Frontend
cd devops-task-manager\frontend
npm install
npm run dev
```

---

### Step 4 — Open the App

```
http://localhost:5173
```

1. Click **Register** → create an account
2. Click **Login** → JWT is stored in `localStorage`
3. Create tasks, change status, delete tasks
4. Switch to the **Notifications** tab to see all logged events

---

## 8. API Endpoints

All endpoints are accessed via the **API Gateway at `:3000`**.

### User Service (`/api/users`)

| Method | Endpoint | Auth | Body | Description |
|---|---|---|---|---|
| `POST` | `/api/users/register` | ❌ | `{ username, email, password }` | Register new user |
| `POST` | `/api/users/login` | ❌ | `{ email, password }` | Login, returns JWT |
| `GET` | `/api/users/:id` | ❌ | — | Get user by ID |
| `GET` | `/api/users/health` | ❌ | — | Health check |

### Task Service (`/api/tasks`)

| Method | Endpoint | Auth | Body | Description |
|---|---|---|---|---|
| `GET` | `/api/tasks` | ✅ | — | Get all tasks for logged-in user |
| `POST` | `/api/tasks` | ✅ | `{ title, description?, priority? }` | Create new task |
| `GET` | `/api/tasks/:id` | ✅ | — | Get one task |
| `PUT` | `/api/tasks/:id` | ✅ | `{ title?, description?, status?, priority? }` | Update task (partial) |
| `DELETE` | `/api/tasks/:id` | ✅ | — | Delete task |

### Notification Service (`/api/notifications`)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/notifications` | ✅ | Get last 100 notification events |
| `POST` | `/notify` | Internal only | Called by Task Service (not exposed via gateway) |

### Health Checks (no auth)

```
GET http://localhost:3000/health   → API Gateway
GET http://localhost:3001/health   → User Service
GET http://localhost:3002/health   → Task Service
GET http://localhost:3003/health   → Notification Service
```

---

## 9. Ports

| Service | Port | URL |
|---|---|---|
| Frontend (Vite dev) | **5173** | http://localhost:5173 |
| API Gateway | **3000** | http://localhost:3000 |
| User Service | **3001** | http://localhost:3001 |
| Task Service | **3002** | http://localhost:3002 |
| Notification Service | **3003** | http://localhost:3003 |
| PostgreSQL | **5432** | localhost:5432 |

---

## 10. Dependencies

### Backend Services (each)

| Package | Purpose |
|---|---|
| `express` | HTTP server framework |
| `cors` | Cross-Origin Resource Sharing headers |
| `dotenv` | Load environment variables from `.env` |
| `pg` | PostgreSQL client (connection pool) |
| `nodemon` *(dev)* | Auto-restart on file changes |

### User Service (extra)

| Package | Purpose |
|---|---|
| `bcryptjs` | Password hashing (10 salt rounds) |
| `jsonwebtoken` | Sign and verify JWT tokens |

### Task Service (extra)

| Package | Purpose |
|---|---|
| `jsonwebtoken` | Verify JWT passed through gateway |
| `axios` | HTTP client to call notification service |

### API Gateway (extra)

| Package | Purpose |
|---|---|
| `jsonwebtoken` | Validate JWT before proxying |
| `http-proxy-middleware` | Reverse proxy to backend services |

### Frontend

| Package | Purpose |
|---|---|
| `react`, `react-dom` | UI framework |
| `axios` | HTTP requests to API gateway |
| `vite` | Dev server + build tool |
| `@vitejs/plugin-react` | Vite React integration |

---

## Database Schema (Quick Reference)

```sql
-- Users
users(id, username, email, password, created_at)

-- Tasks
tasks(id, title, description, status, priority, user_id, created_at, updated_at)
  status   → pending | in_progress | done
  priority → low | medium | high

-- Notification Events
notifications(id, event, payload JSONB, created_at)
  event    → task_created | task_updated | task_deleted
```
