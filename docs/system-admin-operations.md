# Super Admin school operations

Branch: `feature/system-admin-operations`, based on backend `dev` at
`1cfcf857fcb609bdd9d1cf8b3fcce25fbae3cda9`. No login changes, schema changes,
production deployment, or changes to the original frontend application.

All paths below are relative to `/api/system-admin`. The parent router requires
a System Admin token and cross-school access. School admin tokens are refused.
School codes in URLs are generated identifiers, never editable school fields.

| Method | Path | Permission / purpose |
| --- | --- | --- |
| GET | `/operations/capabilities` | Authenticated feature discovery, version 1 |
| GET | `/operations/school-status` | `read_schools`: disjoint active/inactive/archived/deleted counts |
| GET | `/schools/:schoolId/operations/summary` | `read_schools`: counts by school-operation area |
| GET | `/schools/:schoolId/operations/:collection` | `read_schools`: paginated oversight records |
| POST | `/schools/:schoolId/operations/classes` | `manage_schools`: create a class |
| POST | `/schools/:schoolId/operations/subjects` | `manage_schools`: create a subject |
| PUT | `/schools/:schoolId/operations/classes/:recordId` | `manage_schools`: change `isActive` only |
| PUT | `/schools/:schoolId/operations/subjects/:recordId` | `manage_schools`: change `isActive` only |
| GET / PUT | `/schools/:schoolId/operations/configuration` | Read / manage subscription, known feature flags and limits |
| POST | `/schools/:schoolId/admin-messages` | `manage_users`: email one active admin of this school |

Collections: `classes`, `subjects`, `academic-years`, `attendance`,
`fee-structures`, `invoices`, `payments`, `report-cards`, `timetables`, `events`,
`messages`. Each returns `{ records, pagination: { page, limit, total, pages } }`
inside the normal success envelope. `page` starts at 1, `limit` is 1–100, default
20. `search` is at most 100 characters; supported string fields are allowlisted.
Classes/subjects accept `status=active|inactive`. Other areas are oversight only.
Payments omit provider payloads, bank details and payer data. Invoices omit
student names. Timetable/report publication IDs resolve to school-scoped names.

Academic writes need `reason` (10–500 chars). Creation accepts `name` (2–100),
optional class `baseLevel`/numeric `level`; subjects also require `code` (1–30,
letters/digits/underscore/hyphen), optional `category=core|elective` and
`description`. Availability changes accept strict boolean `isActive`. Records
are retained; there are no physical-delete operations. Inactive, archived or
deleted schools refuse writes. Changing class availability does not rewrite
existing timetables, assignments, grades or invoices.

Configuration reads return a `version` timestamp. Send it unchanged when saving,
with `subscriptionTier`, `subscriptionStatus`, optional existing `features`,
`limits` and `reason`. A stale version returns `CONFIG_CONFLICT` 409. Only
`maxUsers`, `maxStudents`, `maxStorage` are accepted as limit keys. Existing
unrelated configuration is retained. Feature flags must already exist; this
endpoint does not implement new feature gates or claim enforcement in services
that do not consume those values. No billing/payment operations are added.

Email body: `{ requestId: uuid, userId: uuid, title, body }`. Subject: 3–160
characters, no newlines; message: 10–4000. Recipient must be an active,
non-deleted admin belonging to the URL school. Both recipient and sender are
resolved on the server, not accepted as arbitrary email addresses. HTML is
escaped. A serializable transaction reserves the request ID and writes its audit
row before calling the existing email provider. Repeating the same request ID
returns its saved status and never sends again. Reusing it with different
content/recipient/actor is refused. Request IDs must not be regenerated for an
uncertain delivery. Provider retries are disabled for this operation.

`deliveryStatus=sent` means provider acceptance with a message ID, not guaranteed
inbox delivery. `pending`/`unknown` needs provider-log inspection. A process
failure between reservation, provider acceptance and final audit update cannot
be resolved automatically. Do not automatically resend it. Results are recorded
in the school's message history and audit log. No live email was sent in tests.

Academic and configuration mutations write audit records in their own database
transaction. Audit failure prevents successful completion. Existing school list
search is now forwarded to its service; user status/school filters map to the
service contract. Deleted schools also include archived-and-deleted records.

## Validation

The new service and HTTP tests, existing school-operations HTTP tests,
controller tests, school lifecycle and platform audit tests passed: 100 cases.
Prisma generation and schema validation passed. No database migration is needed
beyond the repository's existing migrations. No live database transaction or
email delivery was performed. Existing schema migrations must already be applied
on staging before deploying these endpoints.

The broader `systemAdminService.test.js` suite could not start in this workspace
because the installed bcrypt package lacks its native binary. A rebuild failed
while extracting Node headers (`fchown EINVAL`). This dependency limitation is
outside the new operation service, which does not depend on bcrypt.

## Release

Review and deploy this backend branch through the staging service owner. The
connected Render workspace does not provide access to that service here. The
frontend capability check keeps new controls unavailable until version 1 is
served. Do not treat a frontend-only preview as a completed live API integration.
