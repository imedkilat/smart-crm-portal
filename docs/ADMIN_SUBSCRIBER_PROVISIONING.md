# Admin subscriber provisioning

Smart CRM supports two account setup paths:

1. **Self signup** creates an authenticated user, owner workspace, default pipeline, and active Free subscription.
2. **Admin provisioning** sends a Supabase Auth invitation and binds the invited email to a workspace name and approved plan. The plan is activated only after that exact user accepts the invitation and completes first-session onboarding.

No temporary password is generated or shared in either path.

## Security model

- The browser calls `admin-provision-subscriber`; it never receives a service-role key.
- The Edge Function revalidates the access token and requires `user.app_metadata.platform_role = platform_admin`.
- User-editable `user_metadata` is not used for authorization.
- `subscriber_provisioning_requests` has RLS enabled and grants no table access to `anon` or `authenticated`.
- The request is claimed by verified `auth.users.email`, not a client-supplied user or workspace id.
- The platform admin is not added to the customer workspace. The customer is the workspace owner.
- Existing workspace subscriptions are never upgraded or downgraded by onboarding.

## One-time platform admin designation

Before deploying the Edge Function, set the operator's server-controlled Auth app metadata to:

```json
{
  "platform_role": "platform_admin"
}
```

Use a trusted Supabase Admin API or the Authentication user-management interface. Do not place this value in user metadata.

After app metadata changes, sign out and sign back in so the session contains the new claim.

## Deployment gate

Deploy only after the migration is reviewed and applied:

```bash
npx supabase db push --linked --dry-run
npx supabase db push --linked
npx supabase functions deploy admin-provision-subscriber --project-ref updpvuhtsqhpaylegrbz
```

No new custom secret is required. Supabase supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to the function runtime.

## Controlled E2E verification

Use a new test email that you control.

1. Sign in as the designated platform admin and open Settings.
2. Send a Starter invitation for a new workspace.
3. Confirm one pending provisioning request and an `invite_sent` billing event.
4. Accept the email invitation and set a password.
5. Confirm first login creates exactly one workspace, owner membership, default pipeline, active Starter subscription, and marks the request claimed.
6. Confirm Settings shows Starter / active / hosted.
7. Confirm the platform admin did not become a member of the new workspace.
8. Enable follow-up settings separately before positive Follow-Up Engine shadow QA.

Do not use a real customer email until the controlled test passes.
