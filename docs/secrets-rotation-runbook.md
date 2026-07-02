# Secrets Rotation Runbook

## Scope
This runbook covers rotating application credentials after removing tracked local secret files from git.

## Trigger Conditions
- `.env` or any plaintext secret was committed previously.
- A credential is suspected exposed.
- Scheduled periodic rotation.

## Rotation Steps
1. Inventory current secrets from your secret manager:
   - MongoDB connection values
   - Google OAuth client secrets
   - Slack app client secret
   - Fathom client/webhook secrets
   - AI provider keys
2. Rotate each secret at the provider:
   - Create replacement key/secret.
   - Keep old credential active during cutover when provider supports overlap.
3. Update deployment/runtime env injection for all environments:
   - local development
   - preview/staging
   - production
4. Deploy and verify:
   - Auth login flow
   - Fathom webhook verification
   - Slack OAuth/share flow
   - Meeting/task AI flows
5. Revoke old credentials.
6. Record rotation date and owner in your ops notes.

## Repository Policy
- Keep `.env*` ignored in git.
- Commit only `.env.example` with placeholders.
- Never commit real credential values in source, docs, or logs.
