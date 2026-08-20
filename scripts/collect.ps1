# Runs one carpark availability collection. Launched hidden by hidden-run.vbs
# from Task Scheduler every 30 minutes.
#
# History cannot be back-filled: a tick we miss is gone for good. So this stays
# deliberately dumb - no retries, no cleverness, just run and log.
#
# Paths are ABSOLUTE and the location is set explicitly: launched via wscript
# there is no useful working directory, and "node scripts\collect.js" fails with
# a module-not-found that only shows up once it is running under the scheduler.
$ErrorActionPreference = "Stop"
$root = "D:\Projects\carpark-sg"
$log  = Join-Path $root "data\collect.log"

try {
    Set-Location $root
    $cp = Join-Path $root "data\carparks.json"
    $jsArgs = @((Join-Path $root "scripts\collect.js"))
    # Rebuild the static carpark list if it is more than a week old.
    if (-not (Test-Path $cp) -or (Get-Item $cp).LastWriteTime -lt (Get-Date).AddDays(-7)) {
        $jsArgs += "--carparks"
    }
    $out = & node @jsArgs 2>&1
    $stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -Path $log -Value "$stamp $out"
} catch {
    $stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -Path $log -Value "$stamp ERROR $($_.Exception.Message)"
}