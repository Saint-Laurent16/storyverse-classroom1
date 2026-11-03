# STORYVERSE 2.0 — Quick Setup Guide

This guide is for the project owner/administrator. The website is static and can be hosted on GitHub Pages. Supabase provides authentication, classroom data, and row-level security.

## 1. Supabase database

Use the Supabase project you already created.

- If you have already successfully run the original `supabase-schema.sql`, do **not** run it again.
- Run the new `supabase-portal-upgrade.sql` in Supabase → SQL Editor → New query. This adds assignment deadlines, class schedule events, class announcements, and a private student checklist.
- If you have not already loaded the private answer key, run the separate `STORYVERSE_PRIVATE_QUIZ_ANSWER_KEY.sql` in Supabase SQL Editor. Keep that file private and do not commit it to GitHub.

The original schema includes profiles, classrooms, memberships, story assignments, scene progress, quiz attempts, assessment scores, RLS policies, and the secure quiz/classroom RPCs.

## 2. Supabase authentication URLs

For the planned new repository name `storyverse-classroom`, open Supabase → Authentication → URL Configuration and set:

**Site URL**

`https://saint-laurent16.github.io/storyverse-classroom/`

**Redirect URLs** (add both)

`https://saint-laurent16.github.io/storyverse-classroom/teacher.html`

`https://saint-laurent16.github.io/storyverse-classroom/student.html`

If the repository name or GitHub username changes, replace these URLs with the actual GitHub Pages address.

Keep email/password authentication enabled. Google OAuth is not required. Supabase email confirmation may be enabled; the user will need to verify their address before signing in.

## 3. GitHub Pages upload

1. Create a new **public** GitHub repository named `storyverse-classroom`.
2. Extract the website ZIP.
3. Upload the **contents** of the extracted folder to the repository root, not the ZIP file itself.
4. Make sure the `data` folder and its `stories.json` file are uploaded as a folder.
5. Do not upload `STORYVERSE_PRIVATE_QUIZ_ANSWER_KEY.sql`.
6. Commit the files to the `main` branch.
7. Open repository Settings → Pages → Build and deployment. Choose **Deploy from a branch**, branch `main`, folder `/(root)`, then Save.

Expected address:

`https://saint-laurent16.github.io/storyverse-classroom/`

## 4. Approve the first teacher

A teacher who self-registers is initially created as a student-role profile with `requested_role = 'teacher'`. This prevents users from granting themselves access to student records.

1. Register from `teacher.html` using the teacher's own email address.
2. Confirm the email if confirmation is enabled.
3. In Supabase → Authentication → Users, find the account and copy its user UUID.
4. Open SQL Editor and run this query, replacing the UUID with the verified teacher account UUID:

```sql
update public.profiles
set role = 'teacher'
where id = 'PASTE_TEACHER_AUTH_USER_UUID_HERE'
  and requested_role = 'teacher';
```

5. The teacher should sign out and sign in again at `teacher.html`.

Only the project owner should run the approval query. Do not give students access to the Supabase dashboard or SQL Editor.

## 5. Teacher workflow

1. Sign in through **For Teachers**.
2. Open My Classrooms and create a class for the required grade/section.
3. Copy the private invite link or share the 10-character classroom code directly with the students.
4. Open Assignments, select a classroom, assign one or more stories, and optionally set due dates and instructions.
5. Add class events and announcements from their respective menu tabs.
6. Review student progress and record pre-test/post-test percentages when appropriate.

## 6. Student workflow

Students can self-register through **For Students**. They can enter a classroom code during registration, use a teacher's invite link (`student.html?code=...`), or sign in first and join later from the dashboard.

After joining, students see assigned stories, task instructions, deadlines, class schedule, teacher announcements, and their own reading progress. The My Checklist section is private to the student and supports both school tasks and personal chores.

## 7. Test before research use

Use separate test email accounts for teacher and student. Verify:

- [ ] Teacher signup remains pending until administrator approval.
- [ ] Unapproved users cannot access teacher dashboard or create classrooms.
- [ ] Approved teacher can create a class and copy an invite link.
- [ ] Student can self-register and join with a code.
- [ ] Student sees only stories assigned to joined classes.
- [ ] Class assignment instructions and due dates appear on student portal.
- [ ] Events and announcements appear for members of the relevant class.
- [ ] Student checklist can be added/updated/deleted and is not visible to teachers or other students.
- [ ] Student story launches from its class assignment and scene progress syncs.
- [ ] Quiz scores are calculated by `submit_storyverse_quiz` using the private answer key.
- [ ] Teacher sees only their classrooms' student data.
- [ ] Test on the actual phones and browsers participants will use.

## Privacy and research notes

Use approved pseudonymous study IDs or nicknames for student display names. Avoid collecting birth dates, home addresses, or unnecessary personal details. Confirm school/adviser approval and required parental/student consent before using this system with minors. Scene completion indicates that a learner navigated the story, not proof of attention or reading quality. Quiz results are formative and should not be described as a validated standardized test.

## Troubleshooting

**Teacher account says access pending:** the project owner has not run the approval query, or the account UUID/email does not match. Sign out and sign in again after approval.

**Class schedule, announcements, or checklist show an error:** run `supabase-portal-upgrade.sql` in the same Supabase project. The original schema alone does not create those new tables.

**Student cannot join:** confirm the account is a student, the classroom is active, and the code was typed exactly.

**Story opens without saving progress:** launch it from the assigned story card inside the signed-in student portal. A public/demo story open is not a classroom assignment.

**Quiz scores do not sync:** check that the private answer-key SQL has been run and that the story is assigned to the class.

**Email confirmation fails to return to the site:** verify that both portal page URLs are listed in Supabase Redirect URLs.
