# Nightowl Woodworks Ltd — Website & Admin

Premium marketing site + admin dashboard for [Nightowl Woodworks Ltd](https://nightowl.com.ng) — precision wood processing in Nigeria.

**Stack:** Next.js 15 (App Router, static export) · TypeScript · Tailwind CSS v4 · Framer Motion · Firebase (Hosting, Firestore, Auth, Storage, Analytics) · Recharts

## Structure

| Route | Purpose |
|---|---|
| `/` | Home — hero, stats, services, work, process, machines, testimonials, award |
| `/services/` | Service details, machines, process assurance |
| `/work/` | Filterable gallery with lightbox + social showcase |
| `/about/` | Story, vision/mission, team, award, compliance |
| `/contact/` | Quote form (→ Firestore `inquiries`) + WhatsApp |
| `/admin/` | Staff dashboard — overview KPIs & chart, inquiries inbox with status workflow, work-item manager (Storage uploads), settings |

## Local development

```bash
pnpm install
pnpm dev
```

## Deployment

Every push to `main` builds and deploys to Firebase Hosting (`nightowl-woodworks`) via GitHub Actions. Pull requests get preview channel URLs.

**One-time setup:**

1. Create the repo secret `FIREBASE_SERVICE_ACCOUNT` — a service-account JSON with the *Firebase Hosting Admin* role (Firebase console → Project settings → Service accounts, or `firebase init hosting:github`).
2. Deploy security rules once: `firebase deploy --only firestore:rules,storage` (rules files live in this repo).
3. Create the first staff account: Firebase console → Authentication → enable **Email/Password**, then add the user. Anyone who can sign in is treated as staff by the security rules — create accounts for staff only.

## Firestore collections

- `inquiries` — quote-form submissions (`name, email, phone, projectType, budget, message, status, createdAt`)
- `workItems` — extra gallery items managed from the dashboard
- `settings/site` — contact details & announcement banner
