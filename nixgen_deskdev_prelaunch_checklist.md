# Nixgen + DeskDev Pre-Launch Checklist

Use this as the production-readiness checklist before connecting either project to a real domain.

Status convention:
- [ ] Not started
- [x] Done
- P0 = launch blocker

---

# Nixgen Marketing Solutions

## 1. Sitewide Frontend QA — P0
- [ ] Check every page manually from top to bottom.
- [ ] Check desktop, tablet, and mobile.
- [ ] Test Chrome, Edge, Safari, and Firefox where practical.
- [ ] Check navigation menu.
- [ ] Check mobile navigation.
- [ ] Check sticky header behavior.
- [ ] Check logo links back to homepage.
- [ ] Test every CTA button.
- [ ] Test every internal link.
- [ ] Test every external link.
- [ ] Check footer links.
- [ ] Check social media links.
- [ ] Check hover states.
- [ ] Check animations.
- [ ] Check accordions/tabs.
- [ ] Check popups/modals.
- [ ] Check text wrapping.
- [ ] Check section spacing.
- [ ] Check images for stretching or blurriness.
- [ ] Check icons.
- [ ] Check broken images.
- [ ] Check for horizontal scrolling on mobile.
- [ ] Check browser back/forward navigation.
- [ ] Check 404 page.

### Main pages
- [ ] Homepage
- [ ] Services
- [ ] Web Design / Development
- [ ] SEO
- [ ] Automation / AI services
- [ ] Portfolio
- [ ] About
- [ ] Pricing / Packages
- [ ] Contact
- [ ] Privacy Policy
- [ ] Terms & Conditions
- [ ] Landing pages

## 2. Nixgen Conversion Flow — P0
- [ ] Homepage → Services → Portfolio/Case Study → Pricing → Book a Call/Contact works.
- [ ] Book a Call works.
- [ ] Get Started works.
- [ ] Contact Us works.
- [ ] Pricing CTA works.
- [ ] Portfolio CTA works.
- [ ] Booking integration works if used.
- [ ] Form entries reach the correct destination.
- [ ] Email notifications work.
- [ ] Auto-response works.
- [ ] Leads are stored somewhere, not just emailed.
- [ ] Spam submissions are controlled.
- [ ] Thank-you page works.
- [ ] Conversion tracking fires.

## 3. Forms — P0
- [ ] Required fields work.
- [ ] Invalid email addresses are rejected.
- [ ] Phone validation works.
- [ ] Long messages do not break layout/database.
- [ ] Form cannot submit repeatedly by accident.
- [ ] Spam protection enabled.
- [ ] reCAPTCHA/Turnstile enabled if appropriate.
- [ ] Success state displayed.
- [ ] Error state displayed.
- [ ] Submission reaches correct email.
- [ ] Submission saved to CRM/database if applicable.
- [ ] Mobile form works.
- [ ] Test using Gmail.
- [ ] Test another email provider.

## 4. Nixgen Packages & Pricing — P0
- [ ] Correct package prices.
- [ ] Correct monthly maintenance prices.
- [ ] Correct page limits.
- [ ] Correct inclusions.
- [ ] Correct exclusions.
- [ ] No old pricing anywhere.
- [ ] No contradictory package information.
- [ ] CTA under every package works.
- [ ] One-time vs recurring fees are clearly explained.

## 5. Portfolio
- [ ] Every portfolio item opens.
- [ ] Correct screenshots.
- [ ] Images optimized.
- [ ] Correct project descriptions.
- [ ] Correct services listed.
- [ ] No confidential client data visible.
- [ ] Links to live projects work.
- [ ] Case studies added where possible.
- [ ] Before/after examples display properly.
- [ ] Portfolio works well on mobile.

