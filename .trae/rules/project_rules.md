## Project roots
- Backend: C:\workspace\shiftsync\backend (Express + Socket.io + PostgreSQL)
- Frontend: C:\workspace\shiftsync\frontend (Next.js)

## Local dev
- Start database:
  - From C:\workspace\shiftsync: `docker compose up -d db pgadmin`
- Start backend:
  - From C:\workspace\shiftsync\backend: `npm run db:migrate` then `npm run dev`
  - URL: http://localhost:3001
- Start frontend:
  - From C:\workspace\shiftsync\frontend: `npm run dev`
  - URL: http://localhost:3000

## Environment
- Backend .env: `DATABASE_URL`, `JWT_SECRET`, `CORS_ORIGIN`
- Frontend .env: `NEXT_PUBLIC_API_URL`

