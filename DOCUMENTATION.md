# ShiftSync — Documentation

## Demo Login Credentials

Seeded users are created by [seed.ts](file:///C:/workspace/shiftsync/backend/scripts/seed.ts) via `npm run db:seed` (backend).

- **Admin**
  - Email: `admin@shiftsync.com`
  - Password: `password123`
- **Managers**
  - Email: `manager1@shiftsync.com` (also `manager2@shiftsync.com`, `manager3@shiftsync.com`, `manager4@shiftsync.com`)
  - Password: `password123`
- **Staff**
  - Email: `staff1@shiftsync.com` (also `staff2@shiftsync.com` … `staff12@shiftsync.com`)
  - Password: `password123`

## Stack Overview

**Backend**
- Node.js + Express (REST API)
- PostgreSQL (`pg`)
- Auth: JWT (`jsonwebtoken`) stored in an HTTP-only cookie (`ss_token`)
- Realtime: Socket.IO (`socket.io`)
- Timezone/DST correctness in validation: Luxon (`luxon`)

**Frontend**
- Next.js App Router (client pages)
- Realtime: Socket.IO client
- Time formatting: `date-fns` + `date-fns-tz`

**Local Dev Infrastructure**
- PostgreSQL + pgAdmin via [docker-compose.yml](file:///C:/workspace/shiftsync/docker-compose.yml)

## Running Locally (Quick Start)

### 1) Database

From the repo root:

```bash
docker compose up -d
```

Postgres defaults:
- Host: `localhost`
- Port: `5432`
- DB: `shiftsync`
- User: `postgres`
- Password: `postgres`

pgAdmin defaults:
- URL: `http://localhost:5050`
- Email: `admin@shiftsync.com`
- Password: `admin123`

### 2) Backend

Create `backend/.env`:

```env
DATABASE_URL=postgres://postgres:postgres@localhost:5432/shiftsync
JWT_SECRET=dev-secret-change-me
CORS_ORIGIN=http://localhost:3000
PORT=3001
```

Run migrations + seed:

```bash
cd backend
npm install
npm run db:migrate
npm run db:seed
```

Start:

```bash
npm run dev
```

If you see `EADDRINUSE: :::3001`, another process is already using port 3001. Stop it or set `PORT` to a different value.

### 3) Frontend

Create `frontend/.env.local`:

```env
NEXT_PUBLIC_API_URL=http://localhost:3001
```

Start:

```bash
cd frontend
npm install
npm run dev
```

## Key App Pages

- `/login` — Login
- `/notifications` — Notification center
- `/settings/notifications` — Notification preferences
- `/settings/timezone` — Home timezone setting
- `/availability` — Weekly availability + exceptions
- `/my/schedule` — Staff schedule
- `/available-shifts` — Staff “open shifts” list + claim
- `/manager/schedule` — Manager schedule grid + assignment + history panel
- `/manager/approvals` — Swap/drop approvals
- `/manager/analytics` — Fairness analytics
- `/admin/users` — User management
- `/admin/audit` — Audit CSV export

## Known Limitations

- **Email is simulated**: when a user enables email for a notification type, the backend logs an email “send” to console. No SMTP/Nodemailer integration.
- **Audit export is capped**: `/admin/audit/export` limits results to 20,000 rows to avoid runaway downloads.
- **Audit-to-location mapping is partial**: the location filter applies to audit rows that can be mapped through `shift`, `shift_assignment`, or `swap_request` joins; other entity types may show with a blank `location_id`.
- **UI is intentionally lightweight**: no component library; styling uses shared CSS utilities in `globals.css`.
- **Browser timezone list**: the timezone dropdown uses `Intl.supportedValuesOf('timeZone')` when available; older browsers fall back to a free-text input.

## Ambiguity Decisions (Explicit Behavior)

### Timezones & DST

- **All shift timestamps are stored as UTC** in the database (`start_at`, `end_at` are `timestamptz`).
- **Shift display timezone**: schedules display shift time ranges in the shift’s **location timezone**. Staff pages show the location timezone label next to each shift.
- **Availability interpretation timezone**: availability windows/exceptions are interpreted in the staff member’s **home timezone** (`users.home_timezone`).
  - UI surfaces this on `/availability`: “Availability times are interpreted in your home timezone”.
  - Home timezone can be set at `/settings/timezone`.
- **Overnight windows**: availability windows can span midnight (e.g., `22:00–06:00`) and are treated as overnight into the next day.
- **DST correctness**: availability coverage and overtime bucketing are computed by splitting shift intervals by local day using Luxon with IANA timezone names (no numeric offsets).

### Scheduling & Constraints

- **Assignment concurrency**: assignment creation locks the shift row (`SELECT ... FOR UPDATE`) and checks headcount inside the transaction. When headcount is already met, it returns `headcount_full`.
- **Overtime / rest / double-booking**: the validator returns blocking vs warning violations. Manager override is required for overrideable blocks (e.g., 7th consecutive day), and the UI prompts for an override reason.

### Notifications

- **In-app is always on**: notifications are always recorded to the DB and sent via WS; email delivery is optional per-type.
- **Preferences are per-notification type** and stored in `notification_preferences` with `email_enabled`.

### Audit Trail

- **Audit records are written for mutations** via a reusable `logAudit(...)` helper and are used to power the shift history panel.
- **Shift history view**: manager schedule “History” shows audit entries where `entity_type = 'shift'` and `entity_id = <shiftId>`.

## Intentional Ambiguities (Chosen Behavior)

These items were deliberately unspecified; the system’s current behavior is:

- **De-certifying staff from a location**
  - Removing a staff→location link affects future operations only: it blocks new assignments/manager access for that location (location certification check).
  - Existing historical records remain unchanged (past shifts/assignments/audit history are preserved).
- **Desired hours vs availability**
  - Availability is a hard constraint for assignment validation.
  - Desired weekly hours are treated as a soft planning signal used in analytics/fairness reporting only; they do not override availability or constraints.
- **Consecutive days (short vs long shifts)**
  - Any non-zero work on a calendar day counts as a “worked day” for consecutive-day streaks; duration does not change the streak calculation.
- **Shift edited around swap approval**
  - If a shift is edited while a swap/drop request is still pending, the pending request is cancelled to avoid approving a stale swap against changed shift details.
  - If the swap has already been manager-approved, the assignment change is immediate; later shift edits just affect whoever is now assigned.
- **Locations near timezone boundaries**
  - Each location uses a single IANA timezone (`locations.timezone`). Boundary-spanning locations are not modeled; the operator must choose the canonical timezone for that location.

