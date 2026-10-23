# CropSathi Frontend UI Remediation Plan (FIX_PLAN.md)

**Date:** October 23, 2026  
**Status:** In Progress — Step-by-Step Execution  
**Strategy:** Fix one issue/root-cause at a time with scoped minimal diffs, immediate multi-viewport verification (Desktop 1440x900, Tablet 768x1024, Mobile 390x844 & 360x740), regression testing, and atomic git commits.

---

## 1. Critical & High Priority Issues

| Priority | Issue ID | Summary | Files to Touch | Risk Level |
| :---: | :--- | :--- | :--- | :---: |
| 1 | **UI-001** | Unauthorized redirect dumps users to raw directory index | `frontend/auth-guard.js`, `frontend/config.js` | Low |
| 2 | **UI-002** | Field selector dropdown collapses to 35px width on mobile | `frontend/analytics.html` | Low |
| 3 | **UI-003** | Leaflet map height pushes field form below fold on mobile | `frontend/add-field.html` | Low |
| 4 | **UI-004** | Form inputs and select elements lack explicit `<label for="...">` associations | `frontend/add-field.html`, `frontend/settings.html` | Very Low |
| 5 | **UI-005** | Undersized touch targets (<44x44px) on mobile navigation and buttons | `frontend/ui.css`, `frontend/analytics.html`, `frontend/dashboard.html`, `frontend/advisory.html` | Low |
| 6 | **UI-006** | Custom toggle switches missing accessible names (aria-label) | `frontend/settings.html` | Very Low |
| 7 | **UI-007** | Advisory detail error state missing icon hydration | `frontend/advisory-detail.js` | Very Low |
| 8 | **UI-008** | Modal & drawer collisions with fixed mobile bottom tab bar | `frontend/diagnose.html`, `frontend/ui.css` | Low |

---

## 2. Shared Root-Cause Fixes (Batch Remediations)

| Priority | Root Cause | Summary & Issues Solved | Files to Touch | Risk Level |
| :---: | :--- | :--- | :--- | :---: |
| 9 | **Root Cause 3** | Sub-12px micro-typography and low contrast on `--forest-400` (**UI-010, UI-014**) | `frontend/tokens.css`, `frontend/theme.css` | Low |
| 10 | **Root Cause 4** | Missing favicon declaration on all pages (**UI-019**) | All 11 HTML files in `frontend/` | Very Low |

---

## 3. Medium & Low Priority Issues

| Priority | Issue ID | Summary | Files to Touch | Risk Level |
| :---: | :--- | :--- | :--- | :---: |
| 11 | **UI-009** | Mojibake UTF-8 character encoding (`â€”`) in document title | `frontend/notifications.html` | Very Low |
| 12 | **UI-012** | Login form lacks client-side validation and hangs indefinitely | `frontend/login.html` | Low |
| 13 | **UI-013** | Hero marketing panel hidden entirely on tablet viewport | `frontend/login.html` | Low |
| 14 | **UI-015** | Satellite telemetry cards lack informative pending flyover state | `frontend/dashboard.html` | Low |
| 15 | **UI-016** | Photo dropzone copy displays desktop drag-and-drop on mobile | `frontend/diagnose.html` | Low |
| 16 | **UI-017** | Spray window badge and action CTA flex wrapping collision on 360px | `frontend/advisory.js` | Low |
| 17 | **UI-018** | Dialog form content cut off on small mobile viewports (height <=667px) | `frontend/settings.html` | Low |
| 18 | **UI-020** | Dead dummy links (`href="#"`) in login footer | `frontend/login.html` | Very Low |
| 19 | **UI-021** | Inconsistent search input placeholder copy across secondary toolbars | `frontend/my-fields.html` | Very Low |
| 20 | **UI-022** | Disabled 2FA card shows active pointer cursor on row hover | `frontend/settings.html` | Very Low |
| 21 | **UI-023** | Sub-pixel avatar initial baseline shift in mobile topbar | `frontend/dashboard.html`, `frontend/nav-profile.js` | Very Low |
| 22 | **UI-024** | Cramped touch targets on quick language switcher inside profile dropdown | `frontend/nav-profile.js` | Very Low |
| 23 | **UI-011** | Tailwind CDN production console warning | `frontend/*.html` (Note: Needs review / static build alignment) | Medium |

---

## Verification Strategy
- **Per-Issue Verification:** Run CDP headless Chrome to re-capture screenshots and check DOM computed metrics at 1440x900, 768x1024, 390x844, and 360x740.
- **Atomic Commits:** Format `fix(ui): <ID> <description>`.
- **Report Updates:** Update `UI_AUDIT_REPORT.md` with status `FIXED` and commit hash for each item.
