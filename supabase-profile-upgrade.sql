-- STORYVERSE profile customization upgrade. Run after the base schema + portal upgrade.
alter table public.profiles
  add column if not exists profile_color text not null default '#8879df',
  add column if not exists profile_theme text not null default 'dreamy',
  add column if not exists scores_public boolean not null default false;

alter table public.profiles drop constraint if exists profiles_profile_color_check;
alter table public.profiles add constraint profiles_profile_color_check
  check (profile_color ~ '^#[0-9A-Fa-f]{6}$');
alter table public.profiles drop constraint if exists profiles_profile_theme_check;
alter table public.profiles add constraint profiles_profile_theme_check
  check (profile_theme in ('dreamy','nature','cosmic','pixel'));

-- Users can update only their own profile row. Existing role protections remain in place.
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
for update to authenticated using (id = (select auth.uid()))
with check (id = (select auth.uid()));

-- Limit profile edits to the intended personalization fields; role fields stay protected.
grant update (display_name, profile_color, profile_theme, scores_public) on public.profiles to authenticated;
