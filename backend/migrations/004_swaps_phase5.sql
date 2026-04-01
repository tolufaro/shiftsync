do $$ begin
  alter type swap_request_status add value 'pending_manager_approval';
exception
  when duplicate_object then null;
end $$;

alter table if exists swap_requests
  add column if not exists target_assignment_id uuid references shift_assignments(id) on delete set null;

create index if not exists swap_requests_target_assignment_id_idx on swap_requests (target_assignment_id);

