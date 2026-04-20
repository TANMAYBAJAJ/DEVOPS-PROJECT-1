# ▶️ Local Run Guide — DevOps Task Manager

> Command-focused. Copy-paste ready. No extra explanation.

---

## Prerequisites — Install These First

| Tool | Version | Check | Download |
|---|---|---|---|
| Node.js | v18+ | `node -v` | https://nodejs.org |
| npm | v9+ | `npm -v` | (bundled with Node) |
| PostgreSQL | v14+ | `psql --version` | https://www.postgresql.org |

---

## Step 0 — Navigate to Project Root

```powershell
cd d:\Devsecops\devops-task-manager
```

---

## Step 1 — PostgreSQL Setup

### 1a. Start PostgreSQL (if not already running)

**Windows (Services):**
```powershell
# Run as Administrator
net start postgresql-x64-14
# adjust service name to match your install, e.g. postgresql-x64-16
```

**Or use pgAdmin / Task Manager to verify it's running.**

---

### 1b. Create the Database

```powershell
psql -U postgres -c "CREATE DATABASE devops_tasks;"
```

Expected output:
```
CREATE DATABASE
```

---

### 1c. (Optional) Load Full Schema with Indexes

```powershell
psql -U postgres -d devops_tasks -f init.sql
```

> Skip this if you want services to auto-create their own tables on startup.

---

### 1d. Verify DB exists

```powershell
psql -U postgres -c "\l" | findstr devops_tasks
```

Expected output:
```
 devops_tasks | postgres | UTF8 ...
```

---

## Step 2 — Set Your DB Password in .env Files

Open each file below and replace `yourpassword` with your actual PostgreSQL password:

```
devops-task-manager\user-service\.env         → DB_PASSWORD=yourpassword
devops-task-manager\task-service\.env         → DB_PASSWORD=yourpassword
devops-task-manager\notification-service\.env → DB_PASSWORD=yourpassword
```

> `JWT_SECRET` is already set. Change it to something custom if needed (must match across all 3 files that use it).

---

## Step 3 — Start Services (Open 5 Separate Terminals)

> **Order matters.** Start Notification Service first — Task Service calls it on every task action.

---

### Terminal 1 — Notification Service (Start FIRST)

```powershell
cd d:\Devsecops\devops-task-manager\notification-service
npm install
npm run dev
```

✅ Success output:
```
[DB] Connected to PostgreSQL
[Notification Service] Notifications table ready
[Notification Service] Running on port 3003
```

---

### Terminal 2 — User Service

```powershell
cd d:\Devsecops\devops-task-manager\user-service
npm install
npm run dev
```

✅ Success output:
```
[DB] Connected to PostgreSQL
[User Service] Users table ready
[User Service] Running on port 3001
```

---

### Terminal 3 — Task Service

```powershell
cd d:\Devsecops\devops-task-manager\task-service
npm install
npm run dev
```

✅ Success output:
```
[DB] Connected to PostgreSQL
[Task Service] Tasks table ready
[Task Service] Running on port 3002
```

---

### Terminal 4 — API Gateway (Start AFTER all 3 services above)

```powershell
cd d:\Devsecops\devops-task-manager\api-gateway
npm install
npm run dev
```

✅ Success output:
```
[API Gateway] Running on port 3000
  → /api/users         → http://localhost:3001
  → /api/tasks         → http://localhost:3002
  → /api/notifications → http://localhost:3003
```

---

### Terminal 5 — Frontend (React + Vite)

```powershell
cd d:\Devsecops\devops-task-manager\frontend
npm install
npm run dev
```

✅ Success output:
```
  VITE v4.x.x  ready in xxx ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: use --host to expose
```

---

## Step 4 — Verify All Services Are Running

Open a new terminal and run these one at a time:

```powershell
# API Gateway
curl http://localhost:3000/health

# User Service (direct)
curl http://localhost:3001/health

# Task Service (direct)
curl http://localhost:3002/health

# Notification Service (direct)
curl http://localhost:3003/health
```

Expected response from each:
```json
{ "status": "ok", "service": "..." }
```

> If `curl` is not available in PowerShell, use:
> ```powershell
> Invoke-WebRequest -Uri http://localhost:3000/health | Select-Object -ExpandProperty Content
> ```

---

## Step 5 — Open the UI

```
http://localhost:5173
```

**What to do:**
1. Click **Register** tab → fill in username, email, password → submit
2. Click **Login** tab → use the same email/password → submit
3. You land on the **Task Board**
4. Fill in a task title → click **🚀 Create Task**
5. Change the status dropdown on a task card
6. Click the **📡 Notifications** tab → see the logged events

---

## Port Reference

| Service | Port | URL |
|---|---|---|
| Frontend | 5173 | http://localhost:5173 |
| API Gateway | 3000 | http://localhost:3000 |
| User Service | 3001 | http://localhost:3001 |
| Task Service | 3002 | http://localhost:3002 |
| Notification Service | 3003 | http://localhost:3003 |
| PostgreSQL | 5432 | localhost:5432 |

---

## Quick API Test (After Login)

### Register a user
```powershell
curl -X POST http://localhost:3000/api/users/register `
  -H "Content-Type: application/json" `
  -d '{"username":"devops1","email":"devops@test.com","password":"test1234"}'
```

### Login and get token
```powershell
curl -X POST http://localhost:3000/api/users/login `
  -H "Content-Type: application/json" `
  -d '{"email":"devops@test.com","password":"test1234"}'
```

Copy the `token` value from the response, then:

### Create a task (replace TOKEN)
```powershell
curl -X POST http://localhost:3000/api/tasks `
  -H "Content-Type: application/json" `
  -H "Authorization: Bearer TOKEN" `
  -d '{"title":"Deploy to staging","priority":"high"}'
