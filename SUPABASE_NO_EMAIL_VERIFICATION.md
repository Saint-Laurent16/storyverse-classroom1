# Disable email verification (email + password only)

In your Supabase project:
1. Open **Authentication → Providers → Email**.
2. Find **Confirm email** and switch it **OFF**.
3. Save changes.
4. Keep Email provider enabled. Do not enable Google provider if you do not want Google sign-in.

Supabase still uses an email address as the login identifier, but users can create an account and sign in without clicking a verification email. Teacher registrations remain pending until the project owner approves the teacher role.

If Confirm email is ON, Supabase may create a user without an active session and require email confirmation. The website cannot bypass that server-side setting.
