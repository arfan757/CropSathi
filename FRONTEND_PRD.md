# CropSathi Officials Dashboard — Frontend PRD

**Companion to:** `BACKEND_SPEC.md`
**Scope:** the React + Leaflet **Officer Dashboard** only (ARCHITECTURE.md §2), not the Android farmer app.

## 0. Source & How to Read This Document

**This PRD is derived entirely from `BACKEND_SPEC.md` — a design specification, not implemented code.** No
backend repository exists yet (checked directly: no `controllers/`, `routes/`, DTOs, validators, or policy
files are present anywhere in this project). Everything below traces to a specific section of the spec.

Because of that, three things in the original ask don't have a real answer yet, and I'm flagging them here
instead of inventing one:

| You asked for | What the spec actually has |
|---|---|
| `POST /api/users/login` with username/password | Spec's auth is **phone number + OTP**: `POST /auth/otp/request` then `POST /auth/otp/verify` (Backend Spec §5, §6.1). There is no password field anywhere in the `users` table (§4.1). |
| A named policy-constants file (`UserPolicyConstants.cs`-style) | Spec has a `role` enum column (`farmer`/`expert`/`officer`/`admin`) and a `require_role(*roles)` FastAPI dependency (§5) — no named policy constants file exists. |
| HATEOAS `rel` links gating buttons | Spec's response shapes (§6, §12) never include `_links`/`rel`. Not part of the design. |
| `page`/`pageSize`/`totalCount`/`totalPages` | Spec explicitly uses **cursor pagination**: `?limit=&cursor=`, not page numbers (§6 intro). |

Wherever the spec is silent on something the frontend needs (exact error codes, exact nested JSON shapes,
token storage location), I've marked it **[SPEC GAP]** rather than guessing, and collected all of them in §5.

Every JSON example below is built strictly from the field lists in `BACKEND_SPEC.md`'s tables — nothing added.

---

## 1. Authentication Flow

### 1.1 Login — two-step (phone → OTP)

**Step 1 — request OTP**

`POST /auth/otp/request`

Request:
```json
{ "phone_number": "+919876543210" }
```

Response: **[SPEC GAP]** — Backend Spec §6.1 lists this route but doesn't define its response body (OTP
delivery is explicitly stubbed for the testing deployment, §5). Frontend should treat any `2xx` as "OTP sent,
show the code-entry screen" and rely on the generic error shape (§12, reproduced in §1.6 below) for failures.

**Step 2 — verify OTP**

`POST /auth/otp/verify`

Request:
```json
{ "phone_number": "+919876543210", "otp_code": "482913" }
```

