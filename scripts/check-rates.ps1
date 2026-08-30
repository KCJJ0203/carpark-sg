# Weekly watchdog on HDB's published parking rates.
#
# Launched by Task Scheduler via hidden-run.vbs. Runs check-rates.js, which
# opens a real browser window - HDB answers a headless one with 403 - and
# compares every figure the rate engine depends on against what src/rates.js
# has pinned.
#
# WHY IT TELEGRAMS: the whole point of this check is that transcribed rates rot
# silently. A result that only reaches a log file is a result nobody reads, and
# this project has now had two failures stay invisible for days for exactly that
# reason. A rate change is rare and worth interrupting for; anything else is not.
#
# Exit codes from check-rates.js:
#   0 - everything still matches, say nothing
#   1 - a figure moved, tell KC now
#   2 - could not read the page, log it and stay quiet (HDB being unreachable
#       is not a rate change, and crying wolf is how a watchdog gets ignored)
$ErrorActionPreference = "Stop"
$root = "D:\Projects\carpark-sg"
$log  = Join-Path $root "data\check-rates.log"

function Write-Log($message) {
    $stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -Path $log -Value "$stamp $message"
}

try {
    Set-Location $root
    $previous = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $output = & node (Join-Path $root "scripts\check-rates.js") 2>&1 | ForEach-Object { $_.ToString() }
    $code = $LASTEXITCODE
    $ErrorActionPreference = $previous

    $text = ($output -join "`n")
    Write-Log "exit=$code`n$text"

    if ($code -eq 1) {
        $token = (Get-Content "$env:USERPROFILE\.claude\.secrets\telegram-bot-token.txt" -Raw).Trim()
        $chat  = (Get-Content "$env:USERPROFILE\.claude\.secrets\telegram-chat-id.txt" -Raw).Trim()
        $msg = "HDB PARKING RATES CHANGED" + "`n`n" + $text + "`n`n" +
               "Carpark SG is still quoting the old numbers. Update src/rates.js."
        # Telegram caps a message at 4096 characters.
        if ($msg.Length -gt 3900) { $msg = $msg.Substring(0, 3900) + "`n... (truncated, see the log)" }
        $body = @{ chat_id = $chat; text = $msg } | ConvertTo-Json -Compress
        Invoke-RestMethod -Method Post -Uri "https://api.telegram.org/bot$token/sendMessage" `
            -ContentType "application/json; charset=utf-8" `
            -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) | Out-Null
        Write-Log "alerted KC on Telegram"
    }
} catch {
    Write-Log "ERROR $($_.Exception.Message)"
}
