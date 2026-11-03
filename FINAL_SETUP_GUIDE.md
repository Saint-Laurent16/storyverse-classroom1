# STORYVERSE 2.0 — Final launch checklist

## 1) Create the new GitHub repository
Create a public repository named `storyverse-classroom`. Upload every file and folder from this package to the repository root (upload the contents, not the ZIP). Keep `data/stories.json` inside `data/`.

## 2) Configure GitHub Pages
Repository → Settings → Pages → Deploy from a branch → `main` → `/(root)` → Save.

Expected URL: `https://Saint-Laurent16.github.io/storyverse-classroom/` (GitHub usernames are case-insensitive; use the exact username spelling shown on your account).

## 3) Supabase URL settings
Authentication → URL Configuration:
- Site URL: `https://Saint-Laurent16.github.io/storyverse-classroom/`
- Redirect URLs: add `/teacher.html`, `/student.html`, and `/stories.html` under that same base.

## 4) No email verification; no Google login
Authentication → Providers → Email: leave Email enabled and turn **Confirm email OFF**. Leave Google disabled. The site uses email + password only. Supabase still requires an email address as the account identifier; this setting removes the email-confirmation step, not the email field.

## 5) Database upgrades
If you already ran the original STORYVERSE schema and portal upgrade, do not rerun those. Run `supabase-profile-upgrade.sql` once to add profile color/theme and private score-display preferences.

For a brand-new Supabase project, run in order:
1. `supabase-schema.sql`
2. `supabase-portal-upgrade.sql`
3. `supabase-profile-upgrade.sql`
4. Private answer-key SQL (only in Supabase SQL Editor; never commit it to GitHub).

## 6) Teacher approval
Teacher account creation creates a pending teacher request, not teacher privileges. The project owner must approve the teacher in Supabase after confirming their identity:

```sql
update public.profiles
set role = 'teacher'
where id = 'AUTH_USER_UUID'
  and requested_role = 'teacher';
```

Find the UUID in Supabase → Authentication → Users. Never let the browser grant teacher privileges.

## 7) Check it after deploy
- Create one teacher account. Confirm it is pending.
- Approve that account in Supabase, then sign in to Teacher Portal.
- Create a classroom and copy its code/invite link.
- Create a student account (or have the teacher share an invite link).
- Join the class using the code.
- Assign one story, then sign in as the student and open it.
- Complete the 3 scenes and submit the quiz. Check the teacher progress dashboard.
- Test profile color/theme and score visibility. Scores are private/hidden on the profile by default; toggling displays the score summary only within the student's own profile, not to other students.
- Test the story sound control after tapping it; browsers block autoplay until a user gesture.

## Notes
- Immersive AR requires a supported phone/browser and HTTPS. If WebXR AR is unavailable, the 3D scene remains interactive; this is a browser/device limitation, not a reason to block the reading activity.
- Forest/ocean soundscapes are synthesized locally (bird-like chirps and water-like tones), not wildlife recordings. Sound is optional and can be turned off.
- For Grade 7–9 research, use pseudonymous study IDs, collect only necessary information, and follow school/parent/guardian consent procedures.
- This package has been syntax-checked and the story JSON validated. Live Supabase authentication, RLS, and AR must still be tested in the deployed environment.
