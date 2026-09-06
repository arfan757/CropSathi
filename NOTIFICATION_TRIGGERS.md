# Notification Triggers — All Notifications Visible in Bell Icon

The bell icon in the top app bar (left of profile photo) opens the dropdown panel created by `frontend/notifications.js`. All notifications below appear there.

## Trigger List (Every Notification Type)

### 1. advisory_ready — HIGH
- **When:** Diagnosis `status = confirmed` (line 413 in diagnosisService.js)
- **Trigger:** After `generateAdvisoryForCase()` succeeds
- **What farmer sees:** "Treatment Advisory Ready" — link to advisory page
- **Code:** Added to `saveGeminiResult()` in diagnosisService.js

### 2. remedy_reminder — HIGH  
- **When:** Remedy application due (from advisory plan frequency)
- **Trigger:** `notificationDispatch.js` cron scans `reminders` table
- **What farmer sees:** "Apply Treatment Reminder" — link to advisory
- **Code:** `reminderService.scheduleRemindersFromAdvisory()` creates reminder; cron creates notification

### 3. reapplication_reminder — HIGH
- **When:** Multi-dose remedy next dose due (e.g., every 7 days, 3 applications)
- **Trigger:** `reminderService` creates next reminder when previous marked done
- **What farmer sees:** "Reapply Treatment" — link to advisory

### 4. follow_up_check — MEDIUM
- **When:** Follow-up `scheduledFor` date reached
- **Trigger:** `followupScan.js` cron (daily 07:00 UTC) finds pending follow-ups
- **What farmer sees:** "Follow-up Check Needed" — asks "Did you apply? How does crop look?"
- **Code:** Creates notification + increments `reminderCount`

### 5. harvest_safety_wait — URGENT
- **When:** Chemical used, within `pre_harvest_interval_days` window
- **Trigger:** `advisoryService` when `chemical_recommendation` exists
- **What farmer sees:** "Pre-Harvest Safety Notice" — wait before harvest
- **Safety rule:** Never generated without `pre_harvest_interval_days` (spec §4.11)

### 6. escalation_alert — URGENT
- **When:** Farmer reports "worse" OR health_score keeps declining through follow-up cycles → CROPSAP referral
- **Trigger:** `followupService.completeFollowUp()` when `cropCondition === 'worse'`
- **What farmer sees:** "Case Escalated to CROPSAP" — expert review initiated
- **Also:** After 2 reminder nudges with no response → `unresponsive` status, passive monitoring continues

### 7. weather_alert — MEDIUM
- **When:** Health score `triggeredAlert = true` (≥40 Elevated, <40 High)
- **Trigger:** `pollContinuous.js` when `composite_score` crosses crop-specific threshold
- **What farmer sees:** "Weather Alert" — disease-conducive conditions detected, please upload photo
- **Important:** Never triggers remedy directly — only prompts photo upload (false-alarm gate)

## How All Become Visible in Bell Icon

The `NotificationPanel` class (`frontend/notifications.js`):
1. Attaches click listener to existing `[aria-label="Notifications"]` button
2. On open → fetches `/api/notifications?limit=20` → renders dropdown
3. Updates badge count via `/api/notifications/unread-count`
4. Polls every 30 seconds when tab visible → new notifications appear automatically
5. Clicking item → marks read + navigates to deep link (advisory page, follow-up page, etc.)
6. Mark all read button clears badge instantly

The bell is visible **on every page** (dashboard, diagnose, advisory, settings, analytics) because it's in the shared header HTML.