## 6. SEO — P0
- [ ] Unique title tag per indexable page.
- [ ] Unique meta description.
- [ ] One primary H1.
- [ ] Logical H2/H3 hierarchy.
- [ ] Descriptive URLs.
- [ ] Canonical URLs.
- [ ] Image alt text.
- [ ] Open Graph title.
- [ ] Open Graph description.
- [ ] Social sharing image.
- [ ] Twitter/X metadata if needed.
- [ ] Organization schema.
- [ ] LocalBusiness schema if appropriate.
- [ ] Service schema.
- [ ] Breadcrumb schema if applicable.
- [ ] FAQ schema only where appropriate.
- [ ] robots.txt configured.
- [ ] sitemap.xml configured.
- [ ] Sitemap submitted to Google Search Console.
- [ ] Google Search Console verified.
- [ ] No staging URLs indexed.
- [ ] No accidental noindex.
- [ ] Canonicals do not point to development domain.
- [ ] Search site/repository for old development URLs.

## 7. Analytics
- [ ] GA4 installed.
- [ ] Google Tag Manager installed if used.
- [ ] Search Console connected.
- [ ] Contact submissions tracked.
- [ ] Book-call clicks tracked.
- [ ] Phone clicks tracked.
- [ ] Email clicks tracked.
- [ ] Pricing CTA clicks tracked.
- [ ] Thank-you page conversion tracked.
- [ ] Analytics do not fire twice.

## 8. Email Deliverability — P0
- [ ] Professional domain email active.
- [ ] SPF configured.
- [ ] DKIM configured.
- [ ] DMARC configured.
- [ ] Website sender address uses the domain.
- [ ] SMTP/API mail provider configured.
- [ ] Contact emails are not going to spam.
- [ ] Reply-to address correct.
- [ ] Test form notifications.
- [ ] Test booking notifications.

## 9. Performance
- [ ] Compress hero images.
- [ ] Use WebP/AVIF where appropriate.
- [ ] Lazy-load below-the-fold images.
- [ ] Avoid huge background videos.
- [ ] Minimize unnecessary scripts.
- [ ] Check Core Web Vitals.
- [ ] Check mobile Lighthouse.
- [ ] Check desktop Lighthouse.
- [ ] Remove unused tracking scripts.
- [ ] Optimize fonts.
- [ ] Prevent layout shifts.
- [ ] Check LCP.
- [ ] Check CLS.
- [ ] Check INP.

## 10. Security
- [ ] HTTPS works.
- [ ] HTTP redirects to HTTPS.
- [ ] Security headers configured.
- [ ] Forms protected from spam/bots.
- [ ] API keys are not exposed.
- [ ] No .env files publicly accessible.
- [ ] Development/debug mode removed.
- [ ] Test accounts removed.
- [ ] Dependencies/plugins updated.
- [ ] Administrator access limited.
- [ ] Backup configured.

## 11. Nixgen Domain Launch — P0
- [ ] Production build ready.
- [ ] Backup created.
- [ ] DNS records documented.
- [ ] Production environment variables configured.
- [ ] SSL configured.
- [ ] Email DNS records preserved.
- [ ] Staging deployment remains available.
- [ ] Production URLs configured.
- [ ] Analytics configured with real domain.
- [ ] OAuth callbacks updated if applicable.
- [ ] Homepage opens after DNS switch.
- [ ] www/non-www behavior correct.
- [ ] HTTPS valid.
- [ ] Forms work after launch.
- [ ] Email works after launch.
- [ ] Booking works after launch.
- [ ] Analytics works after launch.
- [ ] Search Console works.
- [ ] Sitemap accessible.
- [ ] No mixed-content warnings.

---

# DeskDev

## 1. Frontend — P0
- [ ] Open every page.
- [ ] Scroll every page completely.
- [ ] Click every button.
- [ ] Test every menu.
- [ ] Test dropdowns.
- [ ] Test modals.
- [ ] Test filters.
- [ ] Test search.
- [ ] Test tables.
- [ ] Test pagination.
- [ ] Test sorting.
- [ ] Test upload/download.
- [ ] Test drag/drop if available.
- [ ] Check loading states.
- [ ] Check skeleton states.
- [ ] Check error states.
- [ ] Check empty states.
- [ ] Check success messages.
- [ ] Check confirmation dialogs.
- [ ] Check tooltips.
- [ ] Check mobile responsiveness.
- [ ] Check tablet layout.
- [ ] Check large desktop layout.
- [ ] Test browser refresh from important routes.
- [ ] Test direct links.
- [ ] Test browser back/forward navigation.

