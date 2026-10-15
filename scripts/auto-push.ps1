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

# NOTE: PowerShell command names are case-insensitive, so the helper must NOT be
# named "Git" (it would shadow git.exe and recurse). Always call git.exe explicitly.

# Runs git, returns output lines (stderr included as text). Never throws; exit code in $script:GitExit.
function Invoke-Git {
  $ErrorActionPreference = "Continue" # git writes progress to stderr; don't treat it as fatal
  $out = & git.exe @args 2>&1 | ForEach-Object { "$_" }
  $script:GitExit = $LASTEXITCODE
  return $out
}

# Same as Invoke-Git but throws on a non-zero exit code.
function Invoke-GitChecked {
  $out = Invoke-Git @args
  if ($script:GitExit -ne 0) { throw "git $($args -join ' ') failed: $($out -join ' ')" }
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

  $branch = (Invoke-GitChecked rev-parse --abbrev-ref HEAD | Select-Object -First 1).ToString().Trim()
  if ($branch -eq "HEAD") { Log "Skipped: detached HEAD"; exit 0 }

  # ── Stage & secret-scan ─────────────────────────
  Invoke-GitChecked add -A | Out-Null
  $staged = @(Invoke-GitChecked diff --cached --name-only | Where-Object { $_ -and $_ -notmatch '^warning:' })

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
      $diff = Invoke-Git diff --cached -U0 -- $scanFiles
      $secretHits = @($diff | Select-String -Pattern $secretPattern)
    }

    if ($blockedFiles -or $secretHits.Count -gt 0) {
      Invoke-GitChecked reset -q | Out-Null
      $why = @()
      if ($blockedFiles) { $why += "blocked files: $($blockedFiles -join ', ')" }
      if ($secretHits.Count -gt 0) { $why += "$($secretHits.Count) line(s) that look like secrets" }
      Log "ABORTED: refusing to commit ($($why -join '; ')). Move secrets to .env.local (gitignored)."
      exit 1
    }

    $stamp = Get-Date -Format "yyyy-MM-dd HH:mm"
    $summary = if ($staged.Count -le 3) { $staged -join ", " } else { "$($staged.Count) files" }
    Invoke-GitChecked commit -q -m "chore(auto): sync $stamp - $summary" | Out-Null
    Log "Committed: $summary"
  }

  # ── Sync with remote ────────────────────────────
  Invoke-GitChecked fetch -q origin | Out-Null
  Invoke-Git rev-parse --verify -q "origin/$branch" | Out-Null
  $hasUpstream = ($script:GitExit -eq 0)

  if ($hasUpstream) {
    $behind = [int]((Invoke-GitChecked rev-list --count "HEAD..origin/$branch") | Select-Object -First 1).ToString().Trim()
    if ($behind -gt 0) {
      Invoke-Git pull -q --rebase origin $branch | Out-Null
      if ($script:GitExit -ne 0) {
        Invoke-Git rebase --abort | Out-Null
        Log "ABORTED: rebase onto origin/$branch had conflicts. Resolve manually; local commits kept."
        exit 1
      }
    }
    $ahead = [int]((Invoke-GitChecked rev-list --count "origin/$branch..HEAD") | Select-Object -First 1).ToString().Trim()
    if ($ahead -eq 0) { if ($staged.Count -eq 0) { Log "Up to date" }; exit 0 }
  }

  Invoke-GitChecked push -q -u origin $branch | Out-Null
  Log "Pushed $branch to origin"
  exit 0
}
catch {
  Log "ERROR: $($_.Exception.Message)"
  exit 1
}
