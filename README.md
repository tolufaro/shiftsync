# ShiftSync

Shift scheduling with realtime updates, availability validation (timezone/DST-safe), swap approvals, notifications, and an audit trail.

## Quick Links

- Full project documentation: [DOCUMENTATION.md](file:///C:/workspace/shiftsync/DOCUMENTATION.md)

## Local Setup (Shortest Path)

### 1) Start Postgres

```bash
docker compose up -d
```

### 2) Backend

Create `backend/.env`:

```env
DATABASE_URL=postgres://postgres:postgres@localhost:5432/shiftsync
JWT_SECRET=dev-secret-change-me
CORS_ORIGIN=http://localhost:3000
PORT=3001
```

Install + migrate + seed + run:

```bash
cd backend
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

### 3) Frontend

Create `frontend/.env.local`:

```env
NEXT_PUBLIC_API_URL=http://localhost:3001
```

Run:

```bash
cd frontend
npm install
npm run dev
```

Open: `http://localhost:3000`

## Demo Credentials (Seeded)

See [DOCUMENTATION.md](file:///C:/workspace/shiftsync/DOCUMENTATION.md#demo-login-credentials).

## Notes

- If you see `EADDRINUSE: :::3001`, another process is using port 3001. Stop it or set `PORT` to a different value.
