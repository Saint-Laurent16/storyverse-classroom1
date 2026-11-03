-- STORYVERSE Classroom schema for Supabase (Postgres)
-- Run this whole file in Supabase Dashboard > SQL Editor > New query.
-- Security model: all classroom data is protected by RLS. Students only see
-- their own learning records; a teacher sees only the students in their classes.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Story Explorer' check (char_length(display_name) between 1 and 40),
  role text not null default 'student' check (role in ('student','teacher')),
  requested_role text not null default 'student' check (requested_role in ('student','teacher')),
  created_at timestamptz not null default now()
);

create table if not exists public.classrooms (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 80),
  grade_level text not null default 'Grade 7' check (char_length(grade_level) between 2 and 30),
  class_code text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.class_members (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classrooms(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  unique (class_id, student_id)
);

create table if not exists public.story_assignments (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classrooms(id) on delete cascade,
  story_id text not null,
  assigned_at timestamptz not null default now(),
  unique (class_id, story_id)
);

create table if not exists public.scene_progress (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classrooms(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  story_id text not null,
  scenes_completed integer not null default 0 check (scenes_completed between 0 and 3),
  updated_at timestamptz not null default now(),
  unique (class_id, student_id, story_id)
);

create table if not exists public.quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classrooms(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  story_id text not null,
  score integer not null check (score >= 0),
  total integer not null check (total > 0 and score <= total),
  completed_at timestamptz not null default now()
);

-- The teacher can record an approved baseline/pre-test and post-test score.
-- Scores remain tied to their class and learner, and are not visible to peers.
create table if not exists public.assessment_scores (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classrooms(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  phase text not null check (phase in ('pre','post')),
  score numeric(7,2) not null check (score >= 0),
  max_score numeric(7,2) not null check (max_score > 0 and score <= max_score),
  updated_at timestamptz not null default now(),
  unique (class_id, student_id, phase)
);

create index if not exists class_members_student_idx on public.class_members(student_id);
create index if not exists class_members_class_idx on public.class_members(class_id);
create index if not exists scene_progress_class_student_idx on public.scene_progress(class_id, student_id);
create index if not exists quiz_attempts_class_student_idx on public.quiz_attempts(class_id, student_id);
create index if not exists assessment_scores_class_student_idx on public.assessment_scores(class_id, student_id);

-- Every new account starts as a student, even when "teacher" is requested.
-- The project owner must manually approve/promote teacher accounts in SQL Editor.
create or replace function public.handle_new_storyverse_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, role, requested_role)
  values (
    new.id,
    left(coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), nullif(new.raw_user_meta_data ->> 'full_name', ''), nullif(new.raw_user_meta_data ->> 'name', ''), 'Story Explorer'), 40),
    'student',
    case when new.raw_user_meta_data ->> 'requested_role' = 'teacher' then 'teacher' else 'student' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_storyverse on auth.users;
create trigger on_auth_user_created_storyverse
after insert on auth.users
for each row execute procedure public.handle_new_storyverse_user();

-- Users may request a role, but this never grants teacher privileges.
-- The actual role remains 'student' until the project administrator approves it.
create or replace function public.set_storyverse_requested_role(p_requested_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Please sign in first.'; end if;
  if p_requested_role not in ('student','teacher') then raise exception 'Invalid account type.'; end if;
  update public.profiles
    set requested_role = p_requested_role
    where id = (select auth.uid()) and role = 'student';
  if not found and not exists (select 1 from public.profiles p where p.id = (select auth.uid())) then
    raise exception 'Your profile is not ready yet. Please refresh and try again.';
  end if;
end;
$$;
revoke all on function public.set_storyverse_requested_role(text) from public, anon;
grant execute on function public.set_storyverse_requested_role(text) to authenticated;

-- SECURITY DEFINER helpers keep policy checks from recursively invoking RLS.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create or replace function private.is_teacher_of_class(p_class_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.classrooms c
    where c.id = p_class_id and c.teacher_id = (select auth.uid())
  );
$$;

create or replace function private.is_member_of_class(p_class_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.class_members m
    where m.class_id = p_class_id and m.student_id = (select auth.uid())
  );
$$;

create or replace function private.is_teacher_for_student(p_student_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.class_members m
    join public.classrooms c on c.id = m.class_id
    where m.student_id = p_student_id and c.teacher_id = (select auth.uid())
  );
$$;

grant execute on function private.is_teacher_of_class(uuid) to authenticated;
grant execute on function private.is_member_of_class(uuid) to authenticated;
grant execute on function private.is_teacher_for_student(uuid) to authenticated;

-- Keep correct quiz choices in a non-exposed schema. The public story JSON
-- contains only question text and choices, never the answer key.
create table if not exists private.story_quiz_answer_key (
  story_id text not null,
  question_index integer not null check (question_index >= 0),
  correct_index integer not null check (correct_index >= 0),
  primary key (story_id, question_index)
);
alter table private.story_quiz_answer_key enable row level security;
revoke all on private.story_quiz_answer_key from public, anon, authenticated;

-- The project owner loads the private answer key from PRIVATE_QUIZ_ANSWER_KEY.sql.

-- Score the whole quiz on the database. Students cannot insert or edit scores
-- directly; this function checks class membership + story assignment first.
create or replace function public.submit_storyverse_quiz(
  p_class_id uuid,
  p_story_id text,
  p_answers integer[]
)
returns table(score integer, total integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student_id uuid := (select auth.uid());
  v_total integer;
  v_score integer;
begin
  if v_student_id is null then raise exception 'Please sign in first.'; end if;
  if not exists (
    select 1 from public.profiles p where p.id = v_student_id and p.role = 'student'
  ) then raise exception 'Only student accounts can submit a class quiz.'; end if;
  if not exists (
    select 1 from public.class_members m where m.class_id = p_class_id and m.student_id = v_student_id
  ) then raise exception 'You are not a member of this classroom.'; end if;
  if not exists (
    select 1 from public.story_assignments a where a.class_id = p_class_id and a.story_id = p_story_id
  ) then raise exception 'This story is not assigned to your classroom.'; end if;

  select count(*)::integer into v_total
  from private.story_quiz_answer_key k where k.story_id = p_story_id;
  if v_total < 1 then raise exception 'No answer key is configured for this story.'; end if;
  if coalesce(array_length(p_answers, 1), 0) <> v_total then
    raise exception 'Please answer every quiz question before submitting.';
  end if;
  if exists (select 1 from unnest(p_answers) a(answer_index) where a.answer_index is null or a.answer_index < 0) then
    raise exception 'The submitted answers are not valid.';
  end if;

  select count(*)::integer into v_score
  from private.story_quiz_answer_key k
  join unnest(p_answers) with ordinality a(answer_index, question_number)
    on k.question_index = a.question_number - 1 and k.correct_index = a.answer_index
  where k.story_id = p_story_id;

  insert into public.quiz_attempts (class_id, student_id, story_id, score, total)
  values (p_class_id, v_student_id, p_story_id, v_score, v_total);

  return query select v_score, v_total;
end;
$$;
revoke all on function public.submit_storyverse_quiz(uuid, text, integer[]) from public, anon;
grant execute on function public.submit_storyverse_quiz(uuid, text, integer[]) to authenticated;

-- Create a classroom and a unique 10-character invite code.
create or replace function public.create_storyverse_class(p_name text, p_grade_level text default 'Grade 7')
returns table(class_id uuid, class_name text, grade_level text, class_code text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_code text;
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'Please sign in first.'; end if;
  select p.role into v_role from public.profiles p where p.id = auth.uid();
  if v_role is distinct from 'teacher' then raise exception 'Only approved teacher accounts can create classes.'; end if;
  if length(trim(coalesce(p_name,''))) < 2 then raise exception 'Please enter a class name.'; end if;
  loop
    v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
    begin
      insert into public.classrooms(teacher_id, name, grade_level, class_code)
      values (auth.uid(), trim(p_name), coalesce(nullif(trim(p_grade_level),''),'Grade 7'), v_code)
      returning id into v_id;
      exit;
    exception when unique_violation then
      -- Generate another code and retry.
    end;
  end loop;
  return query select c.id, c.name, c.grade_level, c.class_code
  from public.classrooms c where c.id = v_id;
end;
$$;

-- Students join a class by invite code. Direct membership inserts are not granted.
create or replace function public.join_storyverse_class(p_code text)
returns table(class_id uuid, class_name text, grade_level text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_class public.classrooms%rowtype;
begin
  if auth.uid() is null then raise exception 'Please sign in first.'; end if;
  select p.role into v_role from public.profiles p where p.id = auth.uid();
  if v_role is distinct from 'student' then raise exception 'Only student accounts can join using a class code.'; end if;
  select * into v_class from public.classrooms c
    where c.class_code = upper(trim(coalesce(p_code,''))) and c.is_active = true;
  if not found then raise exception 'That class code is invalid or the class is closed.'; end if;
  insert into public.class_members(class_id, student_id)
    values (v_class.id, auth.uid())
    on conflict (class_id, student_id) do nothing;
  return query select v_class.id, v_class.name, v_class.grade_level;
end;
$$;

revoke all on function public.create_storyverse_class(text, text) from public, anon;
revoke all on function public.join_storyverse_class(text) from public, anon;
grant execute on function public.create_storyverse_class(text, text) to authenticated;
grant execute on function public.join_storyverse_class(text) to authenticated;

-- Record classroom scene progress through a validated function rather than
-- allowing arbitrary client writes to the progress table.
create or replace function public.record_storyverse_scene_progress(
  p_class_id uuid,
  p_story_id text,
  p_scenes_completed integer
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student_id uuid := (select auth.uid());
  v_completed integer;
begin
  if v_student_id is null then raise exception 'Please sign in first.'; end if;
  if p_scenes_completed < 1 or p_scenes_completed > 3 then
    raise exception 'Scene progress must be between 1 and 3.';
  end if;
  if not exists (
    select 1 from public.profiles p where p.id = v_student_id and p.role = 'student'
  ) then raise exception 'Only student accounts can record story progress.'; end if;
  if not exists (
    select 1 from public.class_members m where m.class_id = p_class_id and m.student_id = v_student_id
  ) then raise exception 'You are not a member of this classroom.'; end if;
  if not exists (
    select 1 from public.story_assignments a where a.class_id = p_class_id and a.story_id = p_story_id
  ) then raise exception 'This story is not assigned to your classroom.'; end if;

  insert into public.scene_progress(class_id, student_id, story_id, scenes_completed, updated_at)
  values (p_class_id, v_student_id, p_story_id, p_scenes_completed, now())
  on conflict (class_id, student_id, story_id)
  do update set
    scenes_completed = greatest(public.scene_progress.scenes_completed, excluded.scenes_completed),
    updated_at = now()
  returning scenes_completed into v_completed;
  return v_completed;
end;
$$;
revoke all on function public.record_storyverse_scene_progress(uuid, text, integer) from public, anon;
grant execute on function public.record_storyverse_scene_progress(uuid, text, integer) to authenticated;

-- Explicit grants: never allow anonymous/public browser access to student records.
revoke all on public.profiles, public.classrooms, public.class_members,
  public.story_assignments, public.scene_progress, public.quiz_attempts,
  public.assessment_scores from public, anon, authenticated;

grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;
grant select on public.classrooms, public.class_members to authenticated;
grant select, insert, delete on public.story_assignments to authenticated;
grant select on public.scene_progress to authenticated;
grant select on public.quiz_attempts to authenticated;
grant select, insert, update on public.assessment_scores to authenticated;

-- Enable RLS on every browser-exposed table.
alter table public.profiles enable row level security;
alter table public.classrooms enable row level security;
alter table public.class_members enable row level security;
alter table public.story_assignments enable row level security;
alter table public.scene_progress enable row level security;
alter table public.quiz_attempts enable row level security;
alter table public.assessment_scores enable row level security;

drop policy if exists profiles_read_self_or_teacher on public.profiles;
create policy profiles_read_self_or_teacher on public.profiles
for select to authenticated
using (id = (select auth.uid()) or private.is_teacher_for_student(id));

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
for update to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

drop policy if exists classrooms_read_owner_or_member on public.classrooms;
create policy classrooms_read_owner_or_member on public.classrooms
for select to authenticated
using (teacher_id = (select auth.uid()) or private.is_member_of_class(id));

drop policy if exists class_members_read_self_or_class_teacher on public.class_members;
create policy class_members_read_self_or_class_teacher on public.class_members
for select to authenticated
using (student_id = (select auth.uid()) or private.is_teacher_of_class(class_id));

drop policy if exists assignments_read_class_members on public.story_assignments;
create policy assignments_read_class_members on public.story_assignments
for select to authenticated
using (private.is_teacher_of_class(class_id) or private.is_member_of_class(class_id));

drop policy if exists assignments_insert_teacher on public.story_assignments;
create policy assignments_insert_teacher on public.story_assignments
for insert to authenticated
with check (private.is_teacher_of_class(class_id));

drop policy if exists assignments_delete_teacher on public.story_assignments;
create policy assignments_delete_teacher on public.story_assignments
for delete to authenticated
using (private.is_teacher_of_class(class_id));

drop policy if exists scene_progress_read_own_or_teacher on public.scene_progress;
create policy scene_progress_read_own_or_teacher on public.scene_progress
for select to authenticated
using (student_id = (select auth.uid()) or private.is_teacher_of_class(class_id));

drop policy if exists scene_progress_insert_self_member on public.scene_progress;
drop policy if exists scene_progress_update_self_member on public.scene_progress;

drop policy if exists quiz_attempts_read_own_or_teacher on public.quiz_attempts;
create policy quiz_attempts_read_own_or_teacher on public.quiz_attempts
for select to authenticated
using (student_id = (select auth.uid()) or private.is_teacher_of_class(class_id));

drop policy if exists quiz_attempts_insert_self_member on public.quiz_attempts;

drop policy if exists assessments_teacher_read on public.assessment_scores;
create policy assessments_teacher_read on public.assessment_scores
for select to authenticated
using (private.is_teacher_of_class(class_id));

drop policy if exists assessments_teacher_insert on public.assessment_scores;
create policy assessments_teacher_insert on public.assessment_scores
for insert to authenticated
with check (private.is_teacher_of_class(class_id) and exists (
  select 1 from public.class_members m where m.class_id = assessment_scores.class_id and m.student_id = assessment_scores.student_id
));

drop policy if exists assessments_teacher_update on public.assessment_scores;
create policy assessments_teacher_update on public.assessment_scores
for update to authenticated
using (private.is_teacher_of_class(class_id))
with check (private.is_teacher_of_class(class_id) and exists (
  select 1 from public.class_members m where m.class_id = assessment_scores.class_id and m.student_id = assessment_scores.student_id
));

-- Useful for dashboard ordering and lookup.
comment on table public.assessment_scores is 'Teacher-entered research pre-test/post-test scores. Use only after approved research consent and protocol.';
