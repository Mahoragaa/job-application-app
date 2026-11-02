# Job Application App — Status & Action Plan

## 1. What's Done — Core Infrastructure & Gmail Sync

### Authentication & Database (`Prisma` + `NextAuth v5`)
- [x] Google OAuth sign-in with Gmail `gmail.modify` scope (`src/lib/auth.ts`)
- [x] Automatic OAuth access token refresh when expired (`src/lib/gmail.ts`)
- [x] Local SQLite schema for `User`, `Account`, `Application`, `ProcessedEmail`, `Resume`, and `TailoredResume` (`prisma/schema.prisma`)
- [x] Database utility scripts (`db:check`, `db:reset-auth`, `db:reset-data`, `db:backfill`) and hourly GitHub auto-push (`scripts/auto-push.ps1`)

### Gmail Sync & Dynamic Zero-Credit Classification Engine
- [x] Targeted Gmail query builder filtering ATS senders (Greenhouse, Lever, Workday, Ashby, Wellfound, LinkedIn Easy Apply) and excluding noise (`src/lib/senders.ts`)
- [x] Dynamic local algorithmic email classifier (`src/lib/ai-classifier.ts`) that classifies applications, replies, interviews, offers, and rejections with **0 AI credits** by default (with optional `USE_PAID_AI="true"` support)
- [x] Chronological (oldest → newest) batched sync (200 emails/round), parallel metadata calls, per-user sync lock, and transactional writes (`src/app/api/sync/route.ts`)
- [x] Thread & normalized company key matching (`src/lib/company.ts`) + automatic Gmail label creation/application (`Job Tracker/Applied`, `Job Tracker/Replies`)

---

## 2. What's Done — Application Tracker Enhancements

### Search, Filtering, Sorting, Pagination & Manual Management (`src/components/dashboard/application-table.tsx`)
- [x] **Search bar**: Filter applications by company name, role, email snippet, or personal notes
- [x] **Status filter pills**: Filter by `All`, `Applied`, `Reply Received`, `Interview`, `Offer`, `Rejected` with live counts
- [x] **Column sorting**: Sort by Newest First, Oldest First, or Company (A–Z)
- [x] **Table pagination**: Page size selector (`10 / 25 / 50 / 100 per page`) and Previous/Next navigation
- [x] **Manual "Add Application" modal**: Log jobs manually with Company, Role, Status, Date, Notes, and optional Job Description (`POST /api/applications`)
- [x] **Edit & single-row delete**: Fix company names, role titles, or status (`applied` → `interview` → `offer` / `rejected`), add personal notes, or delete individual rows (`PATCH/DELETE /api/applications/[id]`)
- [x] **CSV export**: Download filtered applications as a `.csv` file

---

## 3. What's Done — Dynamic Resume Tailor & Interactive Preview Studio (Zero AI Credits)

### Resume Upload, Parsing & Tailoring Engine (`src/lib/ai-resume.ts`)
- [x] **Header Navigation**: Quick switcher between `Applications` (`/dashboard`) and `AI Resume Tailor` (`/resume`) in `src/components/dashboard/header.tsx` + per-row **Tailor Resume / Fit %** button in `src/components/dashboard/application-table.tsx`
- [x] **Base Resume Uploader & Dynamic Section Parser** (`src/lib/ai-resume.ts`, `src/app/api/resume/route.ts`, `src/app/resume/page.tsx`):
  - Upload `.pdf`, `.docx`, `.txt`, `.md`, or paste resume text directly
  - Dynamically parses into structured sections (`Summary`, `Skills`, `Experience`, `Projects`, `Education`) through code without consuming AI credits
- [x] **Dynamic Tailoring Engine** (`POST /api/resume/tailor`):
  - Uses a 150+ technical/domain keyword taxonomy + phrase extractor to match your resume against any Job Description
  - Supports **Conservative**, **Balanced**, and **Aggressive** tailoring strategies
  - Computes **ATS Fit Score (Before vs. After)**, matched JD keywords, and missing JD keywords
  - Records every modification with `before`, `after`, `section`, `targetLabel`, and `reason`
- [x] **Preview, Diff & Decision Studio** (`src/app/resume/preview/[id]/page.tsx`, `src/app/api/resume/tailor/[id]/route.ts`):
  - **Changes & Diff Tab**: Word-level red/green diff cards with explanations and individual **Keep Edit / Revert to Old** toggles per change
  - **Side-by-Side Comparison Tab**: Full Original vs. Tailored resume comparison
  - **Full Resume Preview Tab**: Clean, print-ready single-page layout with toggle between `Tailored Resume` and `Old (Original) Resume` + **Download `.DOCX`**, **Print / Save PDF**, **Download `.MD`**, and **Copy Text**
  - **Three Core Decisions**:
    1. **Go With This Tailored Resume** (`accepted_new`)
    2. **Stick to Old Resume** (`kept_original`)
    3. **Make Specific Changes** (dynamic intent parser supporting `add/include`, `replace X with Y`, `shorter/concise`, `metric/impact`, `tone down`, `keep original summary`, + full **Revision History** with 1-click version restore)

---

## 4. What's Done — Phase 4 Advanced Enhancements
- [x] **Job Posting URL Auto-Scraper** (`src/app/api/resume/scrape-jd/route.ts`): Paste a Greenhouse, Lever, Ashby, or career page URL in `/resume` to automatically extract Company, Role, and Job Description through code
- [x] **Dynamic Cover Letter Generator** (`src/lib/ai-resume.ts` + Cover Letter tab in `/resume/preview/[id]`): Synthesizes a tailored cover letter in *Professional*, *Enthusiastic*, or *Technical* tone with live editing, Copy, and `.TXT` download
- [x] **Direct `.DOCX` Word Export** (`src/lib/docx-export.ts`): Pure-TypeScript OpenXML `.docx` generator for one-click Microsoft Word downloads
- [x] **Dashboard Analytics & Funnel Charts** (`src/components/dashboard/analytics-charts.tsx`): Stage-by-stage Conversion Funnel (`Applied → Reply → Interview → Offer → Rejected`) and 8-Week Application Velocity bar chart
- [x] **Table Pagination** (`src/components/dashboard/application-table.tsx`): Configurable page sizes and page navigation
