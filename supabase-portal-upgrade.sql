-- STORYVERSE 2.0 PORTAL FEATURES
-- Run this ONCE in Supabase SQL Editor after the original STORYVERSE schema.
-- Adds assignment deadlines/instructions, class schedules, announcements,
-- and a private per-student checklist (including personal chores).

alter table public.story_assignments
  add column if not exists due_at timestamptz,
  add column if not exists instructions text not null default '';

grant update (due_at, instructions) on public.story_assignments to authenticated;

drop policy if exists assignments_update_teacher on public.story_assignments;
create policy assignments_update_teacher on public.story_assignments
for update to authenticated
using (private.is_teacher_of_class(class_id))
with check (private.is_teacher_of_class(class_id));

create table if not exists public.class_events (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classrooms(id) on delete cascade,
  title text not null check (char_length(title) between 2 and 100),
  description text not null default '',
  starts_at timestamptz not null,
  ends_at timestamptz,
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  check (ends_at is null or ends_at >= starts_at)
);
create index if not exists class_events_class_starts_idx
  on public.class_events(class_id, starts_at);

create table if not exists public.class_announcements (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classrooms(id) on delete cascade,
  title text not null check (char_length(title) between 2 and 100),
  body text not null check (char_length(body) between 1 and 2000),
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists class_announcements_class_created_idx
  on public.class_announcements(class_id, created_at desc);

create table if not exists public.student_checklist (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 140),
  category text not null default 'school' check (category in ('school','personal')),
  due_date date,
  is_done boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists student_checklist_student_due_idx
  on public.student_checklist(student_id, due_date);

-- Only authenticated classroom members/teachers can read class events/announcements.
alter table public.class_events enable row level security;
alter table public.class_announcements enable row level security;
alter table public.student_checklist enable row level security;

revoke all on public.class_events, public.class_announcements, public.student_checklist
  from public, anon, authenticated;
grant select, insert, update, delete on public.class_events to authenticated;
grant select, insert, update, delete on public.class_announcements to authenticated;
grant select, insert, update, delete on public.student_checklist to authenticated;

drop policy if exists class_events_read_member_or_teacher on public.class_events;
create policy class_events_read_member_or_teacher on public.class_events
for select to authenticated
using (private.is_teacher_of_class(class_id) or private.is_member_of_class(class_id));
drop policy if exists class_events_insert_teacher on public.class_events;
create policy class_events_insert_teacher on public.class_events
for insert to authenticated
with check (private.is_teacher_of_class(class_id) and created_by = (select auth.uid()));
drop policy if exists class_events_update_teacher on public.class_events;
create policy class_events_update_teacher on public.class_events
for update to authenticated
using (private.is_teacher_of_class(class_id))
with check (private.is_teacher_of_class(class_id));
drop policy if exists class_events_delete_teacher on public.class_events;
create policy class_events_delete_teacher on public.class_events
for delete to authenticated
using (private.is_teacher_of_class(class_id));

drop policy if exists class_announcements_read_member_or_teacher on public.class_announcements;
create policy class_announcements_read_member_or_teacher on public.class_announcements
for select to authenticated
using (private.is_teacher_of_class(class_id) or private.is_member_of_class(class_id));
drop policy if exists class_announcements_insert_teacher on public.class_announcements;
create policy class_announcements_insert_teacher on public.class_announcements
for insert to authenticated
with check (private.is_teacher_of_class(class_id) and created_by = (select auth.uid()));
drop policy if exists class_announcements_delete_teacher on public.class_announcements;
create policy class_announcements_delete_teacher on public.class_announcements
for delete to authenticated
using (private.is_teacher_of_class(class_id));

drop policy if exists student_checklist_read_self on public.student_checklist;
create policy student_checklist_read_self on public.student_checklist
for select to authenticated
using (student_id = (select auth.uid()));
drop policy if exists student_checklist_insert_self on public.student_checklist;
create policy student_checklist_insert_self on public.student_checklist
for insert to authenticated
with check (student_id = (select auth.uid()));
drop policy if exists student_checklist_update_self on public.student_checklist;
create policy student_checklist_update_self on public.student_checklist
for update to authenticated
using (student_id = (select auth.uid()))
with check (student_id = (select auth.uid()));
drop policy if exists student_checklist_delete_self on public.student_checklist;
create policy student_checklist_delete_self on public.student_checklist
for delete to authenticated
using (student_id = (select auth.uid()));

comment on table public.student_checklist is
  'Private student tasks and personal checklist items; visible only to the student who created them.';
