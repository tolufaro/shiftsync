alter table if exists shifts
  add column if not exists start_at timestamptz,
  add column if not exists end_at timestamptz;

update shifts s
set
  start_at = ((s.date + s.start_time) at time zone l.timezone),
  end_at = ((s.date + s.end_time) at time zone l.timezone)
from locations l
where s.location_id = l.id
  and (s.start_at is null or s.end_at is null);

alter table if exists shifts
  alter column start_at set not null,
  alter column end_at set not null;

do $$ begin
  alter table shifts add constraint shifts_end_after_start_chk check (end_at > start_at);
exception
  when duplicate_object then null;
end $$;

create index if not exists shifts_location_start_at_idx on shifts (location_id, start_at);
create index if not exists shifts_start_at_idx on shifts (start_at);

