alter table if exists users
  add column if not exists home_timezone text;

update users u
set home_timezone = x.timezone
from (
  select distinct on (sl.staff_id) sl.staff_id, l.timezone
  from staff_locations sl
  join locations l on l.id = sl.location_id
  order by sl.staff_id, sl.created_at asc
) x
where x.staff_id = u.id
  and u.home_timezone is null;

update users
set home_timezone = 'UTC'
where home_timezone is null;

