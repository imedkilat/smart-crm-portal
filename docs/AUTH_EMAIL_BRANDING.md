# Smart CRM Auth Email Branding

Smart CRM keeps source-controlled copies of the hosted Supabase Auth templates in `supabase/templates/`.

## Templates

- `invite.html` — admin subscriber invitation
- `confirmation.html` — self-signup email confirmation
- `recovery.html` — password recovery

Recommended hosted subjects:

- Invite: `You’re invited to Smart CRM`
- Confirmation: `Confirm your Smart CRM email`
- Recovery: `Reset your Smart CRM password`

For the hosted Supabase project, copy the corresponding HTML into **Authentication → Email Templates**. The templates intentionally use only `{{ .ConfirmationURL }}` and avoid unnecessary user-supplied personalization in auth messages.

## Sender branding

Changing the visible sender from the default `Supabase Auth` identity requires a custom SMTP provider. Configure this in **Authentication → SMTP Settings**.

Recommended production shape:

- Sender name: `Smart CRM`
- From address: a dedicated auth address such as `no-reply@auth.example.com`
- Keep authentication mail separate from marketing/outreach mail.

Supabase supports SMTP providers such as Resend, Postmark, Amazon SES, SendGrid, Brevo and other standards-compliant SMTP services.

Before enabling production delivery:

1. Verify the sending domain with the SMTP provider.
2. Add the provider's SPF/DKIM records and publish DMARC for the domain.
3. Disable click/link tracking for authentication emails so Supabase confirmation links are not rewritten.
4. Configure the SMTP host, port, username and password in Supabase.
5. Set the sender name to `Smart CRM` and the From address to the verified auth address.
6. Send one invite, one signup confirmation and one recovery email to controlled test accounts.
7. Confirm the From identity, subject, button link and redirect behavior before broad use.

## Account display-name flow

Smart CRM stores a human display name in `auth.users.user_metadata.full_name`.

- Self-signup collects `Full name` and stores it together with `workspace_name`.
- Invite/password setup collects `Full name` before saving the new password.
- The CRM shell prefers `full_name`, then `name`, then `display_name`, and falls back to the account email when no human name exists.
- `user_metadata` is presentation data only and must never be used for authorization. Workspace roles continue to come from `workspace_members`; platform authorization continues to come from trusted `app_metadata`/server-side controls.
