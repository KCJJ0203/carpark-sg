# Runs one carpark availability collection, then publishes it.
#
# Launched hidden by hidden-run.vbs from Task Scheduler every 30 minutes.
#
# WHY THIS PUSHES NOW: GitHub's scheduler stopped dispatching the Actions
# collector reliably. It fell to 3 snapshots a day while every run it did make
# reported success, and the once-daily publish workflow degraded the same way,
# so it is not our cron frequency and not something the repo can fix. This
# machine, plugged in with sleep disabled, measured 48 a day across all 24
# hours. So it collects AND publishes, and the Actions workflow stays on as the
# fallback for the days this laptop is off.
#
# History cannot be back-filled: a tick we miss is gone for good. So collection
# stays deliberately dumb - no retries, no cleverness - and every git failure is
# logged and swallowed, because a push problem must never cost us the next tick.
#
# Paths are ABSOLUTE and the location is set explicitly: launched via wscript
# there is no useful working directory, and "node scripts\collect.js" fails with
# a module-not-found that only shows up once it is running under the scheduler.
$ErrorActionPreference = "Stop"
$root = "D:\Projects\carpark-sg"
$log  = Join-Path $root "data\collect.log"

function Write-Log($message) {
    $stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -Path $log -Value "$stamp $message"
}

try {
    Set-Location $root
    $cp = Join-Path $root "data\carparks.json"
    $jsArgs = @((Join-Path $root "scripts\collect.js"))
    # Rebuild the static carpark list if it is more than a week old.
    if (-not (Test-Path $cp) -or (Get-Item $cp).LastWriteTime -lt (Get-Date).AddDays(-7)) {
        $jsArgs += "--carparks"
    }
    $out = & node @jsArgs 2>&1
    Write-Log $out
} catch {
    Write-Log "ERROR $($_.Exception.Message)"
    exit 1
}

# Publishing is best-effort and must never take the collector down with it.
try {
    Set-Location $root

    # Anything uncommitted outside data/ means KC is working in here right now.
    # Rebasing his tree under him is not worth a snapshot, so it waits on disk
    # instead - union merge means a later run carries it up with the rest.
    $status = & git status --porcelain
    $dirty = @($status | Where-Object { $_ -and ($_.Substring(3) -notlike "data/*") })
    if ($dirty.Count -gt 0) {
        Write-Log "SKIP push - uncommitted work in the repo, snapshot kept on disk"
        exit 0
    }

    & git add data/history | Out-Null
    & git diff --cached --quiet
    if ($LASTEXITCODE -eq 0) {
        Write-Log "nothing new to publish"
        exit 0
    }

    $stamp = Get-Date -Format "yyyy-MM-ddTHH:mmzzz"
    & git commit -q -m "data: availability snapshot $stamp (laptop)" | Out-Null

    $pull = & git pull --rebase 2>&1
    if ($LASTEXITCODE -ne 0) {
        # Never leave the repo mid-rebase: the next run would fail, and so would
        # anything KC does in here afterwards. The commit stays local and the
        # next tick tries again.
        & git rebase --abort 2>&1 | Out-Null
        throw "git pull failed, rebase aborted: $pull"
    }

    $push = & git push 2>&1
    if ($LASTEXITCODE -ne 0) { throw "git push failed: $push" }
    Write-Log "published"
} catch {
    Write-Log "PUBLISH FAILED $($_.Exception.Message)"
}
