# Advanced Operator Guide

Advanced controls are for workspace owners, admins, and technical operators.

## Location

Open Settings -> Advanced.

Advanced includes:

- Workflow Builder
- Webhook delivery logs and replay
- MCP API keys
- MCP audit logs
- Runbook links

## Guardrails

Do not expose advanced settings in the primary end-user path. Standard users should be able to create, review, assign, and track meeting tasks without seeing workflow transforms, MCP keys, webhook replay, or audit logs.

## Validation Checklist

Before release, validate:

- Fathom multi-connection create/list/rename/revoke/webhook flows.
- Workflow delivery and replay.
- MCP real-client reads and writes.
- Worker restart/recovery.
- Rollback and key-rotation runbooks.
- Core-first remaining validation scripts.
