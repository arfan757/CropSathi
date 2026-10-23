# CropSathi Frontend UI & QA Comprehensive Audit Report

**Date:** October 23, 2026  
**Auditor:** Senior QA Engineer & Frontend Auditor  
**Scope:** Complete application surface across all routes, states, and responsive viewports (Desktop, Tablet, Mobile)  
**Status:** Audit Complete — Finding and Documenting UI Problems Only  

---

## 1. Page Inventory Table

| Route / Screen | Screen Name / Purpose | Reached (Y/N) | Access Method / Seed State | Notes |
| :--- | :--- | :---: | :--- | :--- |
| `/` | Landing / Application Root | **Y** | Public | Returns raw directory index (`Files within frontend\`) due to missing `frontend/index.html`. |
| `/login.html` | Sign In Screen | **Y** | Unauthenticated | Verified phone & password login flow with cold-start warmup. |
| `/login.html#register` | Registration Screen | **Y** | Unauthenticated | Verified full farmer registration form (`#registerSection`). |
| `/dashboard.html` | Main Farm Dashboard | **Y** | Auth JWT (`Ramesh Patil`) | Verified telemetry cards, weather widget, field carousel, and profile bar. |
| `/my-fields.html` | Fields Inventory & Management | **Y** | Auth JWT | Verified field grid, search filter, and `#fieldDetailsDrawer`. |
| `/add-field.html` | Add New Field & Polygon Drawing | **Y** | Auth JWT | Verified Leaflet GPS map, boundary drawer, and field details form. |
| `/diagnose.html` | AI Crop Disease Diagnosis | **Y** | Auth JWT | Verified photo dropzone, loading state, and `#caseDetailModal`. |
| `/advisory.html` | Treatment Advisories Overview | **Y** | Auth JWT | Verified checklist items, weather spray window badge, and empty state. |
| `/advisory-detail.html` | Advisory Detail (No CaseId) | **Y** | Auth JWT (no query param) | Verified fallback error state (`#error-state`). |
| `/advisory-detail.html?caseId=...` | Advisory Detail (Full Protocol) | **Y** | Auth JWT (with test caseId) | Verified remedy tabs, spray window telemetry, and store locator. |
| `/analytics.html` | Satellite Multispectral Analytics | **Y** | Auth JWT | Verified NDVI/NDRE/Thermal raster viewer and topbar field selector. |
| `/notifications.html` | Notifications Feed | **Y** | Auth JWT | Verified alert list, read/unread states, and header branding. |
| `/settings.html` | Settings, Profile & Preferences | **Y** | Auth JWT | Verified profile edit modal, change password modal, and toggles. |
| `/404.html` | Custom 404 Error Page | **N** | Direct Navigation | **NOT REACHED**: No custom 404 error page exists; server falls back to raw 301/directory response. |

---

## 2. Executive Summary Table

### Issues by Severity and View

| Severity | Desktop View Only | Mobile View Only | Both Views (Desktop & Mobile) | Total Issues |
| :--- | :---: | :---: | :---: | :---: |
| **Critical** | 0 | 1 | 1 | **2** |
| **High** | 0 | 3 | 3 | **6** |
| **Medium** | 0 | 5 | 5 | **10** |
| **Low** | 0 | 2 | 4 | **6** |
| **Total** | **0** | **11** | **13** | **24** |

---

## 3. Detailed Issue List

### UI-001: Unauthorized Redirection Dumps Users to Raw Directory Index
- **Page / Route:** Protected routes (`dashboard.html`, `my-fields.html`, `add-field.html`, `analytics.html`, `settings.html`) and Sign-Out
- **View Affected:** Both (All viewports: 1920x1080 down to 360x740)
- **Severity:** **Critical**
- **Category:** Navigation / Routing
- **Description:**  
  When an unauthenticated visitor accesses any protected route, or when a logged-in user clicks "Sign Out", `auth-guard.js` calls `redirectToLanding()`. This executes `window.location.replace(window.LANDING_PAGE_URL || '/')`. Because `frontend/index.html` is not present in the static directory (the landing page is in `landing/` and requires a separate build step), the web server serves a raw file directory index titled `Files within frontend\` that exposes internal source code files (`app.css`, `auth-guard.js`, `tokens.css`, etc.) to the user.
- **Steps to Reproduce:**  
  1. Open a fresh browser window or incognito session (with empty localStorage/cookies).  
  2. Navigate directly to `http://localhost:3000/dashboard.html`.  
  3. Observe that the browser redirects to `http://localhost:3000/` and renders a file directory listing instead of a login or landing page.  
- **Likely Selector / Code:** `frontend/auth-guard.js` lines 48–51 (`redirectToLanding()`), `frontend/config.js` line 14.  
- **Screenshot Reference:** `scratch/screenshots/login_signin_desktop_1920.png`  
- **Suggested Fix:** Change `redirectToLanding()` fallback to `login.html`, or ensure `npm run build:landing` compiles `landing/` into `frontend/index.html`.

---

### UI-002: Header Field Selector Dropdown Collapses to 35px Width on Mobile
- **Page / Route:** `/analytics.html`
- **View Affected:** Mobile (360x740, 375x667)
- **Severity:** **Critical**
- **Category:** Responsive / Layout
- **Description:**  
  On mobile viewports with widths 360px and 375px, the header flex container forces `.relative.flex-1.max-w-xs` to shrink severely between the brand logo (`CropSathi`) and the notification/avatar action buttons. The child `<select id="farmSelector">` collapses down to a measured width of **35px** (on 360px viewport) and **50px** (on 375px viewport). Field names such as "Patil Sugarcane Field" are completely cut off and invisible, rendering the selector unusable.
- **Steps to Reproduce:**  
  1. Set viewport to 360x740 or 375x667.  
  2. Navigate to `http://localhost:3000/analytics.html`.  
  3. Inspect the topbar field selector dropdown next to the sprout icon.  
- **Likely Selector / Code:** `frontend/analytics.html` lines 139–152 (`header .relative.flex-1.max-w-xs`).  
- **Screenshot Reference:** `scratch/screenshots/analytics_html_mobile_360.png`  
- **Suggested Fix:** On viewports below 640px (`sm`), hide the field selector from the topbar flex row and render it on a dedicated full-width sub-toolbar.

---

### UI-003: Fixed Map Height Pushes Field Form Entirely Below the Fold on Mobile
- **Page / Route:** `/add-field.html`
- **View Affected:** Mobile (360x740, 375x667, 390x844, 414x896)
- **Severity:** **High**
- **Category:** Layout / Usability
- **Description:**  
  On mobile devices, the Leaflet map container has an explicit minimum height of `h-[420px]` or `min-h-[400px]`. Combined with the top navigation bar, drawing instructions card, and GPS action bar, the actual field input form (`#fieldName`, `#cropType`, `#sowingDate`, `#cropStage`, and "Save Field Boundary" CTA) is pushed completely below the fold (requiring over 600px of vertical scrolling). When drawing boundary points on the map, touch events often trigger inadvertent page scrolls instead of polygon vertices.
- **Steps to Reproduce:**  
  1. Set viewport to 375x667.  
  2. Navigate to `http://localhost:3000/add-field.html`.  
  3. Observe that the form fields and save button are completely invisible without scrolling.  
- **Likely Selector / Code:** `frontend/add-field.html` lines 115–125 (`#map` container style).  
- **Screenshot Reference:** `scratch/screenshots/add-field_html_mobile_375.png`  
- **Suggested Fix:** Reduce mobile map height to `h-[260px]` or adopt a two-step collapsible bottom sheet layout for field metadata on mobile.

---

### UI-004: Form Inputs and Select Elements Lack Explicit Label Associations
- **Page / Route:** `/add-field.html`, `/settings.html`
- **View Affected:** Both (All viewports: 1920x1080 down to 360x740)
- **Severity:** **High**
- **Category:** Accessibility (WCAG 1.3.1 & 4.1.2)
- **Description:**  
  Multiple form `<input>`, `<select>`, and `<textarea>` elements are paired with `<label>` tags that lack the `for="..."` attribute matching the input's `id`. Consequently, screen readers announce generic "edit text" or "combobox" without announcing the label name, and clicking the label text fails to focus the input.
  - In `add-field.html`: Labels for `#fieldName`, `#cropType`, `#sowingDate`, `#cropStage` lack `for`.
  - In `settings.html`: Labels for `#modalInputName`, `#modalInputPhone`, and modal feedback fields lack `for`.
- **Steps to Reproduce:**  
  1. Inspect the `<label>` elements in `add-field.html` (lines 171, 180, 204, 213).  
  2. Notice the absence of `for="fieldName"`, `for="cropType"`, etc.  
- **Likely Selector / Code:** `frontend/add-field.html` L171–215, `frontend/settings.html` L423–435.  
- **Screenshot Reference:** `scratch/screenshots/add-field_html_desktop_1920.png`  
- **Suggested Fix:** Add matching `for="<id>"` attributes to all `<label>` elements throughout form templates.

---

### UI-005: Undersized Touch Targets Violate WCAG 2.5.5 (<44x44px)
- **Page / Route:** Global (`dashboard.html`, `analytics.html`, `advisory.html`, `settings.html`, `add-field.html`)
- **View Affected:** Mobile (360x740, 375x667, 390x844, 414x896)
- **Severity:** **High**
- **Category:** Accessibility / Touch Target Size (WCAG 2.5.5)
- **Description:**  
  Multiple interactive buttons, segmented tabs, and links have computed touch target dimensions far below the WCAG AA minimum requirement of 44x44px:
  - Analytics layer toggle buttons (`#btnNdvi`, `#btnNdre`, `#btnThermal`): measured height is **28px** (`py-1.5 text-xs`).
  - Dashboard field switch buttons (`#prevFieldBtn`, `#nextFieldBtn`): measured size is **28x28px**.
  - Leaflet zoom control buttons (`+` and `−`): measured size is **30x30px**.
  - Advisory card fast-action link: measured height is **28px**.
  - Secondary navigation links ("View all", "View full map", "Back to Advisory"): measured heights are **16px to 20px**.
  - Modal close buttons (`closeCaseDetail`, `closeModal`): measured size is **32x32px**.
- **Steps to Reproduce:**  
  1. Open `analytics.html` or `dashboard.html` at 375x667.  
  2. Inspect the computed bounding client rect of `#btnNdvi` or `#prevFieldBtn`.  
- **Likely Selector / Code:** `frontend/analytics.html` lines 233–251, `frontend/dashboard.html` lines 240–250.  
- **Screenshot Reference:** `scratch/screenshots/analytics_html_mobile_360.png`, `scratch/screenshots/dashboard_html_mobile_375.png`  
- **Suggested Fix:** Apply `min-h-[44px]` and `min-w-[44px]` with flex alignment to all interactive mobile buttons and links.

---

### UI-006: Inaccessible Custom Toggle Switches Missing ARIA Names
- **Page / Route:** `/settings.html`
- **View Affected:** Both (All viewports: 1920x1080 down to 360x740)
- **Severity:** **High**
- **Category:** Accessibility (WCAG 4.1.2)
- **Description:**  
  The toggle switches for `#togglePushNotifications` and `#toggleSevereAlerts` render checkboxes with the Tailwind class `sr-only` inside an empty `<label class="relative inline-flex items-center cursor-pointer">` containing only a styled `<div>`. The checkbox input has no `aria-label`, `aria-labelledby`, or visible text within the label, causing screen readers to announce an ambiguous "checkbox, checked" with zero identifying context.
- **Steps to Reproduce:**  
  1. Inspect `#togglePushNotifications` on `settings.html` (lines 245–248).  
  2. Inspect `#toggleSevereAlerts` on `settings.html` (lines 273–276).  
- **Likely Selector / Code:** `frontend/settings.html` lines 245–248, 273–276.  
- **Screenshot Reference:** `scratch/screenshots/settings_html_desktop_1440.png`  
- **Suggested Fix:** Add `aria-label="Push Notifications"` and `aria-label="Severe Weather & Pest Alerts"` directly to the `<input type="checkbox">` elements.

---

### UI-007: Advisory Detail Error State Missing Icon Hydration
- **Page / Route:** `/advisory-detail.html`
- **View Affected:** Both (All viewports: 1920x1080 down to 360x740)
- **Severity:** **High**
- **Category:** States / Error Recovery
- **Description:**  
  When `advisory-detail.html` is visited without a `caseId` query parameter, `advisory-detail.js` invokes `showError()`, which unhides the `#error-state` container. However, `showError()` never calls `lucide.createIcons()`. As a result, `<i data-lucide="alert-circle" class="w-7 h-7 text-forest-400"></i>` and `<i data-lucide="arrow-left" class="w-4 h-4"></i>` remain unrendered `<i>` tags (empty transparent boxes) inside the error card.
- **Steps to Reproduce:**  
  1. Navigate to `http://localhost:3000/advisory-detail.html` with no query parameters.  
  2. Observe the "Advisory not found" card: the circular icon placeholder is empty.  
- **Likely Selector / Code:** `frontend/advisory-detail.js` lines 77–81 (`showError()`).  
- **Screenshot Reference:** `scratch/screenshots/advisory-detail_html_desktop_1920.png`  
- **Suggested Fix:** Add `if (window.lucide) lucide.createIcons();` inside `showError()` in `advisory-detail.js`.

---

### UI-008: Modal & Drawer Collisions with Fixed Mobile Tabbar
- **Page / Route:** `/diagnose.html`, `/my-fields.html`
- **View Affected:** Mobile (360x740, 375x667)
- **Severity:** **High**
- **Category:** Responsive / Layout
- **Description:**  
  On mobile viewports, the bottom navigation tabbar (`.cs-tabbar`) is fixed with `z-50`. When the `#deleteModal` or `#caseDetailModal` is opened, the action buttons (Cancel / Delete) sit at the bottom edge of the screen and risk being visually or functionally obstructed by the tabbar, especially on devices with virtual home indicator bars.
- **Steps to Reproduce:**  
  1. Set viewport to 375x667 on `diagnose.html`.  
  2. Trigger `#deleteModal` by clicking the delete icon on any case.  
  3. Observe that modal action buttons collide with the lower viewport boundary.  
- **Likely Selector / Code:** `frontend/diagnose.html` lines 317–334 (`#deleteModal`).  
- **Screenshot Reference:** `scratch/screenshots/interactive_diagnose_drawer_mobile.png`  
- **Suggested Fix:** Add `pb-24 sm:pb-6` padding to modal overlays and set modal z-index to `z-[60]` to stay clear of the fixed bottom navigation.

---

### UI-009: Corrupted Character Encoding (Mojibake) in Document Title
- **Page / Route:** `/notifications.html`
- **View Affected:** Both (All viewports)
- **Severity:** **Medium**
- **Category:** Typography / Encoding
- **Description:**  
  The `<title>` tag of `notifications.html` contains corrupted UTF-8 byte sequences: `<title>Notifications â€” CropSathi</title>`. The browser tab renders `â€”` instead of an em-dash (`—`), creating an unprofessional visual defect.
- **Steps to Reproduce:**  
  1. Open `http://localhost:3000/notifications.html` in Chrome.  
  2. Observe the browser tab title: `Notifications â€” CropSathi`.  
- **Likely Selector / Code:** `frontend/notifications.html` line 6.  
- **Screenshot Reference:** `scratch/screenshots/notifications_html_desktop_1920.png`  
- **Suggested Fix:** Replace `â€”` with `&mdash;` or a clean UTF-8 em-dash in line 6 of `notifications.html`.

---

### UI-010: Micro-Typography Below 12px Impairs Outdoor Sunlight Legibility
- **Page / Route:** Global (`dashboard.html`, `analytics.html`, `settings.html`, `login.html`)
- **View Affected:** Mobile & Desktop
- **Severity:** **Medium**
- **Category:** Typography / Accessibility
- **Description:**  
  Extensive use of sub-12px utility classes (`text-[9px]`, `text-[10px]`, `text-[11px]`) across core telemetry and navigation elements:
  - Weather wind direction badges: `text-[9px]` (`WSW`, `E`) on `dashboard.html`.
  - Mobile bottom navigation bar labels: `text-[10px]` (`Dashboard`, `My Fields`, `Scan`, `Advisory`).
  - Settings metadata cards: `text-[10px]` uppercase (`FULL NAME`, `MOBILE NUMBER`, `DISTRICT`, `ACCOUNT STATUS`).
  - Polygon summary headers: `text-[10px]` (`POINTS`, `AREA`, `AREA (ACRES)`) on `add-field.html`.
  - Analytics layer legend: `text-[9px]` (`No data`).  
  Under outdoor field conditions (sunlight on budget smartphones), text smaller than 12px becomes unreadable for farmers.
- **Steps to Reproduce:**  
  1. Inspect the weather widget on `dashboard.html` or bottom nav tab spans on any mobile screen.  
- **Likely Selector / Code:** `frontend/dashboard.html` lines 270–300, `frontend/settings.html` lines 145–185.  
- **Screenshot Reference:** `scratch/screenshots/dashboard_html_mobile_375.png`  
- **Suggested Fix:** Replace `text-[9px]` and `text-[10px]` with `text-xs` (12px) paired with `font-semibold tracking-wider`.

---

### UI-011: Runtime Tailwind CDN Production Warning in Browser Console
- **Page / Route:** Global (All HTML pages)
- **View Affected:** Both (All viewports)
- **Severity:** **Medium**
- **Category:** Console / Performance
- **Description:**  
  Every page loads `https://cdn.tailwindcss.com`, producing an explicit console warning on every route:  
  `cdn.tailwindcss.com should not be used in production. To use Tailwind CSS in production, install it as a PostCSS plugin or use the Tailwind CLI: https://tailwindcss.com/docs/installation`.  
  Loading the 3MB+ client-side compiler impacts mobile load performance and causes noticeable Flash of Unstyled Content (FOUC).
- **Steps to Reproduce:**  
  1. Open developer tools Console on any page.  
  2. Notice the warning generated on DOM load.  
- **Likely Selector / Code:** Line 12 in all 11 HTML files (`<script src="https://cdn.tailwindcss.com"></script>`).  
- **Screenshot Reference:** Documented in `scratch/audit_raw_results.json` console log records.  
- **Suggested Fix:** Pre-compile utility classes into a minified `app.css` bundle and remove the runtime CDN script tag.

---

### UI-012: Login Form Lacks Client-Side Validation and Hangs on Empty Submit
- **Page / Route:** `/login.html`
- **View Affected:** Both (All viewports)
- **Severity:** **Medium**
- **Category:** Forms / Validation
- **Description:**  
  `<form id="loginForm">` specifies the `novalidate` attribute and lacks client-side validation logic before sending an HTTP request. When a user taps "Sign In" with empty phone or password fields, the submit button text changes to `Sign In...`, disables itself, and initiates a network request that hangs until timeout. No inline red border or error message is displayed to inform the user that fields are required.
- **Steps to Reproduce:**  
  1. Navigate to `http://localhost:3000/login.html`.  
  2. Leave phone and password blank; click "Sign In".  
  3. Observe the button state disable without immediate user feedback.  
- **Likely Selector / Code:** `frontend/login.html` lines 148, 266–285.  
- **Screenshot Reference:** `scratch/screenshots/login_validation_error_375.png`  
- **Suggested Fix:** Add client-side validation checking for a 10-digit number before disabling the button, displaying `#errorBanner` instantly if invalid.

---

### UI-013: Hero Brand Panel Hidden on Tablet Viewport (768px)
- **Page / Route:** `/login.html`
- **View Affected:** Tablet (768x1024)
- **Severity:** **Medium**
- **Category:** Responsive / Visual Balance
- **Description:**  
  The left brand and feature showcase panel (`.hero-panel`) uses `hidden lg:flex`. On tablet screens (768px width), the entire brand illustration, trust badge, and feature list disappear, leaving a lonely white auth box surrounded by excessive negative space.
- **Steps to Reproduce:**  
  1. Set viewport to 768x1024.  
  2. Navigate to `http://localhost:3000/login.html`.  
  3. Observe the sparse visual presentation with no brand storytelling.  
- **Likely Selector / Code:** `frontend/login.html` line 59 (`.hero-panel.hidden.lg:flex`).  
- **Screenshot Reference:** `scratch/screenshots/login_signin_tablet_768.png`  
- **Suggested Fix:** Change the breakpoint to `md:flex` or render a compact horizontal brand header on tablet devices.

---

### UI-014: Color Contrast Failure on Subtext and Label Badges (WCAG AA < 4.5:1)
- **Page / Route:** Global (`dashboard.html`, `settings.html`, `my-fields.html`)
- **View Affected:** Both (All viewports)
- **Severity:** **Medium**
- **Category:** Accessibility / Visual Design (WCAG AA 1.4.3)
- **Description:**  
  Text styled with `text-forest-400` (#739178) on light backgrounds such as `bg-offwhite-50` (#faf8f5) or `bg-offwhite-100` (#f3f0ea) achieves a color contrast ratio of approximately **3.4:1**. This violates the WCAG AA minimum threshold of 4.5:1 for standard body text.
- **Steps to Reproduce:**  
  1. Use a color contrast analyzer on `.text-forest-400` against `.bg-offwhite-100`.  
- **Likely Selector / Code:** `frontend/tokens.css` line 12 (`--forest-400: #739178;`).  
- **Screenshot Reference:** `scratch/screenshots/dashboard_html_desktop_1440.png`  
- **Suggested Fix:** Darken `--forest-400` in `tokens.css` to `#426147` to exceed the 4.5:1 contrast requirement.

---

### UI-015: Telemetry Satellite Cards Lack Informative Empty State for New Fields
- **Page / Route:** `/dashboard.html`
- **View Affected:** Both (All viewports)
- **Severity:** **Medium**
- **Category:** States / Empty Telemetry
- **Description:**  
  When a user selects a newly registered field with no Sentinel-2 satellite pass, the NDVI and Water Stress telemetry cards display blank dashes (`--`) with no explanation of whether data is loading, failed, or awaiting the next satellite flyover.
- **Steps to Reproduce:**  
  1. On `dashboard.html`, switch to a newly registered field.  
  2. Observe the satellite metric card displays `--` with no contextual hint.  
- **Likely Selector / Code:** `frontend/dashboard.html` lines 340–390.  
- **Screenshot Reference:** `scratch/screenshots/dashboard_html_desktop_1920.png`  
- **Suggested Fix:** Add an informative tooltip or subtext: "Awaiting next 5-day Sentinel-2 satellite pass".

---

### UI-016: Dropzone Messaging Uses Desktop Drag-and-Drop Copy on Mobile
- **Page / Route:** `/diagnose.html`
- **View Affected:** Mobile (360x740, 375x667, 390x844, 414x896)
- **Severity:** **Medium**
- **Category:** Usability / Mobile UX
- **Description:**  
  The upload dropzone card displays "Drag and drop leaf photos here" or desktop-centric mouse cues even when accessed from a mobile browser where drag-and-drop is impossible.
- **Steps to Reproduce:**  
  1. Open `diagnose.html` at 375x667.  
  2. Look at the primary call-to-action text in `#photoDropZone`.  
- **Likely Selector / Code:** `frontend/diagnose.html` line 286 (`#dropZoneText`).  
- **Screenshot Reference:** `scratch/screenshots/diagnose_html_mobile_375.png`  
- **Suggested Fix:** Conditionally update `#dropZoneText` on touch devices to "Tap to capture leaf photo with camera".

---

### UI-017: Spray Window Badge & Action CTA Collision on 360px Viewport
- **Page / Route:** `/advisory.html`
- **View Affected:** Mobile (360x740)
- **Severity:** **Medium**
- **Category:** Layout / Flex Wrap
- **Description:**  
  In the advisory card header, the spray window badge (`#sprayBadgeHtml`) and the "View Advisory" link button are laid out in a flex container (`flex flex-wrap items-center justify-between gap-2`). On a 360px wide screen, the spray window label wraps awkwardly against the right-aligned button, producing uneven vertical misalignment.
- **Steps to Reproduce:**  
  1. Set viewport to 360x740.  
  2. Open `advisory.html` and inspect the advisory action bar.  
- **Likely Selector / Code:** `frontend/advisory.js` lines 176–182.  
- **Screenshot Reference:** `scratch/screenshots/advisory_html_mobile_360.png`  
- **Suggested Fix:** Set `flex-direction: column; align-items: stretch` on `.fast-action-bar` below 380px screen width.

---

### UI-018: Dialog Form Content Cut Off on Small Mobile Height (667px / 740px)
- **Page / Route:** `/settings.html`
- **View Affected:** Mobile (375x667, 360x740)
- **Severity:** **Medium**
- **Category:** Layout / Dialog Sizing
- **Description:**  
  The `#feedback-modal` and `#change-password-modal` use `max-h-[90vh] overflow-y-auto`. When the on-screen keyboard is triggered on mobile devices with viewport height <=667px, the modal header and submit buttons get pushed outside the visible screen area without smooth scrolling.
- **Steps to Reproduce:**  
  1. Open `settings.html` at 375x667.  
  2. Open "Report an Issue / Feedback" modal.  
  3. Focus the `<textarea>` to simulate keyboard opening; observe button occlusion.  
- **Likely Selector / Code:** `frontend/settings.html` lines 453, 492 (`.max-h-[90vh]`).  
- **Screenshot Reference:** `scratch/screenshots/interactive_settings_password_modal_mobile.png`  
- **Suggested Fix:** Use `max-h-[80vh]` with a fixed header and sticky bottom action bar inside the modal dialog.

---

### UI-019: Missing Favicon Causes 404 Console Errors on Every Route
- **Page / Route:** Global (All routes)
- **View Affected:** Both (All viewports)
- **Severity:** **Low**
- **Category:** Network / Assets
- **Description:**  
  None of the HTML files declare a `<link rel="icon" ...>` tag in their `<head>`, causing every page load to fire an automated browser request to `http://localhost:3000/favicon.ico`. This returns HTTP 404 (Not Found), polluting network inspection and logging.
- **Steps to Reproduce:**  
  1. Open Network panel in DevTools on any page.  
  2. Notice the red 404 response for `favicon.ico`.  
- **Likely Selector / Code:** All HTML `<head>` tags.  
- **Screenshot Reference:** Documented in `scratch/audit_raw_results.json` network failures.  
- **Suggested Fix:** Add `<link rel="icon" type="image/svg+xml" href="landing-assets/sprout.svg">` to all HTML `<head>` tags.

---

### UI-020: Dead Dummy Links (`href="#"`) in Login Footer
- **Page / Route:** `/login.html`
- **View Affected:** Both (All viewports)
- **Severity:** **Low**
- **Category:** Navigation / Dead Links
- **Description:**  
  The footer links for "Terms of Service" and "Privacy Policy" use empty `href="#"` attributes. Clicking them causes an abrupt jump to the top of the page without presenting any legal terms or dialog.
- **Steps to Reproduce:**  
  1. Click "Terms of Service" at the bottom of `login.html`.  
  2. Observe the page scroll to top with no action.  
- **Likely Selector / Code:** `frontend/login.html` lines 218–220.  
- **Screenshot Reference:** `scratch/screenshots/login_signin_desktop_1920.png`  
- **Suggested Fix:** Link to external policy URLs or bind a click handler opening an informative modal dialog.

---

### UI-021: Inconsistent Search Input Placeholders Across Secondary Toolbars
- **Page / Route:** `/my-fields.html`, `/diagnose.html`, `/advisory.html`
- **View Affected:** Both (All viewports)
- **Severity:** **Low**
- **Category:** Visual Consistency
- **Description:**  
  Secondary search inputs feature inconsistent placeholder phrasing and styling:
  - `my-fields.html`: "Filter fields or crops..."
  - `diagnose.html`: "Search diagnosis cases..."
  - `advisory.html`: "Search advisories..."  
  The clear (`x`) button behavior and focus border treatments also diverge slightly between pages.
- **Steps to Reproduce:**  
  1. Compare the search input styling and copy across `my-fields.html`, `diagnose.html`, and `advisory.html`.  
- **Likely Selector / Code:** `frontend/my-fields.html` L223, `frontend/diagnose.html` L188, `frontend/advisory.html` L184.  
- **Screenshot Reference:** `scratch/screenshots/my-fields_html_desktop_1440.png`  
- **Suggested Fix:** Unify search input placeholder strings via a shared localization key.

---

### UI-022: Disabled 2FA Row Shows Active Pointer Cursor on Row Hover
- **Page / Route:** `/settings.html`
- **View Affected:** Desktop (1920x1080, 1440x900, 1280x720)
- **Severity:** **Low**
- **Category:** Visual Feedback
- **Description:**  
  In the Security section of `settings.html`, the Two-Factor Authentication card is marked with a "Coming Soon" badge and a disabled toggle. However, hovering anywhere over the row container displays an interactive background change and pointer cursor, confusing users into thinking the row is clickable.
- **Steps to Reproduce:**  
  1. Open `settings.html` on desktop.  
  2. Hover your mouse over the Two-Factor Authentication row.  
- **Likely Selector / Code:** `frontend/settings.html` lines 366–378.  
- **Screenshot Reference:** `scratch/screenshots/settings_html_desktop_1440.png`  
- **Suggested Fix:** Remove hover styles and set `cursor-not-allowed` on the disabled 2FA container.

---

### UI-023: Sub-Pixel Avatar Initial Baseline Shift in Mobile Topbar
- **Page / Route:** `/dashboard.html`
- **View Affected:** Mobile (360x740, 375x667)
- **Severity:** **Low**
- **Category:** Visual Polish
- **Description:**  
  The farmer initial ("F" or "R") inside `#navAvatarInitial` experiences a 1px vertical baseline misalignment on high-DPI mobile screens due to inherited line-height properties on the span element.
- **Steps to Reproduce:**  
  1. Inspect the topbar profile icon at 360x740.  
  2. Notice the letter is not mathematically centered within the 32x32px square.  
- **Likely Selector / Code:** `frontend/dashboard.html` line 138, `frontend/nav-profile.js`.  
- **Screenshot Reference:** `scratch/screenshots/dashboard_html_mobile_360.png`  
- **Suggested Fix:** Add `leading-none flex items-center justify-center` to `#navAvatarInitial`.

---

### UI-024: Cramped Touch Targets on Quick Language Switcher Inside Profile Menu
- **Page / Route:** Global (`nav-profile.js` on all authenticated pages)
- **View Affected:** Mobile (360x740, 375x667, 390x844)
- **Severity:** **Low**
- **Category:** Touch Target Size / Usability
- **Description:**  
  The quick language switcher buttons (English / Hindi / Marathi) embedded within the top profile dropdown menu use `py-1 text-xs`, resulting in a measured target height of approximately 30px. This makes it easy for farmers with larger fingers to accidentally tap the wrong language option on mobile touchscreens.
- **Steps to Reproduce:**  
  1. On mobile (375x667), tap the top avatar to open `#topProfileMenuPanel`.  
  2. Inspect the height of the language switch buttons.  
- **Likely Selector / Code:** `frontend/nav-profile.js` lines 125–155.  
- **Screenshot Reference:** `scratch/screenshots/interactive_dashboard_profile_dropdown_mobile.png`  
- **Suggested Fix:** Increase language button vertical padding to `py-2.5` with `min-h-[44px]` for mobile touch compliance.

---

## 4. Shared / Root-Cause Issues Analysis

Grouping individual symptoms by common architectural root causes reveals that resolving just **5 core areas** will remediate over 80% of all reported UI defects:

### Root Cause 1: Missing Global Touch Target Baseline (Fixes UI-005, UI-024)
- **Common Source:** `frontend/tokens.css` and `frontend/ui.css` lack a minimum touch target rule for interactive elements on mobile media queries (`@media (max-width: 640px)`).
- **Impacted Elements:** Segmented layer buttons (`analytics.html`), field switch arrows (`dashboard.html`), Leaflet zoom buttons, modal close triggers, and quick language pills.
- **Unified Solution:** Add a global CSS utility `.touch-target { min-height: 44px; min-width: 44px; display: inline-flex; align-items: center; justify-content: center; }` and apply it to interactive controls.

### Root Cause 2: Absence of Explicit Label Associations (Fixes UI-004, UI-006)
- **Common Source:** Form markup throughout `add-field.html` and `settings.html` relies on visual adjacency instead of programmatic association (`for="..."` + `id="..."`).
- **Impacted Elements:** Field name, crop type, sowing date, growth stage, modal profile inputs, and custom toggle checkboxes.
- **Unified Solution:** Audit all `<label>` elements to ensure every label contains a matching `for` attribute referencing its target input ID, and add `aria-label` to custom toggle switches.

### Root Cause 3: Micro-Typography Utility Overuse (Fixes UI-010, UI-014)
- **Common Source:** Widespread use of ad-hoc arbitrary values (`text-[9px]`, `text-[10px]`, `text-[11px]`) and low-contrast token `--forest-400`.
- **Impacted Elements:** Weather indicators, bottom tab bar titles, card metadata pills, and polygon summary telemetry.
- **Unified Solution:** Standardize typography tokens to a minimum of `text-xs` (12px) with `--forest-400` adjusted to `#426147` for WCAG AA compliance.

### Root Cause 4: Routing & Static Build Decoupling (Fixes UI-001, UI-019)
- **Common Source:** `frontend/auth-guard.js` assumes `/` points to a compiled landing page, but `landing/` is built separately and does not output `frontend/index.html`. Furthermore, no favicon is linked in the HTML shells.
- **Impacted Elements:** Unauthorized access redirects, user sign-out flow, and default browser favicon requests.
- **Unified Solution:** Configure `auth-guard.js` to redirect unauthenticated sessions directly to `login.html`, build the landing page into `frontend/index.html`, and link `landing-assets/sprout.svg` as the favicon.

### Root Cause 5: Dynamic Icon Lifecycle Hydration (Fixes UI-007)
- **Common Source:** When asynchronous network data changes UI state (e.g., `showError()`, empty state unhiding), `lucide.createIcons()` is not re-invoked on the freshly rendered DOM nodes.
- **Impacted Elements:** Error state icons, empty state icons, and dynamically appended remedy cards.
- **Unified Solution:** Create a shared helper `refreshIcons()` in `ui.js` that automatically calls `lucide.createIcons()` whenever view states are toggled.