## 2. Authentication — P0
- [ ] Sign-up.
- [ ] Login.
- [ ] Logout.
- [ ] Forgot password.
- [ ] Reset password.
- [ ] Email verification.
- [ ] Expired verification link.
- [ ] Expired session.
- [ ] Session refresh.
- [ ] Remember-me behavior if used.
- [ ] Incorrect password.
- [ ] Nonexistent account.
- [ ] Duplicate registration.
- [ ] Disabled account.
- [ ] Unauthorized route access.
- [ ] Backend enforces permissions, not just frontend UI.

## 3. Role & Permission Testing — P0
- [ ] Guest permissions verified.
- [ ] Normal user permissions verified.
- [ ] Admin permissions verified.
- [ ] Users cannot view another user's private data.
- [ ] Users cannot modify another user's private data.
- [ ] Admin routes are blocked for non-admin users.
- [ ] System settings are blocked for non-admin users.

## 4. Database — P0
- [ ] Production DB separate from development.
- [ ] Database schema finalized.
- [ ] Migrations saved.
- [ ] Migrations work on a clean database.
- [ ] Foreign keys correct.
- [ ] Unique constraints configured.
- [ ] Required fields enforced.
- [ ] Indexes configured.
- [ ] Large queries optimized.
- [ ] Pagination implemented.
- [ ] Duplicate records prevented.
- [ ] Orphaned records prevented.
- [ ] Timestamps correct.
- [ ] Timezones correct.
- [ ] Soft-delete behavior tested.
- [ ] Hard-delete behavior tested.
- [ ] Cascade deletion reviewed.
- [ ] Backup active.

## 5. API / Backend — P0
- [ ] Authentication checked on protected endpoints.
- [ ] Authorization checked on protected endpoints.
- [ ] Input validation.
- [ ] Response validation.
- [ ] Rate limiting.
- [ ] Error handling.
- [ ] Proper HTTP status codes.
- [ ] Pagination.
- [ ] Timeout handling.
- [ ] Retry handling.
- [ ] Idempotency where needed.
- [ ] Duplicate request handling.
- [ ] SQL injection protection.
- [ ] XSS handling.
- [ ] CSRF protection where applicable.
- [ ] No stack traces exposed.
- [ ] No secrets returned.
- [ ] No unnecessary user data returned.

## 6. Abuse / Failure Testing
- [ ] Empty inputs handled safely.
- [ ] Huge inputs handled safely.
- [ ] Extremely long filenames handled.
- [ ] Unsupported file types rejected.
- [ ] Double submissions handled.
- [ ] Repeated clicking does not create duplicates.
- [ ] Refresh during submission is safe.
- [ ] Slow network behavior tested.
- [ ] Offline connection behavior tested.
- [ ] API timeout behavior tested.
- [ ] HTML/script injection attempts handled safely.
- [ ] Path traversal attempts handled safely.

## 7. File Uploads — P0 if used
- [ ] Allowed extensions enforced.
- [ ] MIME validation.
- [ ] Max upload size.
- [ ] Filename sanitization.
- [ ] Unique storage IDs.
- [ ] Private files remain private.
- [ ] Signed URLs expire where applicable.
- [ ] Users cannot alter URLs to access another user's files.
- [ ] File deletion works.
- [ ] DB record deletion works.
- [ ] Failed uploads cleaned up.
- [ ] Malware scanning considered where necessary.

