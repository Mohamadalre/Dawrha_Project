<#
  backup-dawrha.ps1 — professional backup for the Dawrha platform.

  Backs up, in ONE timestamped folder:
    1. The BACKEND database   (dawrha_db  — local PostgreSQL 18)
    2. The ODOO database      (odoo19     — in the odoo19-db container, PG16)
    3. The ODOO filestore     (attachments/images — NOT stored in the DB)

  Then rotates: folders older than -RetentionDays are deleted.

  WHY three things: the two DBs hold the records; the Odoo filestore holds the
  binary attachments (invoices, images) that live on disk, not in Postgres — a
  DB-only backup would restore rows that point at missing files.

  Binary-safe: every dump is written to a FILE (pg_dump -f / docker cp), never
  piped through PowerShell '>' which corrupts binary output.

  Schedule it hourly/daily with Windows Task Scheduler (see run instructions at
  the bottom). Run manually to test:
      powershell -ExecutionPolicy Bypass -File .\scripts\backup-dawrha.ps1
#>

param(
    # Put backups on a DIFFERENT drive than the databases (3-2-1 rule). Change
    # to a mapped cloud/network drive for off-site copies.
    [string]$BackupRoot = "D:\dawrha_backups",
    [int]$RetentionDays = 14,
    # Read automatically from the backend .env; override only if needed.
    [string]$EnvFile = "$PSScriptRoot\..\.env"
)

$ErrorActionPreference = "Stop"
$PgBin = "C:\Program Files\PostgreSQL\18\bin\pg_dump.exe"

function Log($m) { Write-Host ("[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $m) }

# --- Read the backend DB password from .env (never hard-code secrets) ---------
$DbPassword = $null
if (Test-Path $EnvFile) {
    foreach ($line in Get-Content $EnvFile) {
        if ($line -match '^\s*DB_PASSWORD\s*=\s*(.+?)\s*$') {
            $DbPassword = $Matches[1].Trim('"').Trim("'")
            break
        }
    }
}
if (-not $DbPassword) { throw "DB_PASSWORD not found in $EnvFile" }

# --- Create this run's timestamped folder ------------------------------------
$stamp = Get-Date -Format "yyyy-MM-dd_HHmm"
$dir = Join-Path $BackupRoot $stamp
New-Item -ItemType Directory -Force -Path $dir | Out-Null
Log "Backup folder: $dir"

# --- 1) BACKEND database (local PostgreSQL 18) -------------------------------
# -Fc = custom compressed format (restored selectively with pg_restore).
Log "Dumping backend dawrha_db ..."
$env:PGPASSWORD = $DbPassword
& $PgBin -h localhost -U postgres -Fc -f (Join-Path $dir "dawrha_db.dump") dawrha_db
Log "  -> dawrha_db.dump  ({0:N1} MB)" -f ((Get-Item (Join-Path $dir 'dawrha_db.dump')).Length / 1MB)

# --- 2) ODOO database (container, PostgreSQL 16) -----------------------------
# Dump INSIDE the container to a file, then copy it out — binary-safe.
Log "Dumping Odoo odoo19 ..."
docker exec -e PGPASSWORD=odoo odoo19-db pg_dump -U odoo -Fc -f /tmp/odoo19.dump odoo19
docker cp odoo19-db:/tmp/odoo19.dump (Join-Path $dir "odoo19.dump")
docker exec odoo19-db rm -f /tmp/odoo19.dump
Log "  -> odoo19.dump  ({0:N1} MB)" -f ((Get-Item (Join-Path $dir 'odoo19.dump')).Length / 1MB)

# --- 3) ODOO filestore (attachments on disk) ---------------------------------
Log "Archiving Odoo filestore ..."
docker exec odoo19 tar czf /tmp/filestore.tgz -C /var/lib/odoo filestore
docker cp odoo19:/tmp/filestore.tgz (Join-Path $dir "odoo_filestore.tgz")
docker exec odoo19 rm -f /tmp/filestore.tgz
Log "  -> odoo_filestore.tgz"

# --- Rotation: drop folders older than the retention window ------------------
$cutoff = (Get-Date).AddDays(-$RetentionDays)
Get-ChildItem $BackupRoot -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.CreationTime -lt $cutoff } |
    ForEach-Object { Log "Rotating out old backup: $($_.Name)"; Remove-Item $_.FullName -Recurse -Force }

Log "Backup complete."

<#
============================  HOW TO SCHEDULE  ================================
Run every hour via Task Scheduler (one line in an elevated PowerShell):

  $act = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"D:\project_ite5\backend-5\Dawrha_Project\scripts\backup-dawrha.ps1`""
  $trg = New-ScheduledTaskTrigger -Once -At (Get-Date).Date -RepetitionInterval (New-TimeSpan -Hours 1)
  Register-ScheduledTask -TaskName "Dawrha DB Backup" -Action $act -Trigger $trg -RunLevel Highest -Description "Hourly backend+Odoo backup"

============================  HOW TO RESTORE  ================================
Backend (into an empty dawrha_db):
  set PGPASSWORD=<your DB_PASSWORD>
  "C:\Program Files\PostgreSQL\18\bin\pg_restore.exe" -h localhost -U postgres -d dawrha_db --clean --if-exists "D:\dawrha_backups\<stamp>\dawrha_db.dump"
  Then restart the backend — the reconcile services re-pull Odoo-mastered reference data.

Odoo DB:
  docker cp "D:\dawrha_backups\<stamp>\odoo19.dump" odoo19-db:/tmp/odoo19.dump
  docker exec -e PGPASSWORD=odoo odoo19-db pg_restore -U odoo -d odoo19 --clean --if-exists /tmp/odoo19.dump

Odoo filestore:
  docker cp "D:\dawrha_backups\<stamp>\odoo_filestore.tgz" odoo19:/tmp/filestore.tgz
  docker exec odoo19 sh -c "cd /var/lib/odoo && rm -rf filestore && tar xzf /tmp/filestore.tgz"
=============================================================================
#>
