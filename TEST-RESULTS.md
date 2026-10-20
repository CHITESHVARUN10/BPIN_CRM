# BPIN Service CRM — End-to-End Test Results

Tested: 2026-10-17 · via agent-browser (headless Chrome, two parallel sessions: super admin + test technician) + API spot-checks.
Scope: everything the admin asked to verify — admin creates user, assignment hand-out, technician assessment with photo upload, record visibility from both roles, admin filters/reports, close → reopen → close loop, notifications, CSV/PDF exports, logs, products CRUD, dialogs/skeletons, forbidden/404 pages, dark mode.

## Deployment-readiness re-test — 2026-10-20

This pass re-tested the direct browser→Blob upload build and every deployment-critical path.

| Area | Result | Evidence |
|---|---|---|
| Backend API routes | **PASS** | 37/37 route scenarios: auth, users/permissions, products, problems, assignments, records, media token/config/delete, file streaming/ETag, notifications, push subscription, reports/activity/summary/CSV/PDF, logs, health, 404s |
| Backend test suite | **PASS** | 34/34 tests (assignments, media ownership, users permissions, recovery, date/ObjectId validation) |
| Cron tests + config | **PASS** | 3/3 reminder tests; Vercel config validates; all three cron handlers enforce `CRON_SECRET` |
| Frontend build/lint | **PASS** | Vite build clean; changed-file lint 0 warnings/0 errors (6 pre-existing repo warnings remain) |
| Browser E2E | **PASS** | Super admin, staff admin, technician sessions; all pages/routes; forbidden/404; dark/light; QR fallback; logout; invalid login; password change |
| Direct media | **PASS** | Photo + 6 MB video uploaded browser→Blob; `head()` verified; media streamed back with ETag/304; draft survived reload |
| Failure/retry | **PASS** | Backend stopped during save → explicit retry panel + draft/media preserved → retry succeeded idempotently |
| Backup pipeline | **PASS** | Real Blob + local Drive mirror: started/worked/completed; 8 collections + media; checksums; rotation deleted old run; `BACKUPS.json` written |
| Recovery pipeline | **PASS** | Generated checkpoint dry-run + full `both` restore into scratch Mongo with local Blob mirror; indexes/references/assets verified |
| Cron cleanup | **PASS** | Orphan staged files deleted after TTL; referenced media retained; reminder handler auth 401/200 verified |
| Seed script | **PASS** | Fresh DB seeded 1,177 products, 13 engineers, 7 admins, 31 problems; second run created no duplicates |
| Dependency audit | **PASS** | `npm audit --omit=dev --audit-level=high` clean in backend, frontend, backup-cron |

### Defects found and fixed in this pass
| # | Defect | Fix |
|---|---|---|
| D1 | Deep-link HTML responses used `Cache-Control: public, max-age=0` instead of `no-cache`; SPA HEAD requests 404'd | Set `no-cache` on SPA fallback; support GET/HEAD |
| D2 | Invalid ObjectIds on assignment/notification/product/problem/user/record routes returned 500 CastErrors | Explicit ID validation (400/404) + generic CastError/ValidationError → 400 boundary |
| D3 | Invalid report/activity/reminder dates returned 500 | Validated date parser; invalid dates now 400 |
| D4 | Any signed-in technician could read another technician's media by pathname | `/api/files` now requires own upload prefix or a record owned by that technician (admins can read all) |
| D5 | Recovery inventory cached the Drive root, hiding new checkpoints and showing rotated/deleted ones | Drive cache invalidation on checkpoint list/load |
| D6 | Inactive engineers appeared in the assignment creation dropdown | Create dropdown filters inactive engineers (filter dropdown still shows them for history) |
| D7 | PDF export discarded `from`/`to` range metadata | Export query now passes the actual range to the PDF builder |
| D8 | `xlsx` was a production dependency although only the local seed script uses it | Moved to `devDependencies`; production audit now clean |

### Deployment notes
- Backend remains the Render web service; frontend remains Vercel with the `/api/*` rewrite. Direct browser→Blob uploads bypass Vercel's 4.5 MB rewrite/function body limit.
- Required production env: `MONGODB_URI_NEW`, `SESSION_SECRET`, `BLOB_READ_WRITE_TOKEN`, Google service-account/Shared Drive keys for recovery, and optional VAPID keys for Web Push.
- Google Drive was exercised through the supported local mirror; live Shared Drive credentials were not used in this test. Web Push delivery and QR camera capture still require HTTPS and a real device/browser permission — APIs/fallbacks were verified.
- The frontend rewrite destination in `frontend/vercel.json` must match the deployed Render service URL.


## UI walkthrough results

