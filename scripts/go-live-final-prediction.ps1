# Puts the 13 Nov 2026 improvements of The Final Prediction live (crown.grandslamgm.com):
# database fixes + Italian, the improved results reader, Italian reminder emails, the Italian switch,
# and the new site. Windows PowerShell 5.1. Each step stops the script if it fails. Safe to run twice.
# Run:   powershell -ExecutionPolicy Bypass -File C:\Users\marti\skg-integration\scripts\go-live-final-prediction.ps1
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

Step "1/6 Database: 0054 reserved name, 0055 round-robin fixes, 0060 Italian" { bunx supabase db push --linked --yes }
Step "2/6 Results feed: the improved Wikipedia reader" { bunx supabase functions deploy poll-results --project-ref $ref }
Step "3/6 Reminder emails: Italian" { bunx supabase functions deploy send-reminders --project-ref $ref }
Step "4/6 Switch Italian on and set the final privacy wording" { bunx supabase db query --linked -f supabase/events/atp_finals_2026_italian.sql }
Step "5/6 Build the site" {
  bunx vite build --mode staging
  if ($LASTEXITCODE -ne 0) { return }
  if (Select-String -Path "dist\assets\*.js" -Pattern "127.0.0.1:55321" -Quiet) { Write-Host "the build points at a local database: stopping" -ForegroundColor Red; $global:LASTEXITCODE = 1; return }
}

# 6/6 Publish. Cloudflare can refuse or falsely report success, so this retries for up to 30 minutes
# and only stops when crown.grandslamgm.com really serves this build.
Write-Host ""
Write-Host "== 6/6 Publish the site (retries until the live address serves it)" -ForegroundColor Yellow
$re = 'assets/index-[A-Za-z0-9_-]+\.js'
$want = [regex]::Match((Get-Content dist\index.html -Raw), $re).Value
function LiveHash { try { [regex]::Match((Invoke-WebRequest "https://crown.grandslamgm.com/?nc=$(Get-Random)" -UseBasicParsing -Headers @{ 'Cache-Control'='no-cache' }).Content, $re).Value } catch { "" } }
$deadline = (Get-Date).AddMinutes(30)
while ((Get-Date) -lt $deadline) {
  if ((LiveHash) -eq $want) { Write-Host ""; Write-Host "Live. Check https://crown.grandslamgm.com" -ForegroundColor Green; exit 0 }
  $ErrorActionPreference = "Continue"
  bunx wrangler@4.158.0 pages deploy dist --project-name six-kings-game --branch main *>&1 | Out-Null
  $ErrorActionPreference = "Stop"
  for ($k = 0; $k -lt 6; $k++) { Start-Sleep -Seconds 10; if ((LiveHash) -eq $want) { Write-Host ""; Write-Host "Live. Check https://crown.grandslamgm.com" -ForegroundColor Green; exit 0 } }
  Write-Host "  not live yet, retrying..."
}
Write-Host "Cloudflare did not take the site within 30 minutes: run this script again later (steps 1-5 are safe to repeat)." -ForegroundColor Red
exit 1
