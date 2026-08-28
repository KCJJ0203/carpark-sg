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

# Runs an external program and reports its exit code and combined output.
#
# The 2>&1 matters and so does the ErrorActionPreference around it. git writes
# ordinary progress to stderr - "To https://github.com/..." on a SUCCESSFUL
# push - and with 2>&1 under ErrorActionPreference Stop, PowerShell turns those
# lines into terminating errors. A clean push then reports itself as a failure.
# For a native command the exit code is the truth and stderr is just chatter.
function Invoke-Native {
    param([string]$Exe, [string[]]$Arguments)
    $previous = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $lines = & $Exe @Arguments 2>&1 | ForEach-Object { $_.ToString() }
        return [pscustomobject]@{ Code = $LASTEXITCODE; Output = ($lines -join " | ") }
    } finally {
        $ErrorActionPreference = $previous
    }
}

function Invoke-Git {
    param([string[]]$Arguments)
    return Invoke-Native -Exe "git" -Arguments $Arguments
}

try {
    Set-Location $root
    $cp = Join-Path $root "data\carparks.json"
    $jsArgs = @((Join-Path $root "scripts\collect.js"))
    # Rebuild the static carpark list if it is more than a week old.
    if (-not (Test-Path $cp) -or (Get-Item $cp).LastWriteTime -lt (Get-Date).AddDays(-7)) {
        $jsArgs += "--carparks"
    }
    $run = Invoke-Native -Exe "node" -Arguments $jsArgs
    Write-Log $run.Output
    if ($run.Code -ne 0) { throw "collect.js exited $($run.Code)" }
} catch {
    Write-Log "ERROR $($_.Exception.Message)"
    exit 1
}

# Publishing is best-effort and must never take the collector down with it.
try {
    Set-Location $root

    # Anything uncommitted outside data/ means KC is working in here right now.
    # Rebasing his tree under him is not worth a snapshot, so the reading waits
    # on disk instead - union merge means a later run carries it up with the
    # rest of them.
    $status = Invoke-Git @("status", "--porcelain")
    if ($status.Code -ne 0) { throw "git status failed: $($status.Output)" }
    $dirty = @($status.Output -split " \| " | Where-Object { $_ -and ($_.Substring(3) -notlike "data/*") })
    if ($dirty.Count -gt 0) {
        Write-Log "SKIP push - uncommitted work in the repo, snapshot kept on disk"
        exit 0
    }

    $add = Invoke-Git @("add", "data/history")
    if ($add.Code -ne 0) { throw "git add failed: $($add.Output)" }

    $staged = Invoke-Git @("diff", "--cached", "--quiet")
    if ($staged.Code -eq 0) {
        Write-Log "nothing new to publish"
        exit 0
    }

    $stamp = Get-Date -Format "yyyy-MM-ddTHH:mmzzz"
    $commit = Invoke-Git @("commit", "-q", "-m", "data: availability snapshot $stamp (laptop)")
    if ($commit.Code -ne 0) { throw "git commit failed: $($commit.Output)" }

    $pull = Invoke-Git @("pull", "--rebase")
    if ($pull.Code -ne 0) {
        # Never leave the repo mid-rebase: the next run would fail, and so would
        # anything KC does in here afterwards. The commit stays local and the
        # next tick tries again.
        Invoke-Git @("rebase", "--abort") | Out-Null
        throw "git pull failed, rebase aborted: $($pull.Output)"
    }

    $push = Invoke-Git @("push")
    if ($push.Code -ne 0) { throw "git push failed: $($push.Output)" }
    Write-Log "published"
} catch {
    Write-Log "PUBLISH FAILED $($_.Exception.Message)"
}
