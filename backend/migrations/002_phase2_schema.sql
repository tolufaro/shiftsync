do $$ begin
  create type user_role as enum ('admin', 'manager', 'staff');
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type availability_exception_type as enum ('unavailable', 'custom');
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type shift_status as enum ('draft', 'published');
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type shift_assignment_status as enum ('active', 'pending_swap', 'dropped');
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type swap_request_type as enum ('swap', 'drop');
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type swap_request_status as enum ('pending', 'approved', 'rejected', 'cancelled', 'expired');
exception
  when duplicate_object then null;
end $$;

alter table if exists users
  add column if not exists name text,
  add column if not exists role user_role not null default 'staff';

create table if not exists locations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  timezone text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists staff_locations (
  staff_id uuid not null references users(id) on delete cascade,
  location_id uuid not null references locations(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (staff_id, location_id)
);

create table if not exists skills (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists staff_skills (
  staff_id uuid not null references users(id) on delete cascade,
  skill_id uuid not null references skills(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (staff_id, skill_id)
);

create table if not exists availability_windows (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references users(id) on delete cascade,
  day_of_week smallint not null,
  start_time time not null,
  end_time time not null,
  is_recurring boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists availability_windows_staff_id_idx on availability_windows (staff_id);

create table if not exists availability_exceptions (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references users(id) on delete cascade,
  date date not null,
  type availability_exception_type not null,
  start_time time,
  end_time time,
  created_at timestamptz not null default now()
);

create index if not exists availability_exceptions_staff_date_idx on availability_exceptions (staff_id, date);

create table if not exists shifts (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references locations(id) on delete cascade,
  required_skill_id uuid references skills(id) on delete set null,
  date date not null,
  start_time time not null,
  end_time time not null,
  headcount_needed integer not null default 1,
  status shift_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists shifts_location_date_idx on shifts (location_id, date);

create table if not exists shift_assignments (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references shifts(id) on delete cascade,
  staff_id uuid not null references users(id) on delete cascade,
  assigned_by uuid references users(id) on delete set null,
  status shift_assignment_status not null default 'active',
  created_at timestamptz not null default now()
);

create index if not exists shift_assignments_shift_id_idx on shift_assignments (shift_id);
create index if not exists shift_assignments_staff_id_idx on shift_assignments (staff_id);

create table if not exists swap_requests (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references shift_assignments(id) on delete cascade,
  requested_by uuid not null references users(id) on delete cascade,
  target_staff_id uuid references users(id) on delete set null,
  type swap_request_type not null,
  status swap_request_status not null default 'pending',
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists swap_requests_assignment_id_idx on swap_requests (assignment_id);
create index if not exists swap_requests_status_idx on swap_requests (status);

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  type text not null,
  message text not null,
  read boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_id_read_idx on notifications (user_id, read);

create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_logs_entity_idx on audit_logs (entity_type, entity_id);

