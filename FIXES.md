# 🛠️ Build Error Fixes — DevOps Task Manager

This document lists all errors encountered while running `docker compose up --build -d` and the exact fixes applied.

---

## Error 1 — `npm ci` fails due to missing `package-lock.json`

### 📍 Location
`frontend/Dockerfile` — Line 11

### ❌ Error Message
```
> [frontend builder 4/6] RUN npm ci --silent:
------
target frontend: failed to solve: process "/bin/sh -c npm ci --silent" did not complete successfully: exit code: 1
```

### 🔍 Root Cause
`npm ci` is a strict install command that **requires a `package-lock.json`** file to exist. The `frontend/` directory only had `package.json` with no lock file, causing `npm ci` to fail immediately.

### ✅ Fix Applied
**File:** `frontend/Dockerfile`

```diff
- RUN npm ci --silent
+ RUN npm install --silent
```

`npm install` works with or without a lockfile, making it the correct choice here.

---

## Error 2 — Unresolvable import `../api` in `Dashboard.jsx`

### 📍 Location
`frontend/src/Dashboard.jsx` — Line 2

### ❌ Error Message
```
Could not resolve "../api" from "src/Dashboard.jsx"
file: /app/src/Dashboard.jsx

RollupError: Could not resolve "../api" from "src/Dashboard.jsx"
```

### 🔍 Root Cause
`Dashboard.jsx` imported `api` using a path that goes **up one directory** (`../api`), but `api.js` lives in the **same directory** (`src/`). During the Vite production build inside Docker, Rollup couldn't resolve the module and threw a fatal error.

### ✅ Fix Applied
**File:** `frontend/src/Dashboard.jsx`

```diff
- import api from '../api';
+ import api from './api';
```

---

## Error 3 — Unresolvable import `../api` in `Auth.jsx`

### 📍 Location
`frontend/src/Auth.jsx` — Line 2

### ❌ Error Message
```
Could not resolve "../api" from "src/Auth.jsx"
file: /app/src/Auth.jsx

RollupError: Could not resolve "../api" from "src/Auth.jsx"
```

### 🔍 Root Cause
Same as Error 2 — `Auth.jsx` had the identical wrong relative import path `../api` instead of `./api`. Because `Dashboard.jsx` failed first in the previous build, this error only surfaced after Error 2 was fixed.

### ✅ Fix Applied
**File:** `frontend/src/Auth.jsx`

```diff
- import api from '../api';
+ import api from './api';
```

---

## 📋 Summary Table

| # | File | Error | Fix |
|---|------|-------|-----|
| 1 | `frontend/Dockerfile` | `npm ci` fails — no `package-lock.json` | Changed `npm ci` → `npm install` |
| 2 | `frontend/src/Dashboard.jsx` | `Cannot resolve '../api'` | Changed `../api` → `./api` |
| 3 | `frontend/src/Auth.jsx` | `Cannot resolve '../api'` | Changed `../api` → `./api` |

---

## ✅ Final Working Command

```bash
cd /mnt/d/Devsecops/devops-task-manager && docker compose up --build -d
```

### Services After Successful Start

| Service | URL |
|---|---|
| 🌐 Frontend (React) | http://localhost |
| 🔀 API Gateway | http://localhost:3000 |
| 👤 User Service | http://localhost:3001 |
| ✅ Task Service | http://localhost:3002 |
| 🔔 Notification Service | http://localhost:3003 |

### Useful Commands

```bash
# Check status of all containers
docker compose ps

# View live logs
docker compose logs --follow

# Stop all containers
docker compose down

# Stop and wipe database
docker compose down -v
```
