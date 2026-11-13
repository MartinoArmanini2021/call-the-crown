# Puts Call the Crown live for the ATP Finals 2026 (crown.grandslamgm.com). Windows PowerShell 5.1.
# Run from anywhere:   powershell -ExecutionPolicy Bypass -File C:\Users\marti\skg-integration\scripts\go-live-atp-finals.ps1
# Each step stops the script if it fails, so nothing half-happens silently. Safe to run twice.
$ErrorActionPreference = "Stop"
Set-Location "C:\Users\marti\skg-integration"
$ref = "rmjlqqzytahmdlmnwxfc"

function Step($title, [scriptblock]$cmd) {
  Write-Host ""
  Write-Host "== $title" -ForegroundColor Yellow
  & $cmd
  if ($LASTEXITCODE -ne 0) { Write-Host "FAILED: $title (exit $LASTEXITCODE). Nothing after this step ran." -ForegroundColor Red; exit 1 }
  Write-Host "ok" -ForegroundColor Green
}

Step "1/6 Database: the round-robin migration (0053, additive)" { bunx supabase db push --linked --yes }
# the hyphen title redirects to "2026 ATP Finals – Singles" (en dash), which PowerShell 5.1 can mangle
Step "2/6 Results feed: the Finals Wikipedia page" { bunx supabase secrets set "WIKIPEDIA_PAGE=2026 ATP Finals - Singles" --project-ref $ref }
Step "3/6 Results feed: deploy the reader with group tables" { bunx supabase functions deploy poll-results --project-ref $ref }
Step "4/6 Reminder emails: the event's city" { bunx supabase functions deploy send-reminders --project-ref $ref }
Step "5/6 Load the ATP Finals event and draw" { bunx supabase db query --linked -f supabase/events/atp_finals_2026_load.sql }
Step "6/6 Build and publish the site" {
  bunx vite build --mode staging
  if ($LASTEXITCODE -ne 0) { return }
  if (Select-String -Path "dist\assets\*.js" -Pattern "127.0.0.1:55321" -Quiet) { Write-Host "the build points at a local database: stopping" -ForegroundColor Red; $global:LASTEXITCODE = 1; return }
  bunx wrangler pages deploy dist --project-name six-kings-game --branch main
}

Write-Host ""
Write-Host "Live. Check: https://crown.grandslamgm.com (eight players), /results (McEnroe, Lendl, Semis, Final), /vote." -ForegroundColor Green