Success response (Backend Spec §6.1: *"→ `{access_token, refresh_token, user}`"*, `user` shape from §4.1
minus `password_hash`):
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "refresh_token": "8f2c1e40-...-opaque-token",
  "user": {
    "id": "3f9a2b10-4c2e-4a6a-9c1e-2d7b8e0a1f33",
    "phone_number": "+919876543210",
    "role": "officer",
    "preferred_language": "mr",
    "full_name": "Anita Deshmukh",
    "district": "Nashik",
    "taluka": null,
    "created_at": "2026-01-10T06:12:00Z",
    "updated_at": "2026-01-10T06:12:00Z"
  }
}
```

Validation/error response (generic error shape, Backend Spec §12):
```json
{
  "error": {
    "code": "INVALID_OTP",
    "message": "The code you entered is incorrect or has expired.",
    "details": {}
  }
}
```
**[SPEC GAP]** — `INVALID_OTP` is my label for illustration. §12 defines the error *envelope shape* and gives
`FARM_NOT_FOUND` as its only worked example; it doesn't enumerate auth-specific error codes. These must be
finalized when auth is actually implemented.

### 1.2 Token storage

Backend Spec §5 issues `access_token` (short-lived JWT, `access_token_ttl_minutes`) and `refresh_token`
(opaque, `refresh_token_ttl_days`), but never specifies *where the frontend stores them* — that's a frontend
decision, not something §5 dictates. **[SPEC GAP — frontend decision, not backend-specified]**
Recommendation for this dashboard (officer-only, browser-based, not the offline Android app): store
`access_token` in memory (JS variable / React context) and `refresh_token` in an `HttpOnly` cookie if the
backend is extended to set one, or `localStorage` as a fallback if the backend only ever returns it in the
JSON body as currently specified. This should be confirmed with whoever implements §6.1, not assumed.

### 1.3 Fetching the current user after login

`GET /auth/me` (Backend Spec §6.1) — bearer token required.

Response (same `user` shape as §1.1, drawn from §4.1):
```json
{
  "id": "3f9a2b10-4c2e-4a6a-9c1e-2d7b8e0a1f33",
  "phone_number": "+919876543210",
  "role": "officer",
  "preferred_language": "mr",
  "full_name": "Anita Deshmukh",
  "district": "Nashik",
  "taluka": null,
  "created_at": "2026-01-10T06:12:00Z",
  "updated_at": "2026-01-10T06:12:00Z"
}
```

### 1.4 Refresh flow

`POST /auth/refresh` (Backend Spec §6.1: *"`{refresh_token}` → new access token"*)

Request:
```json
{ "refresh_token": "8f2c1e40-...-opaque-token" }
```

Response: **[SPEC GAP]** — §6.1 only says "new access token," not the exact body. Two plausible shapes exist
and the spec doesn't pick one:
```json
{ "access_token": "eyJhbGciOiJIUzI1NiIs..." }
```
or, if the refresh token is rotated on use (not stated either way in the spec):
```json
{ "access_token": "eyJhbGciOiJIUzI1NiIs...", "refresh_token": "new-opaque-token" }
```
Frontend must handle both — check for a `refresh_token` key in the response and replace the stored one if
present, otherwise keep the existing one.

**Global 401 interception (frontend architecture, not backend-specified, but required for §6's bearer-auth
model to work usably):**
1. An HTTP client interceptor watches every response for `401`.
2. On the first `401`, if no refresh is already in flight, call `POST /auth/refresh` with the stored
   `refresh_token`.
3. While that refresh call is in flight, any *other* request that also gets a `401` is queued (not fired as a
   second refresh call) — the interceptor holds a single shared in-flight promise; concurrent 401s subscribe to
   it instead of calling `/auth/refresh` again.
4. Once the refresh resolves, replay the original failed request(s) once each with the new `access_token`, then
   resolve their callers.
5. **If the refresh call itself fails** (its own non-2xx, e.g. the refresh token is expired/revoked per
   `refresh_tokens.revoked` in §4.17): clear both stored tokens, clear the in-memory user, and redirect to the
   login page (`/login`).

### 1.5 Logout

`POST /auth/logout` (Backend Spec §6.1) — bearer token required, revokes the refresh token server-side
(§4.17 `revoked` flag, §5).

Request body: none (route takes the current bearer token; revocation target is inferred server-side per §6.1's
description — *"revokes the refresh token"* with no request body listed).

Client-side on logout (regardless of the API call's outcome, to avoid a stuck-logged-in state if the network
is down): clear `access_token`, clear `refresh_token`, clear the in-memory `user` object, redirect to `/login`.

### 1.6 Generic error envelope (applies to every endpoint below)

From Backend Spec §12, verbatim shape:
```json
{
  "error": {
    "code": "FARM_NOT_FOUND",
    "message": "Human-readable message in the request's Accept-Language or user's preferred_language",
    "details": {}
  }
}
```
Status codes per §12: `404` not-found, `403` forbidden, `422` validation, `502` upstream-service failure
(Open-Meteo/Earth Engine outages) — the officer dashboard doesn't call weather/satellite endpoints directly, so
`502`s from this dashboard's own calls are not expected in normal operation.

---

## 2. Pages

### 2.0 Page Inventory

Cross-referenced against the routers actually defined in Backend Spec §6 and role-gated to `officer`/`admin`
(§5) or `officer`/`expert` where the router serves both:

| Page | Backend router(s) | Roles that see it |
|---|---|---|
| Login | `auth.py` | everyone (pre-auth) |
| Dashboard (hotspot map & insights) | `officer_dashboard.py` | `officer`, `admin` |
| CROPSAP Reports | `cropsap.py` | `officer` (broadcast), `expert` (view) |
| Expert / Review Queue | `expert_queue.py` | `expert`, `officer` |
| Case Detail | `diagnosis.py` (`GET /cases/{case_id}`), `advisory.py` | `expert`, `officer` |
| Profile & Settings | `auth.py` (`GET /auth/me`, `PATCH /auth/me`) | everyone (post-auth) |

No page is included for a router that doesn't exist for officers — e.g. there is **no farm list/detail page**
on this dashboard, because `farms.py` (§6.2) is scoped to `farm.owner_id == current_user.id` (§5) and officers
never own farms; officers only ever see farm-derived data through the aggregated `officer_dashboard.py`
endpoints. Similarly, `sourcing.py` and `sync.py` have no officer-facing UI — sourcing lookup is a farmer-app
feature and sync is Android-only (§6.11).

---

### 2.1 Login Page

**Endpoints:** `POST /auth/otp/request`, `POST /auth/otp/verify` (§1.1)

**Layout:**
- Screen 1: single input — Phone Number (`type="tel"`), one button "Send OTP".
- Screen 2: single input — OTP Code (`type="text"`, numeric keypad), phone number shown read-only above it,
  one button "Verify & Log In", one link "Resend OTP" (re-calls `POST /auth/otp/request`).

**Validation:** **[SPEC GAP]** — Backend Spec §4.1 only states `phone_number` is `text unique`; no format
validator (e.g. E.164 regex, digit count) is named anywhere in the spec, and no OTP-length rule is specified.
Frontend should apply a conservative client-side check (non-empty, digits only) until the backend defines and
documents a real validator — do not hardcode an assumed regex as if it were a backend rule.

**Error handling:** both calls return the §1.6 envelope on failure. Since this is a two-field, two-screen
flow (not a multi-field form), errors are surfaced as a **banner above the active input**, not per-field —
there's only ever one field active per screen.

---

### 2.2 Dashboard (Hotspot Map & Insights)

Role gate: `officer`, `admin` only (§6.10 header: *"role: officer, admin"*).

**Endpoints (all §6.10):**

1. `GET /dashboard/hotspots?district=&taluka=&since=&disease_code=`

Response (§6.10: *"Returns `[{taluka, lat, lng, confirmed_case_count, false_alarm_count,
dominant_disease_code}]`"*):
```json
[
  {
    "taluka": "Niphad",
    "lat": 20.0827,
    "lng": 74.1088,
    "confirmed_case_count": 14,
    "false_alarm_count": 3,
    "dominant_disease_code": "cotton_bollworm"
  },
  {
    "taluka": "Sinnar",
    "lat": 19.8496,
    "lng": 73.9962,
    "confirmed_case_count": 2,
    "false_alarm_count": 0,
    "dominant_disease_code": "soybean_rust"
  }
]
```
Empty state: `[]` — render "No confirmed cases in this district for the selected period."

2. `GET /dashboard/trends?district=&disease_code=&granularity=week`

Response shape: **[SPEC GAP]** — §6.10 describes this only as *"Time series of confirmed case counts, for
trend charts"* without naming the JSON fields. A reasonable inference kept consistent with the hotspots shape
above: `[{period_start, confirmed_case_count}]`, e.g.:
```json
[
  { "period_start": "2026-08-03", "confirmed_case_count": 6 },
  { "period_start": "2026-08-10", "confirmed_case_count": 9 }
]
```
This must be confirmed against the real implementation before the chart component is built.

3. `GET /dashboard/scouting-overlay?district=`

Response shape: **[SPEC GAP]** — §6.10 describes the *content* precisely (*"merges `risk_scores.triggered_alert=true`
farms not yet photo-confirmed with confirmed `diagnosis_cases`"*) but not the exact JSON keys. Given it's a map
overlay, it will need at minimum a point geometry and a status distinguishing "risk alert, unconfirmed" from
"confirmed case" per marker — exact field names TBD at implementation.

4. `GET /dashboard/expert-queue-summary?district=`

Response shape: **[SPEC GAP]** — §6.10 says *"Counts by status/priority"* only. Likely shape:
```json
{
  "by_status": { "pending": 12, "in_review": 4, "resolved": 40 },
  "by_priority": { "high": 3, "medium": 9, "low": 4 }
}
```
Not literal spec text — flagged for confirmation.

**Layout:**
- Filter bar: District (`select`), Taluka (`select`, populated after district chosen), Disease (`select`,
  from `disease_catalog` — no dedicated endpoint for this list exists in the spec; **[SPEC GAP]**, needs a
  disease-catalog lookup endpoint or a static import), Since (`date`).
- Leaflet map: one marker per `{lat, lng}` in the hotspots response, marker color keyed to
  `dominant_disease_code`, marker size scaled to `confirmed_case_count`. Clicking a marker opens a popup with
  `taluka`, `confirmed_case_count`, `false_alarm_count`, `dominant_disease_code`, and a link into the CROPSAP
  Reports page filtered to that taluka.
- Trend chart panel: line chart of `confirmed_case_count` over `period_start`, granularity toggle
  (`select`: week — only value the spec names).
- Queue-summary widget: small stat cards, one per status/priority bucket, each linking to the Expert Queue
  page pre-filtered.

**Actions:** none that write data — this page is read-only aggregation. No create/update/delete buttons.

**Error handling:** any `502`-class upstream failure is not expected here since these endpoints read only from
Postgres (§4.8, §4.9), not live weather/satellite calls — a failure here should surface as a toast ("Couldn't
load dashboard data, retrying…") not a full-page redirect.

---

### 2.3 CROPSAP Reports Page

Role gate: view — `officer`, `expert`; broadcast action — `officer` only (§6.7: *"POST .../broadcast | officer
only"*).

**Endpoint:** `GET /cropsap/reports?district=&taluka=&since=`

Response fields, from the `cropsap_reports` table (§4.13):
```json
[
  {
    "id": "9b1e2a40-...",
    "case_id": "7c4d1f00-...",
    "district": "Nashik",
    "taluka": "Niphad",
    "disease_code": "cotton_bollworm",
    "severity": "high",
    "reported_at": "2026-08-20T09:15:00Z",
    "broadcast_radius_km": null,
    "broadcast_sent_at": null
  }
]
```
Empty state: `[]` — "No CROPSAP reports for this filter."

**Table columns:**

| Column header | Field |
|---|---|
| Reported | `reported_at` |
| District | `district` |
| Taluka | `taluka` |
| Disease | `disease_code` (resolved to display name via `disease_catalog`, §4.4 — name lookup is a
frontend join, since this endpoint returns only the code) |
| Severity | `severity` |
| Broadcast status | derived: "Not sent" if `broadcast_sent_at` is null, else "Sent · {broadcast_radius_km} km" |
| Action | Broadcast button (see below) |

**Actions:**

- **Broadcast** button, visible only for `officer` role and only when `broadcast_sent_at` is null (a report
  already broadcast shouldn't offer the action again — the spec doesn't say re-broadcast is supported).
  - `POST /cropsap/reports/{report_id}/broadcast`
  - Request: `{ "radius_km": 10 }`
  - Response shape: **[SPEC GAP]** — §6.7 states the effect (*"sets `broadcast_radius_km`/`broadcast_sent_at`"*)
    but not the response body; assume it returns the updated `cropsap_reports` row and re-render that table row.
  - Input: numeric field, `type="number"`, no min/max specified in the spec — **[SPEC GAP]**, needs a sane
    range defined before shipping (e.g. reject 0 or negative client-side as a basic sanity check, not a
    documented backend rule).

**Report creation:** explicitly **not** a page action — §6.7 states reports are *"automatic on case
confirmation,"* not created via this UI. No "New Report" button exists.

**Error handling:** §1.6 envelope; broadcast failures surface as an inline row-level error (toast tied to that
specific row, not a full-page banner), since other rows in the table remain valid.

---

### 2.4 Expert / Review Queue Page

Role gate: `expert`, `officer` (§6.9 header).

**Endpoint:** `GET /expert-queue?status=&priority=&district=`

Response fields, from `expert_review_items` (§4.15):
```json
[
  {
    "id": "1a2b3c4d-...",
    "case_id": "7c4d1f00-...",
    "assigned_expert_id": null,
    "priority": "high",
    "status": "pending",
    "expert_verdict": null,
    "expert_notes": null,
    "resolved_at": null
  }
]
```
Empty state: `[]` — "Queue is clear for this filter."

**⚠ Spec inconsistency to flag, not silently fix:** §6.9 says results are *"ordered by priority desc then
created_at asc,"* but the `expert_review_items` table definition in §4.15 has **no `created_at` column**. As
written, the backend cannot actually sort by a field that doesn't exist. This needs to be resolved before
implementation — either add `created_at` to §4.15's table, or change the stated sort order — and the frontend
table's default sort should follow whichever the backend actually ships.

**Table columns:**

| Column header | Field |
|---|---|
| Case | `case_id` (linked to Case Detail page, §2.5) |
| Priority | `priority` |
| Status | `status` |
| Assigned to | `assigned_expert_id` (resolved to a name — **[SPEC GAP]**, this endpoint returns only the ID; a
name lookup join or an expanded response is needed) |
| Verdict | `expert_verdict` |
| Resolved | `resolved_at` |

**Filters:** Status (`select`: pending / in_review / resolved), Priority (`select`: low / medium / high),
District (`select`) — all three map directly to the three query params §6.9 names.

**Actions:**

- **Claim** button — visible only when `status === 'pending'` and (recommended, not stated explicitly in spec
  beyond the general auth model) `assigned_expert_id` is null.
  - `POST /expert-queue/{item_id}/claim`
  - Request body: none (§6.9: *"Sets `assigned_expert_id=current_user.id`, `status='in_review'`"* — inferred
    server-side from the bearer token).
- **Resolve** button — visible only when `status === 'in_review'`, opens a form:
  - Verdict (`select`, populated from `disease_catalog` — same lookup-endpoint gap noted in §2.2), required.
  - Notes (`textarea`), optional (§4.15: `expert_notes` is nullable).
  - `POST /expert-queue/{item_id}/resolve`
  - Request:
    ```json
    { "verdict_disease_code": "cotton_bollworm", "notes": "Confirmed on-site, matches photo." }
    ```
  - Response shape: **[SPEC GAP]**, assume updated item row.

**Validation:** `verdict_disease_code` must be one of `disease_catalog.code` (§4.4) — the spec names the FK
relationship but doesn't name a validator class (there is no validators layer named anywhere in
`BACKEND_SPEC.md`), so this must be enforced by the `select`'s option list rather than free text, plus whatever
server-side FK constraint Postgres itself provides.

---

### 2.5 Case Detail Page

Reached from Expert Queue or CROPSAP Reports. Role gate: `expert`, `officer` (inherits from the pages that
link into it).

**Endpoint:** `GET /cases/{case_id}` (§6.4: *"Full case detail: photos, on_device_result, server_result,
advisory (if present), follow_up (if present)"*)

Base fields from `diagnosis_cases` (§4.9); nested `photos`/`advisory`/`follow_up` shapes are **[SPEC GAP]** —
§6.4 names what's included but not the literal nesting/field names for the sub-objects:
```json
{
  "id": "7c4d1f00-...",
  "farm_id": "e1d2c3b4-...",
  "triggered_by": "risk_alert",
  "triggering_risk_score_id": "a9b8c7d6-...",
  "status": "confirmed",
  "on_device_result": { "disease_code": "cotton_bollworm", "confidence": 0.71, "model_version": "tflite-1.3" },
  "server_result": { "disease_code": "cotton_bollworm", "confidence": 0.93, "model_version": "efficientnet-2.1", "severity": "high" },
  "final_disease_code": "cotton_bollworm",
  "final_severity": "high",
  "confidence": 0.93,
  "outcome": null,
  "requires_expert_review": true,
  "gps_point": { "lat": 20.0827, "lng": 74.1088 },
  "captured_at": "2026-08-19T07:40:00Z",
  "synced_at": "2026-08-19T11:02:00Z",
  "created_at": "2026-08-19T07:40:00Z",
  "updated_at": "2026-08-19T11:05:00Z",
  "photos": "[SPEC GAP — array shape not defined beyond case_photos columns in §4.10]",
  "advisory": "[SPEC GAP — see GET /cases/{case_id}/advisory below for the fetch-separately alternative]",
  "follow_up": "[SPEC GAP — array/object shape not defined beyond follow_ups columns in §4.14]"
}
```

**Advisory sub-section** — fetched via its own endpoint per §6.5 rather than assumed to always be fully
inlined: `GET /cases/{case_id}/advisory`

Response fields from `advisories` (§4.11):
```json
{
  "id": "4d5e6f70-...",
  "case_id": "7c4d1f00-...",
  "version": 1,
  "ipm_cultural_actions": [
    { "action_key": "remove_infested_bolls", "language_variants": { "mr": "...", "hi": "...", "en": "Remove and destroy infested bolls" } }
  ],
  "ipm_biological_actions": [
    { "action_key": "release_trichogramma", "language_variants": { "mr": "...", "hi": "...", "en": "Release Trichogramma parasitoid" } }
  ],
  "chemical_recommendation": {
    "product_class": "Bt-based biopesticide",
    "dosage": "2",
    "unit": "ml/L",
    "frequency": "every 7 days",
    "application_timing": "evening",
    "pre_harvest_interval_days": 3
  },
  "generated_at": "2026-08-19T11:05:30Z"
}
```

**Layout:**
- Header: case status badge, disease name (resolved from `final_disease_code`), severity badge, confidence.
- Photo gallery: thumbnails from `case_photos` (§4.10 columns: `storage_key`, `is_recapture`,
  `leaf_segmentation_applied`, `uploaded_at`) — **[SPEC GAP]** on how `storage_key` becomes a viewable URL
  (presigned URL generation isn't specified for reads, only for the upload path in §10).
- On-device vs server result comparison panel.
- Advisory panel: cultural actions list, biological actions list, chemical recommendation block (only
  rendered if `chemical_recommendation` is non-null — matches the backend's hard rule in §4.11 that it's never
  populated without `pre_harvest_interval_days`).
- Follow-up panel: status, scheduled date, notes (from `follow_ups`, §4.14).
- Map pin: `gps_point`.

**Actions:**
- **Regenerate Advisory** — `POST /cases/{case_id}/advisory/regenerate`, visible only for `expert`/`officer`
  (§6.5: *"expert/officer only"*) and, per the advisory table's own note (§4.11), most relevant when the case
  `status === 'escalated'`. No request body specified in §6.5.

---

### 2.6 Profile & Settings Page

**Endpoints:** `GET /auth/me`, `PATCH /auth/me` (§6.1: *"update `preferred_language`, `full_name`"*)

**Layout:**
- Full Name (`text`)
- Preferred Language (`select`: `mr` / `hi` / `en` — the three values named in §4.1)
- Phone Number, Role, District, Taluka shown **read-only** (not in §6.1's list of updatable fields)

**Action:** Save button → `PATCH /auth/me`
```json
{ "preferred_language": "hi", "full_name": "Anita R. Deshmukh" }
```
Both fields optional per-request (send only what changed) — §6.1 doesn't say the whole object is required.

**Validation:** **[SPEC GAP]** — no max-length or format validator is named for `full_name` anywhere in the
spec (§4.1 just says `text`). `preferred_language` should be a closed `select`, not free text, since it's an
enum in §4.1.

---

## 3. Conditional Rendering

**Important limitation, stated plainly:** the backend spec has no HATEOAS response links and no named policy
constants file, so this section cannot be written the way the original prompt assumed. What follows is the
closest real mechanism the spec defines: role checks against the `role` field returned by `GET /auth/me` /
present on the login response's `user` object, matched against each router's stated role gate.

### 3.1 Role → UI element mapping

| Backend role gate (from §5 / router headers in §6) | UI elements it unlocks |
|---|---|
| `require_role("officer", "admin")` — §6.10 | Dashboard page (§2.2) entirely; Broadcast button on CROPSAP Reports (§2.3) |
| `require_role("officer", "expert")` — §6.9 | Expert Queue page (§2.4) |
| `require_role("officer", "expert")` — §6.7 (view only) | CROPSAP Reports page, view (§2.3) |
| any authenticated role — §5, §6.1 | Profile & Settings page (§2.6) |
| `farmer` | No dashboard pages — a `farmer`-role token should never reach this app; if the frontend ever sees
`role: "farmer"` post-login, treat it as a routing error and redirect away from the dashboard shell entirely (this app is officials-only). |

### 3.2 Ownership-based scoping (not role-based, but also gates the UI)

Per §5's rule for the `farms.py` router (*"Farmers can only read/write resources where
`farm.owner_id == current_user.id`"*), and per §6.9's expert-queue district scoping (*"Experts see
`expert_review_items` filtered to their `district`/`taluka` unless `assigned_expert_id` is explicitly them"*):
the frontend should default all district/taluka filter controls (§2.2, §2.4) to the logged-in user's own
`district`/`taluka` (from `GET /auth/me`) rather than showing "all districts" by default — matching what the
backend will actually return unfiltered vs. what it silently scopes.

### 3.3 What the prompt asked for that doesn't apply here

- **HATEOAS `rel`-based button visibility**: not implementable — no response in `BACKEND_SPEC.md` includes
  link objects. If this is wanted, it needs to be added to the backend spec (and then the implementation)
  before frontend work can use it; until then, buttons are gated by the role table in §3.1 plus the row-level
  status conditions noted per-action in §2 (e.g. Claim only on `status='pending'`).
- **Named policy-constants file citation**: no such file exists in the spec to cite. The closest artifact is
  the `require_role(*roles)` dependency described in §5, referenced per-router in §6.

---

## 4. Paging

Backend Spec §6 (router-group intro): *"All list endpoints paginated via `?limit=&cursor=` (cursor = last
row's `id` ...)."* This is **cursor pagination**, not the page-number pagination in the original prompt — the
concepts of `page`, `pageSize`, `totalCount`, `totalPages` do not exist in this backend's design.

### 4.1 Query parameters

| Param | Meaning |
|---|---|
| `limit` | max rows to return |
| `cursor` | the `id` of the last row from the previous page; omitted for the first page |

Applies to the list endpoints in §6: `GET /farms/{farm_id}/risk-history` (§6.3), `GET /farms/{farm_id}/cases`
(§6.4), `GET /cropsap/reports` (§6.7), `GET /expert-queue` (§6.9) — the last two are the ones this dashboard
actually uses.

### 4.2 Response shape

**[SPEC GAP]** — §6's intro states the pagination *mechanism* (cursor + limit) but never gives the literal
response envelope field names. The two endpoints this dashboard calls (§6.7, §6.9) are both documented in
their own sections as returning bare arrays (see the JSON examples in §2.3 and §2.4 above), with no visible
`cursor`/`next_cursor` wrapper field shown anywhere in the spec text. This is a real gap: as written, a bare
array response gives the frontend no way to know the next cursor value. Before building the pager component,
this needs one of:
- the backend wrapping list responses as `{ items: [...], next_cursor: string | null }`, or
- the backend returning the cursor via a response header,
and that decision should be added back into `BACKEND_SPEC.md` §6 so it's a single source of truth.

### 4.3 UI (pending §4.2's resolution)

Given cursor pagination (not numbered pages), the natural UI is **"Load more" / infinite scroll**, not a
numbered page control — numbered pages imply random access to page N, which a cursor design doesn't support
without extra backend work. Recommended pattern for both the CROPSAP Reports table (§2.3) and Expert Queue
table (§2.4):
- A "Load more" button (or scroll-triggered fetch) appended below the table, disabled/hidden when the last
  response's `next_cursor` (once defined per §4.2) is null.
- **Page size selector**: `limit` mapped to a `select` (e.g. 25 / 50 / 100), refetching from the first page
  (no cursor) when changed.
- **Loading state**: skeleton rows appended below existing rows while the next batch loads (not a full-table
  spinner, since existing rows stay visible during "load more").
- **Empty state**: as specified per-page in §2.3/§2.4 ("No CROPSAP reports…" / "Queue is clear…"), shown only
  when the *first* page returns empty — not repeated on subsequent empty "load more" clicks, which instead
  just disable the button.

---

## 5. Open Items — Must Be Resolved Before Frontend Build Starts

Collected from the **[SPEC GAP]** markers above, so this is a single checklist rather than something buried
in prose:

1. **Auth error codes** — enumerate the real `code` values `/auth/otp/verify` and `/auth/refresh` can return.
2. **Token storage strategy** — cookie vs. localStorage vs. memory; whether the backend will set an `HttpOnly`
   cookie itself.
3. **`/auth/refresh` response shape** — confirm whether the refresh token rotates.
4. **`/dashboard/trends` and `/dashboard/scouting-overlay` and `/dashboard/expert-queue-summary` response
   field names** — currently only described in prose in §6.10, not as JSON.
5. **Disease-catalog lookup endpoint** — no route in §6 exposes `disease_catalog` (§4.4) directly, but three
   different pages (§2.2, §2.3, §2.4) need it for filter dropdowns and verdict selection.
6. **`expert_review_items` missing `created_at`** — §6.9's stated sort order references a column §4.15 doesn't
   define. Needs a schema fix.
7. **`assigned_expert_id` → display name** — `GET /expert-queue` (§4.15) returns only a UUID; the queue table
   needs a name, meaning either an expanded response or a client-side user lookup.
8. **`GET /cases/{case_id}` nested `photos`/`advisory`/`follow_up` shapes** — §6.4 names what's included, not
   the literal JSON structure.
9. **Photo viewing URL** — `case_photos.storage_key` (§4.10) is an internal storage path; no read-side
   presigned-URL mechanism is specified (§10 only covers the upload path).
10. **List-endpoint pagination envelope** — see §4.2; this blocks building any "load more" control at all.
11. **Broadcast `radius_km` bounds** — no min/max specified in §6.7.