```

### Get all tasks
```powershell
curl http://localhost:3000/api/tasks `
  -H "Authorization: Bearer TOKEN"
```

### View notifications
```powershell
curl http://localhost:3000/api/notifications `
  -H "Authorization: Bearer TOKEN"
```

---

## Common Errors & Fixes

| Error | Cause | Fix |
|---|---|---|
| `npm is not recognized` | Node.js not installed or not in PATH | Install Node.js from https://nodejs.org, restart terminal |
| `ECONNREFUSED 5432` | PostgreSQL not running | Run `net start postgresql-x64-14` as Admin |
| `password authentication failed` | Wrong DB_PASSWORD in .env | Update `DB_PASSWORD` in all 3 service `.env` files |
| `port 3000 already in use` | Another app using the port | Run `netstat -ano \| findstr :3000` then kill the PID |
| `502 Bad Gateway` | A backend service is not running | Start the missing service in its terminal |
| `401 No token provided` | Forgot Authorization header | Add `Authorization: Bearer <token>` to your request |
| `invalid token` | JWT_SECRET mismatch across services | Make sure `JWT_SECRET` is the same in all `.env` files |
| Frontend blank / API errors | Gateway not running | Start Terminal 4 (api-gateway) first |

---

## Stopping All Services

Press `Ctrl + C` in each terminal to stop a service.

To stop PostgreSQL:
```powershell
# Run as Administrator
net stop postgresql-x64-14
```

---

---

# 🐳 Docker Run Guide

> Run the entire stack with a single command. No manual DB setup. No 5 terminals.

## Prerequisites

| Tool | Version | Check |
|---|---|---|
| Docker Desktop | v24+ | `docker --version` |
| Docker Compose | v2.20+ | `docker compose version` |

---

## Step 1 — Navigate to Project Root

```powershell
cd d:\Devsecops\devops-task-manager
```

---

## Step 2 — Build and Start Everything

```powershell
docker compose up --build
```

This will:
1. Pull `postgres:16-alpine` and `nginx:1.25-alpine` images
2. Build all 4 Node.js service images
3. Build the React app inside the frontend container
4. Start all 6 containers in the correct order (postgres → notification → user → task → gateway → frontend)

> First run takes 2–4 minutes (Pulling images + npm install inside containers).  
> Subsequent runs: `docker compose up` (no `--build`) is much faster.

---

## Step 3 — Run in Background (Detached Mode)

```powershell
docker compose up --build -d
```

Check all containers are running:
```powershell
docker compose ps
```

Expected output:
```
NAME               IMAGE              STATUS         PORTS
dtm-postgres       postgres:16-alpine Up (healthy)   0.0.0.0:5432->5432/tcp
dtm-notification   dtm-notification   Up (healthy)   0.0.0.0:3003->3003/tcp
dtm-user           dtm-user           Up (healthy)   0.0.0.0:3001->3001/tcp
dtm-task           dtm-task           Up (healthy)   0.0.0.0:3002->3002/tcp
dtm-gateway        dtm-gateway        Up (healthy)   0.0.0.0:3000->3000/tcp
dtm-frontend       dtm-frontend       Up             0.0.0.0:80->80/tcp
```

---

## Step 4 — Open the App

```
http://localhost
```

> Port is **80** (not 5173) when running with Docker — nginx serves the built React app.

---

## Step 5 — Verify Health Checks

```powershell
# All services via API Gateway
curl http://localhost:3000/health

# Individual services (direct)
curl http://localhost:3001/health
curl http://localhost:3002/health
curl http://localhost:3003/health
```

---

## Step 6 — View Logs

```powershell
# All services together
docker compose logs -f

# Single service
docker compose logs -f notification-svc
docker compose logs -f task-svc
docker compose logs -f api-gateway
docker compose logs -f postgres
```

---

## Docker Port Reference

| Container | Service | Host Port | Container Port |
|---|---|---|---|
| dtm-frontend | nginx (React) | **80** | 80 |
| dtm-gateway | API Gateway | 3000 | 3000 |
| dtm-user | User Service | 3001 | 3001 |
| dtm-task | Task Service | 3002 | 3002 |
| dtm-notification | Notification Svc | 3003 | 3003 |
| dtm-postgres | PostgreSQL | 5432 | 5432 |

---

## Useful Docker Commands

```powershell
# Stop all containers (keep volumes/data)
docker compose stop

# Stop and remove containers (keep volume/data)
docker compose down

# Stop and WIPE all data (including DB)
docker compose down -v

# Rebuild a single service only
docker compose up --build notification-svc

# Restart a single service
docker compose restart task-svc

# Open a shell inside a running container
docker exec -it dtm-postgres psql -U postgres -d devops_tasks
docker exec -it dtm-task sh

# Check resource usage
docker stats
```

---

## Connect to PostgreSQL from Host

```powershell
psql -h localhost -U postgres -d devops_tasks
# Password: postgres
```

---

## Docker Common Errors & Fixes

| Error | Cause | Fix |
|---|---|---|
| `port is already allocated` | Port 80/3000/5432 in use on host | Stop the conflicting process or change host port in `docker-compose.yml` |
| `service unhealthy` | DB not ready before service started | Compose health checks handle this — wait 30s and recheck |
| Container exits immediately | App crash on startup | Run `docker compose logs <service-name>` to see the error |
| `password authentication failed` | Wrong DB creds | In Docker, password is `postgres` (set in compose env, not `.env` files) |
| Frontend shows 502 | Gateway not healthy yet | Wait for `dtm-gateway` to show `Up (healthy)`, then reload |
| Changes not reflected | Image not rebuilt | Run `docker compose up --build` to force rebuild |