| # | Test | Result | Notes |
|---|------|--------|-------|
| 1 | Admin login (super admin) → dashboard | PASS | All 9 sidebar sections present |
| 2 | Admin creates technician "Ravi Kumar (Test)" via Users → Add user modal | PASS | Toast + appears in list instantly |
| 3 | Admin creates assignment (customer, phone, address, pincode, date, timing) | PASS | Created, pending for the test technician |
| 4 | Technician login (new credentials) → TechHome stats + reminders banner | PASS (after fix, see B1) | Stats showed 0/0/0 initially |
| 5 | Visits tab: assignment detail (customer, tappable phone link, address, timing, notes, "By BPIN Admin") | PASS | Status chip Pending; Mark done button present |
| 6 | New Assessment: product search ("costa mesa 985"), serial typed, vehicle, customer report, preloaded problem select ("Touch Not Working"), optional notes | PASS | Preloaded problem list renders from DB |
| 7 | Photo upload: logo.png via camera/gallery input | PASS | Client-compressed → Cloudinary URL → served back on detail |
| 8 | Submit → token generated | PASS | `17102026-0001` (proves daily reset; previous day's counter was higher) |
| 9 | Technician Records list + detail page (all fields, photos, status Open, Close/Follow-up buttons) | PASS | |
| 10 | Admin Records tab (day view: date, technician, model, problem, status) | PASS | Row found for 17-10-2026 |
| 11 | Admin Reports: "This month" + "All technicians" | PASS (after fix, see B2) | 4 records incl. the new one; the bug from your review is fixed |
| 12 | Reports filters: technician select, problem select, status (open/closed), model (searchable SKU picker), custom range | PASS | Combinations stay consistent (0 results when nothing matches) |
| 13 | Technician closes case (work-done description + proof photo) | PASS (after fix, see B3) | Status → Closed; verified in DB |
| 14 | Closed record view (technician): "Closed" chip + Case-closure card (who/when/work done/proof image) | PASS | |
| 15 | Admin sees closed case in Reports (status filter) + detail + Reopen button | PASS | |
| 16 | Admin reopens case → technician gets "Case reopened" notification | PASS | Bell unread + item visible; status → Open |
| 17 | Engineer closes again after reopen | PASS | Closed count back to 1 |
| 18 | CSV export (browser-triggered + in-page fetch validation) | PASS | 200 · BOM · correct headers (S.No/Token No/…/Images count) · 3 data rows |
| 19 | PDF export (browser-triggered; file parsed) | PASS | 200 · valid %PDF · logo header + range + table with all 3 rows + timestamp |
| 20 | Activity page: per-technician counts + "No submission today" | PASS | Ravi showed "1" + last report time; 13 inactive engineers listed |
| 21 | Nudge (in-app reminder) from Activity → toast + delivery | PASS | "reminders sent: 1"; Dharam's feed got "Pending service report for 17-10-2026" |
| 22 | Products page: search + category filter, create product, edit product | PASS | TEST-UI-SKU created; edit reflected; both logged |
| 23 | Duplicate SKU rejection | PASS (API) | 409 "SKU TEST-UI-SKU already exists"; technician POST → 403 Forbidden |
| 24 | Logs page + action filter | PASS | "Case closed" filter showed the technician's two closings with role chips; product/reopen entries present |
| 25 | Users: Deactivate → confirmation dialog → Cancel keeps account active | PASS | Dialog copy clear |
| 26 | Super-admin rule: staff admin PATCHes another admin | PASS (API) | 403 "Only the super admin can manage other administrators"; super admin PATCH → 200 |
| 27 | Forbidden page: technician opens /admin/* | PASS | "Access denied" card + Back to home |
| 28 | Not-found page: unknown URL | PASS (after fix, see B5) | "Page not found" card with shell context |
| 29 | Dark mode: rendering across tech + admin pages | PASS (after fix, see C1) | Screenshots in test-artifacts/ |
| 30 | Light mode toggle + persistence (localStorage) | PASS | Moon/Sun toggle flips; body/aside computed styles verified |
| 31 | Notification permission UX: enable flow states, banner while unset | PASS (visual) | "Turn on reminders?" banner; Enable wired to VAPID public key (actual push needs HTTPS deploy + keys — see N3) |
| 32 | QR scanner fallback (no camera / headless) | PASS (after fix, see B4) | Graceful "Camera permission was denied… Enter manually" card; overlay closes clean; no crash |

## Bugs found during testing — all FIXED
| # | Bug | Severity | Fix |
|---|-----|----------|-----|
| B1 | Technician pages rendered a blank screen (bell card used `BellRing` without importing it) | Critical | Added the missing import |
| B2 | "This month + All technicians" showed nothing (admin listing fell back to the admin's own records) | Critical (the one you reported) | Admin with no technician filter now sees everyone |
| B3 | New Assessment crashed on mount (draft persistence used `useRef` without importing it) | Critical | Added import |
| B4 | QR scanner: React StrictMode double-mount called `stop()` on a never-started scanner → uncaught "Cannot stop, scanner is not running" | Medium | stop() guarded |
| B5 | 404 route redirected unknown URLs to home while auth was still loading (user momentarily null at boot) | Medium | NotFound now waits for auth to resolve |
| B6 | Dark mode only partially applied (utility remaps inside `@layer base` lost to Tailwind's utilities layer → white content background in dark) | Medium | Remap block moved out of the layer |
| B7 | Stale cached index.html after rebuild served old hashed chunks (blank pages during testing; would bite users after every deploy) | Medium | `Cache-Control: no-cache` for HTML responses |

## Notes (not fixing — flagged for decisions)
| # | Note |
|---|------|
| N1 | CSV export does not include closure "work done" text or follow-up assessments (primary assessment columns only). Decide if closure details belong in future exports. |
| N2 | Invalid date params in export URLs return a Mongoose cast error message (`Cast to date failed…`) instead of a friendly 400. Cosmetic; boundary validation later. |
| N3 | Web Push delivery needs VAPID keys + HTTPS in production (browser rule). The in-app bell works everywhere meanwhile — tested. |
| N4 | QR camera only works on HTTPS/localhost by browser rule; the manual-entry fallback is verified. |
| N5 | The native date input couldn't be typed into by headless automation (segmented spinbuttons); real picker events work — no user-facing issue found. |
| N6 | The agent-browser harness relaunched mid-test a few times (cookie drops), noisy but attributed to the harness, not the app (verified via one-shot command chains). |

Test assets: screenshots in `test-artifacts/`.
Demo data left in local DB: user **ravi.test@blaupunktcar.in** (password withheld from the repo), assignment "Mrs. Ananya Das" (done), case `17102026-0001` (closed). Test products cleaned up.
