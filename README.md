# Job Tracker - AI-Powered Application Dashboard

An automated job application tracking system that connects to your Gmail, scans for job application confirmations and recruiter replies, and organizes them in a neat dashboard using AI (OpenAI or Google Gemini).

## Features
- **Gmail Integration**: Scans your inbox for job-related emails (including LinkedIn Easy Apply confirmations).
- **Smart Filtering**: Gmail search operators pre-filter likely job emails (recruiting teams + ATS senders like Greenhouse, Lever, Workday, Ashby) and exclude known noise.
- **AI Classification**: OpenAI (`gpt-4o-mini`) or Gemini (`gemini-2.5-flash`) with strict JSON schemas categorizes emails into applications, interviews, rejections, or offers. A rule-based classifier is used when no AI key is configured.
- **Accurate Tracking**: Emails are processed oldest → newest, matched by Gmail thread and normalized company name, and saved transactionally — failed emails are retried on the next sync.
- **Fast Syncs**: Already-processed emails are skipped before any Gmail/AI calls; metadata and AI calls run in parallel; labels are applied in bulk.
- **Auto-Sync**: While the dashboard is open, it incrementally syncs every 6 hours.
- **Privacy First**: Uses a local SQLite database (`dev.db`). Your data stays on your machine.

## Prerequisites
- **Node.js**: v18 or higher
- **Google Cloud Project**: With Gmail API enabled and OAuth credentials configured.
- **AI key (optional but recommended)**: OpenAI API key or Google Gemini API key.

## Setup Instructions

### 1. Clone & Install Dependencies
```bash
npm install
```

### 2. Google Cloud Setup (OAuth & Gmail API)
1. Go to [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project or select an existing one.
3. Enable the **Gmail API** in the API Library.
4. Go to **OAuth consent screen**:
   - Set it up for **External** or **Internal** (Testing mode is fine for personal use).
   - Add the scope: `https://www.googleapis.com/auth/gmail.modify`
   - Add your email address as a **Test User**.
5. Go to **Credentials** -> Create Credentials -> **OAuth client ID** (Web application).
   - Add Authorized JavaScript origins: `http://localhost:3001`
   - Add Authorized redirect URIs: `http://localhost:3001/api/auth/callback/google`
6. Copy the **Client ID** and **Client Secret**.

### 3. Environment Variables
Create a `.env.local` file in the root directory (copy from `.env.local.example`) and fill in your details. `.env.local` is gitignored — **never put secrets in `.env`**, which is committed.

```env
AUTH_SECRET="your-random-auth-secret-here" # Generate with: openssl rand -base64 32
AUTH_URL="http://localhost:3001"

GOOGLE_CLIENT_ID="your-client-id.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="your-client-secret"

# One of these for AI classification (OpenAI is used if both are set)
OPENAI_API_KEY="your-openai-api-key"
GEMINI_API_KEY="your-gemini-api-key"
```

`.env` only holds the database URL:
```env
DATABASE_URL="file:./dev.db"
```

### 4. Database Setup
```bash
npx prisma generate
npx prisma db push
npm run db:backfill   # only needed once when upgrading an existing database
```

### 5. Run the Application
```bash
npm run dev
```
The app will run on `http://localhost:3001` (or 3000 if available).

## Usage
1. Open the app and click **Sign in with Google**.
2. Grant the required permissions (including Gmail access).
3. Pick a date range (defaults to the last 6 months) and click **Sync Inbox**. Large ranges are processed in batches of 200 automatically.
4. Leave the dashboard open and it will auto-sync new emails every 6 hours.

## Scripts
| Command | What it does |
|---|---|
| `npm run dev` | Start the dev server |
| `npm run typecheck` | Type-check the project |
| `npm run db:push` | Apply the Prisma schema to SQLite |
| `npm run db:backfill` | Fill the normalized company key on existing rows |
| `npm run db:check` | Show the stored Google token status |
| `npm run db:reset-auth` | Delete Google accounts/sessions (forces fresh consent) |
| `npm run db:reset-data` | Delete all applications and processed-email history |
| `npm run autopush:install` | Auto-commit & push to GitHub every hour (Windows Task Scheduler) |
| `npm run autopush:now` | Run the auto-push once right now |
| `npm run autopush:uninstall` | Remove the hourly auto-push task |

## GitHub Auto-Push
`scripts/auto-push.ps1` commits and pushes any changes to `origin` on a schedule (hourly by default, via the `JobTracker-AutoPush` scheduled task). It:
- skips when there's nothing to commit/push, or while a merge/rebase is in progress;
- **refuses to commit anything that looks like a secret** (API keys, OAuth secrets, `.env.local`, `*.pem`, `*.db`);
- rebases onto the remote before pushing and aborts safely on conflicts;
- logs every run to `.git/auto-push.log`.

Change the interval with `powershell -File scripts/install-auto-push.ps1 -IntervalMinutes 30`.
