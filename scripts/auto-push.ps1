<#
.SYNOPSIS
  Auto-commits and pushes any changes in this repo to GitHub.
  Run hourly by Windows Task Scheduler (see scripts/install-auto-push.ps1),
  or manually with:  npm run autopush:now

.SAFEGUARDS
  - Does nothing if there are no changes and nothing unpushed.
  - Skips while a merge / rebase / cherry-pick is in progress or on a detached HEAD.
  - Refuses to commit if staged changes look like secrets (API keys, OAuth
    secrets, .env.local, *.pem, *.db). Files are unstaged and the run is logged.
  - Pulls with --rebase before pushing; on conflict it aborts and leaves the
    commit local (retried next run).
  - Log: .git/auto-push.log (never committed).
#>
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repo
$gitDir = Join-Path $repo ".git"
$logFile = Join-Path $gitDir "auto-push.log"

function Log([string]$msg) {
  "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $msg" | Out-File -FilePath $logFile -Append -Encoding utf8
  Write-Host $msg
}

function Git {
  # Runs git, returns output lines, throws on non-zero exit
  $out = & git @args 2>&1
  if ($LASTEXITCODE -ne 0) { throw "git $($args -join ' ') failed: $($out -join ' ')" }
  return $out
}

# Keep the log small
if ((Test-Path $logFile) -and ((Get-Item $logFile).Length -gt 512KB)) {
  Get-Content $logFile -Tail 500 | Set-Content $logFile -Encoding utf8
}

try {
  foreach ($marker in "MERGE_HEAD", "rebase-merge", "rebase-apply", "CHERRY_PICK_HEAD") {
    if (Test-Path (Join-Path $gitDir $marker)) { Log "Skipped: $marker in progress"; exit 0 }
  }

  $branch = (Git rev-parse --abbrev-ref HEAD | Select-Object -First 1).ToString().Trim()
  if ($branch -eq "HEAD") { Log "Skipped: detached HEAD"; exit 0 }

  # ── Stage & secret-scan ─────────────────────────
  Git add -A | Out-Null
  $staged = @(Git diff --cached --name-only)

  if ($staged.Count -gt 0) {
    $blockedFiles = $staged | Where-Object {
      $_ -match '(^|/)\.env\.(local|development|production)(\.|$)' -or
      $_ -match '\.(pem|key|p12|db|db-journal|sqlite)$' -or
      $_ -match '(^|/)(credentials|client_secret)[^/]*\.json$'
    } | Where-Object { $_ -notmatch '\.example$' }

    $scanFiles = $staged | Where-Object { $_ -notmatch '\.example$' -and $_ -notmatch 'package-lock\.json$' }
    $secretPattern = '^\+.*(' +
      '(GOOGLE_CLIENT_SECRET|OPENAI_API_KEY|GEMINI_API_KEY|AUTH_SECRET|NEXTAUTH_SECRET|AUTH_GOOGLE_SECRET)\s*=\s*["'']?[^"''\s#]{8,}' +
      '|sk-(proj-)?[A-Za-z0-9_-]{20,}' +
      '|GOCSPX-[A-Za-z0-9_-]{10,}' +
      '|AIza[0-9A-Za-z_-]{30,}' +
      '|-----BEGIN [A-Z ]*PRIVATE KEY-----)'
    $secretHits = @()
    if ($scanFiles) {
      $diff = & git diff --cached -U0 -- $scanFiles 2>$null
      $secretHits = @($diff | Select-String -Pattern $secretPattern)
    }

    if ($blockedFiles -or $secretHits.Count -gt 0) {
      Git reset -q | Out-Null
      $why = @()
      if ($blockedFiles) { $why += "blocked files: $($blockedFiles -join ', ')" }
      if ($secretHits.Count -gt 0) { $why += "$($secretHits.Count) line(s) that look like secrets" }
      Log "ABORTED: refusing to commit ($($why -join '; ')). Move secrets to .env.local (gitignored)."
      exit 1
    }

    $stamp = Get-Date -Format "yyyy-MM-dd HH:mm"
    $summary = if ($staged.Count -le 3) { $staged -join ", " } else { "$($staged.Count) files" }
    Git commit -q -m "chore(auto): sync $stamp - $summary" | Out-Null
    Log "Committed: $summary"
  }

  # ── Sync with remote ────────────────────────────
  Git fetch -q origin | Out-Null
  $hasUpstream = $true
  & git rev-parse --verify -q "origin/$branch" *> $null
  if ($LASTEXITCODE -ne 0) { $hasUpstream = $false }

  if ($hasUpstream) {
    $behind = [int]((Git rev-list --count "HEAD..origin/$branch") | Select-Object -First 1).ToString().Trim()
    if ($behind -gt 0) {
      & git pull -q --rebase origin $branch 2>&1 | Out-Null
      if ($LASTEXITCODE -ne 0) {
        & git rebase --abort 2>&1 | Out-Null
        Log "ABORTED: rebase onto origin/$branch had conflicts. Resolve manually; local commits kept."
        exit 1
      }
    }
    $ahead = [int]((Git rev-list --count "origin/$branch..HEAD") | Select-Object -First 1).ToString().Trim()
    if ($ahead -eq 0) { if ($staged.Count -eq 0) { Log "Up to date" }; exit 0 }
  }

  Git push -q -u origin $branch | Out-Null
  Log "Pushed $branch to origin"
  exit 0
}
catch {
  Log "ERROR: $($_.Exception.Message)"
  exit 1
}
