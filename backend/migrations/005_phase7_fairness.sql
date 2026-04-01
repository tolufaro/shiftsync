alter table if exists users
  add column if not exists desired_weekly_hours int;

alter table if exists shifts
  add column if not exists is_premium boolean not null default false;

update shifts s
set is_premium =
  (
    extract(dow from (s.start_at at time zone l.timezone)) in (5, 6)
    and (s.start_at at time zone l.timezone)::time >= time '17:00'
  )
from locations l
where l.id = s.location_id;

create index if not exists shifts_is_premium_idx on shifts (is_premium);

