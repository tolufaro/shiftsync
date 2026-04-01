# ShiftSync — Architecture Decisions

This file captures decisions that affect product behavior and data integrity. When behavior is unclear, treat these as the source of truth.

## Time, Timezones, and Date Boundaries

1. **All timestamps are stored in UTC**
   - Database stores `timestamptz` and assumes UTC at rest.
   - APIs accept and return ISO-8601 with timezone offsets; internal logic normalizes to UTC.

2. **Users have an IANA timezone**
   - Each user has a `timezone` like `Africa/Lagos`, `America/New_York`.
   - UI displays dates/times in the user’s timezone.

3. **“Day” is computed in the relevant local timezone**
   - Rules that depend on “days” (consecutive-day limits, weekend rules, daily hour caps) use the worker’s timezone (or the facility timezone if scheduling is facility-centric).
   - A shift that crosses midnight counts toward both local dates for “worked on that day” checks unless a rule explicitly uses shift start date only.

4. **DST is supported**
   - Availability and recurring patterns are defined in local time; conversion to UTC must account for DST transitions.
   - On DST gaps/overlaps, the system uses the timezone library’s standard behavior and validates that resulting instants are unambiguous.

## Availability, Desired Hours, and Scheduling Constraints

5. **Availability is a hard constraint**
   - A worker is only eligible for shifts that overlap their declared availability windows.
   - Exceptions require explicit override flags (e.g., admin override) and are always auditable.

6. **Desired hours is a soft constraint**
   - Desired hours is a weekly target (per worker) used for optimization and fairness.
   - Scheduling aims to get as close as possible but may deviate due to coverage requirements and other constraints.
   - If a worker’s availability makes the target impossible, the scheduler does not “force” assignments outside availability.

7. **Availability and desired hours interaction**
   - If desired hours > maximum hours available, the effective desired hours is capped by available capacity.
   - If desired hours < minimum coverage needs, the scheduler may exceed desired hours to meet coverage, but it should do so fairly across workers.

8. **Priority order for constraints**
   1) Legal/compliance constraints and hard limits (e.g., max weekly hours, mandatory rest)
   2) Availability
   3) No-overlap / conflict rules (cannot work two shifts overlapping in time)
   4) Role/certification eligibility
   5) Consecutive-day and rest preferences/limits
   6) Desired hours and fairness balancing

## Consecutive-Day Rules and Rest

9. **Maximum consecutive working days**
   - Configurable per organization (default: 6).
   - “Working day” means any day in local time where the worker has ≥ 1 minute of scheduled work.

10. **Rest between shifts (minimum time off)**
   - Configurable per organization (default: 10 hours).
   - The scheduler must ensure the gap between shift end and next shift start is at least the minimum rest.

11. **Daily and weekly hour caps**
   - Configurable per organization (defaults TBD).
   - Weekly hours use the local week boundary of the worker (or org setting), but computation is based on UTC instants.

## Certification / Eligibility and De-certification

12. **Certifications gate eligibility**
   - A worker can only be assigned to shifts requiring certifications they currently hold (and that are not expired).

13. **De-certification behavior**
   - De-certification takes effect immediately for future scheduling decisions.
   - Existing scheduled shifts are handled as follows:
     - If the shift starts in the future: the worker is marked ineligible; the shift becomes “needs coverage” and triggers re-assignment.
     - If the shift is in progress: keep assignment but raise an urgent compliance alert (org can choose to force unassign).
     - If the shift is completed: no change.

14. **Audit trail**
   - All certification changes and schedule modifications produce audit events (who, what, when, before/after).

## Real-time Delivery (Socket.io)

15. **Socket.io is the real-time layer**
   - Used to push schedule changes, coverage alerts, and assignment updates.
   - Event names are versioned (e.g., `schedule.updated.v1`) to allow evolution without breaking clients.

## Authentication / Sessions

16. **JWT session token via HttpOnly cookie**
   - Backend issues a signed JWT and stores it in an HttpOnly cookie.
   - Frontend uses `credentials: 'include'` and never stores tokens in localStorage.

## Data Model Expectations (High-level)

17. **Shift times**
   - Shifts store `start_at` and `end_at` as UTC `timestamptz`.
   - “Duration” is derived, not stored, except for reporting optimizations.

18. **Availability representation**
   - Recurring availability is stored as day-of-week + local-time ranges + timezone reference.
   - One-off exceptions (PTO, blackout windows) are stored as UTC ranges and override recurring patterns.

## Defaults (Can be changed per organization)

19. **Initial defaults**
   - Max consecutive days: 6
   - Min rest between shifts: 10 hours
   - Desired hours: per user (unset means “no target”)