## 8. Environment Configuration — P0
- [ ] Development environment separated.
- [ ] Staging environment separated.
- [ ] Production environment separated.
- [ ] Development database separated.
- [ ] Production database separated.
- [ ] Development API credentials separated.
- [ ] Production API credentials separated.
- [ ] Development OAuth callbacks configured.
- [ ] Production OAuth callbacks configured.
- [ ] Development storage separated.
- [ ] Production storage separated.
- [ ] Search codebase for localhost.
- [ ] Search codebase for 127.0.0.1.
- [ ] Search codebase for .vercel.app.
- [ ] Search codebase for .pages.dev.
- [ ] Search codebase for .workers.dev.
- [ ] Search codebase for ngrok.
- [ ] Remove unintended development/staging URLs.

## 9. Secrets — P0
- [ ] Search repository for API_KEY.
- [ ] Search repository for SECRET.
- [ ] Search repository for TOKEN.
- [ ] Search repository for PASSWORD.
- [ ] Search repository for PRIVATE_KEY.
- [ ] Search repository for SERVICE_ROLE.
- [ ] Search repository for DATABASE_URL.
- [ ] Secrets are not committed.
- [ ] Secrets are not bundled into frontend JavaScript.
- [ ] Production secrets use environment configuration.
- [ ] Previously exposed credentials rotated.
- [ ] Database admin key stays server-side.
- [ ] OAuth secrets stay server-side.

## 10. Security — P0
- [ ] SQL injection testing.
- [ ] XSS testing.
- [ ] CSRF testing.
- [ ] IDOR testing.
- [ ] SSRF testing where URL fetching exists.
- [ ] Open redirect testing.
- [ ] Path traversal testing.
- [ ] Broken authentication testing.
- [ ] Broken authorization testing.
- [ ] File upload abuse testing.
- [ ] Brute-force protection.
- [ ] Rate-limit bypass testing.
- [ ] Sensitive data exposure review.
- [ ] CORS configuration reviewed.
- [ ] Object/record IDs cannot be changed to access unauthorized data.

## 11. Third-Party Integrations
- [ ] Valid credentials tested.
- [ ] Invalid credentials tested.
- [ ] Expired credentials tested.
- [ ] API offline behavior tested.
- [ ] Rate-limit behavior tested.
- [ ] Timeout behavior tested.
- [ ] Bad response behavior tested.
- [ ] Missing field behavior tested.
- [ ] Duplicate webhook behavior tested.
- [ ] Failed webhook behavior tested.
- [ ] Reconnect flow tested.
- [ ] One unavailable integration does not crash the entire app.

## 12. Webhooks — P0 if used
- [ ] Signature verification.
- [ ] Secret validation.
- [ ] Duplicate events handled.
- [ ] Events are idempotent.
- [ ] Failed webhook logs.
- [ ] Retry strategy.
- [ ] Production webhook URLs configured.
- [ ] Staging URLs removed.
- [ ] Webhook responses return quickly.

## 13. Email System
- [ ] Signup email.
- [ ] Email verification.
- [ ] Password reset email.
- [ ] Notification emails.
- [ ] Invitation emails.
- [ ] System alert emails.
- [ ] From address correct.
- [ ] Reply-to correct.
- [ ] Links use production domain.
- [ ] HTML renders correctly.
- [ ] Mobile email layout tested.
- [ ] SPF configured.
- [ ] DKIM configured.
- [ ] DMARC configured.
- [ ] Email failures logged.

## 14. Background Jobs / Automations
- [ ] Every workflow documented.
- [ ] Test workflows disabled.
- [ ] Production workflows enabled.
- [ ] Duplicate execution prevented.
- [ ] Retry policy configured.
- [ ] Failed-job queue/log exists.
- [ ] Long-running tasks do not block UI.
- [ ] Tasks resume safely after restart.

## 15. Performance
- [ ] Dashboard query performance tested.
- [ ] Search performance tested.
- [ ] Filtering performance tested.
- [ ] Tables tested with realistic data.
- [ ] Reports tested with realistic data.
- [ ] API response time measured.
- [ ] Database query time measured.
- [ ] Memory usage reviewed.
- [ ] CPU usage reviewed.
- [ ] Bundle size reviewed.
- [ ] Image optimization applied.
- [ ] Caching reviewed.
- [ ] Test with larger realistic datasets.

