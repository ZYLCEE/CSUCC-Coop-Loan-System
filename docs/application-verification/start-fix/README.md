# Start checking dispatcher repair

The API sends verification writes to `application_workflow_action(uuid,jsonb)`.
That function was absent from the connected database, causing a PostgREST missing
function error that the API presented as “Application verification is unavailable.”

The additive migration installs the dispatcher already defined in the agreed
workflow migration. Only the service role can execute it. It sets the verified
actor for the existing verification procedure, which checks the actor's current
permissions, revision and application hash. The previous actor is restored on
success or error. Direct authenticated execution of the underlying write procedure
is revoked, matching the intended API architecture.

The existing verification procedure is unchanged. No loan is started, approved,
released or marked verified by the deployment itself.

`rollback-validation.sql` tests the affected application: start, idempotent retry,
saving checks, blocked verification with incomplete requirements, denied member
actors and an unchanged Pending loan status. All test changes roll back.
`database-baseline.json` preserves the original installed write procedure.
