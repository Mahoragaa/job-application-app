# Job Tracker - AI-Powered Application Dashboard

An automated job application tracking system that connects to your Gmail, scans for job application confirmations and recruiter replies, and organizes them in a neat dashboard using AI (Google Gemini).

## Features
- **Gmail Integration**: Automatically scans your inbox for job-related emails.
- **Smart Filtering**: Uses Gmail search operators to pre-filter likely job emails and exclude known noise (e.g., ride receipts, newsletters).
- **AI Classification**: Uses Google Gemini (gemini-2.5-flash) to accurately categorize emails into new applications, interview invites, rejections, or offers.
- **Dashboard**: A sleek UI to view your applications, track statuses, and monitor interview rates.
- **Privacy First**: Uses a local SQLite database (`dev.db`). Your data stays on your machine.

## Prerequisites
- **Node.js**: v18 or higher
- **Google Cloud Project**: With Gmail API enabled and OAuth credentials configured.
- **Google Gemini API Key**: From Google AI Studio.

## Setup Instructions

### 1. Clone & Install Dependencies
\`\`\`bash
npm install
\`\`\`

### 2. Google Cloud Setup (OAuth & Gmail API)
1. Go to [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project or select an existing one.
3. Enable the **Gmail API** in the API Library.
4. Go to **OAuth consent screen**:
   - Set it up for **External** or **Internal** (Testing mode is fine for personal use).
   - Add the scope: \`https://www.googleapis.com/auth/gmail.modify\`
   - Add your email address as a **Test User**.
5. Go to **Credentials** -> Create Credentials -> **OAuth client ID** (Web application).
   - Add Authorized JavaScript origins: \`http://localhost:3001\`
   - Add Authorized redirect URIs: \`http://localhost:3001/api/auth/callback/google\`
6. Copy the **Client ID** and **Client Secret**.

### 3. Environment Variables
Create a \`.env.local\` file in the root directory (copy from \`.env.local.example\`) and fill in your details:

\`\`\`env
AUTH_SECRET="your-random-auth-secret-here" # Generate with: openssl rand -base64 32
AUTH_URL="http://localhost:3001"

GOOGLE_CLIENT_ID="your-client-id.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="your-client-secret"

# Gemini API Key for Classification
GEMINI_API_KEY="your-gemini-api-key"
\`\`\`

Make sure \`.env\` has your database URL:
\`\`\`env
DATABASE_URL="file:./dev.db"
\`\`\`

### 4. Database Setup
Initialize the SQLite database and generate the Prisma client:
\`\`\`bash
npx prisma generate
npx prisma db push
\`\`\`

### 5. Run the Application
\`\`\`bash
npm run dev
\`\`\`
The app will run on \`http://localhost:3001\` (or 3000 if available). 

## Usage
1. Open the app and click **Sign in with Google**.
2. Grant the required permissions (including Gmail access).
3. On the dashboard, click **Sync Inbox** to scan the last 6 months of your emails. The AI will classify them and populate your dashboard.

## Automated Syncing (Cron Job)
To automatically sync your inbox every 6 hours without clicking the button manually, you can set up a local cron job or use a tool like Windows Task Scheduler.

**Create a sync script (`sync.mjs`):**
\`\`\`javascript
// A simple Node script to hit the sync endpoint
fetch("http://localhost:3001/api/sync", { method: "POST" })
  .then(res => res.json())
  .then(console.log)
  .catch(console.error);
\`\`\`

**Run it via Windows Task Scheduler or cron:**
Set it to run \`node path/to/sync.mjs\` every 6 hours.

Alternatively, if deployed to Vercel, you can use **Vercel Cron Jobs** by adding a \`vercel.json\` configuration to ping the \`/api/sync\` endpoint.