## 16. Logging — P0
- [ ] Authentication failures logged.
- [ ] API failures logged.
- [ ] Database failures logged.
- [ ] Integration failures logged.
- [ ] Webhook failures logged.
- [ ] Background-job failures logged.
- [ ] Application exceptions logged.
- [ ] Passwords are never logged.
- [ ] Access tokens are never logged.
- [ ] API secrets are never logged.
- [ ] Private keys are never logged.

## 17. Monitoring — P0
- [ ] Uptime monitoring.
- [ ] Error monitoring.
- [ ] API monitoring.
- [ ] Database monitoring.
- [ ] Resource monitoring.
- [ ] Alerts configured.
- [ ] Failed-job alerts.
- [ ] Integration failure alerts.

## 18. Backups — P0
- [ ] Automatic DB backups.
- [ ] Backup retention defined.
- [ ] File/storage backups if needed.
- [ ] Environment configuration securely backed up.
- [ ] Repository backed up remotely.
- [ ] Restore procedure documented.
- [ ] At least one backup has been restored successfully.

## 19. Error Pages
- [ ] 400 behavior.
- [ ] 401 behavior.
- [ ] 403 behavior.
- [ ] 404 behavior.
- [ ] 429 behavior.
- [ ] 500 behavior.
- [ ] 502/503 behavior.
- [ ] Technical stack traces are hidden from users.
- [ ] User-facing error messages are understandable.

## 20. Production Domain — P0
- [ ] Production deployment exists.
- [ ] DNS configured.
- [ ] SSL issued.
- [ ] HTTPS enforced.
- [ ] Cookie domain configured.
- [ ] CORS configured.
- [ ] OAuth redirects updated.
- [ ] Email URLs updated.
- [ ] Webhook URLs updated.
- [ ] API URLs updated.
- [ ] Storage URLs updated.
- [ ] Canonical URLs updated.
- [ ] Analytics updated.

## 21. Final End-to-End QA — P0
- [ ] Visit DeskDev as a new user.
- [ ] Register.
- [ ] Verify account.
- [ ] Login.
- [ ] Complete onboarding.
- [ ] Create first item/project/workspace.
- [ ] Use core DeskDev functionality.
- [ ] Edit it.
- [ ] Delete it.
- [ ] Test integrations.
- [ ] Upload files.
- [ ] Check notifications.
- [ ] Logout.
- [ ] Login again.
- [ ] Confirm everything persisted.
- [ ] Repeat as normal user.
- [ ] Repeat as admin.
- [ ] Repeat as unauthorized user.

## 22. Stress / Failure QA
- [ ] Double-click Submit.
- [ ] Refresh while saving.
- [ ] Disconnect internet while saving.
- [ ] Open same record in two tabs.
- [ ] Edit same record from two browsers.
- [ ] Delete while another session is editing.
- [ ] Expire session while working.
- [ ] Upload unsupported file.
- [ ] Simulate API outage.
- [ ] Simulate database failure.
- [ ] Simulate third-party 500 response.
- [ ] Confirm recovery is clean.

## 23. Legal
- [ ] Privacy Policy.
- [ ] Terms of Service.
- [ ] Cookie disclosure where applicable.
- [ ] Data processing information.
- [ ] Contact information.
- [ ] Account deletion process.
- [ ] Data deletion process.
- [ ] Third-party service disclosure where appropriate.

---

# Final Go / No-Go Rule

## Nixgen
Do not publish until these are green:
- [ ] Frontend
- [ ] Forms
- [ ] Email
- [ ] SEO
- [ ] Analytics
- [ ] Security
- [ ] Domain

## DeskDev
Do not publish until these are green:
- [ ] Frontend
- [ ] Authentication
- [ ] Authorization
- [ ] Database
- [ ] Backend/API
- [ ] Security
- [ ] Integrations
- [ ] Monitoring
- [ ] Backups
- [ ] Domain
