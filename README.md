# STORYVERSE 2.0 — Learning worlds, made personal

A responsive Grade 7–9 reading and classroom website with separate teacher and student portals, three interactive storybooks, 3D scenes, optional AR, narration, generated ambient soundscapes, assignments, schedules, classroom progress, and student profile customization.

## Files
- `index.html` — public landing page and role chooser
- `teacher.html` / `student.html` — separate login, account creation, and dashboards
- `stories.html` — interactive 3D/AR story library
- `app.js`, `storybook.css` — story experience
- `portal.js`, `portal.css` — portals and dashboard UI
- `data/stories.json` — public story text and questions (no correct-answer indexes)
- `supabase-client.js` — project URL + publishable key only

## Deploy to GitHub Pages
1. Create a **public** repository (e.g. `storyverse-classroom`).
2. Upload the contents of this folder to the repository root. Keep `data/` as a folder.
3. Settings → Pages → Deploy from a branch → `main` → `/(root)`.
4. In Supabase → Authentication → URL Configuration, set Site URL to `https://YOUR-USERNAME.github.io/YOUR-REPOSITORY/` and add that URL plus `/teacher.html` and `/student.html` as redirect URLs.
5. In Supabase → Authentication → Providers → Email, turn **Confirm email OFF** if you want email/password accounts without email verification. This does not remove the email field; Supabase still uses email as the account identifier. Google sign-in is not used.
6. Run the SQL upgrades below in order if the corresponding earlier setup has not already been run.

## Supabase SQL order
- If starting with a new Supabase project: run `supabase-schema.sql`.
- Run `supabase-portal-upgrade.sql`.
- Run `supabase-profile-upgrade.sql`.
- Insert private quiz answer keys using the separate private SQL file supplied to the project owner. **Never upload that private answer-key SQL to GitHub.**

If the base schema and portal upgrade have already been run successfully, do not rerun them; run only `supabase-profile-upgrade.sql` if the new profile fields are missing.

## Teacher approval
Teacher self-registration requests the teacher role but does not grant it. The project owner approves a teacher in Supabase SQL Editor after verifying the user:

```sql
update public.profiles
set role = 'teacher'
where id = 'AUTH_USER_UUID'
  and requested_role = 'teacher';
```

## Privacy and security
- Browser code contains only the Supabase project URL and `sb_publishable_` key. Never place a Supabase secret/service-role key in this repository.
- Correct quiz answer indexes are kept in the private database schema and quiz scoring is submitted through the `submit_storyverse_quiz` RPC.
- Student personal checklist items are private to the student.
- Student score visibility is off by default. The profile preference is a display preference; do not expose private research data publicly without consent and appropriate school approval.
- Teacher dashboards are scoped by classroom ownership and database RLS.
- For a Grade 7–9 research deployment, use study codes/pseudonyms where practical, collect minimum personal data, and follow school/parental consent requirements.

## Audio and AR notes
The story ambience is generated locally with Web Audio after the learner taps the sound control (browsers require a user gesture). The 3D experience uses Three.js; immersive AR depends on browser/device WebXR support and a secure context (HTTPS). If AR is unavailable, the 3D interactive scene remains usable. Headphones and a quiet volume are recommended.

## Story catalogue validation
The supplied catalogue contains three stories (`anansi`, `forest`, `ocean`), each with exactly three scenes and five multiple-choice questions. Correct-answer indexes and explanation keys are intentionally omitted from the public JSON. The private database answer-key rows must match the question order in this catalogue.
