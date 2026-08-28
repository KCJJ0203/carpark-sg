# Why collection moved off the PC

## The problem, measured

The collector was scheduled on KC's desktop every 30 minutes, which should give 48 samples a day.
After four days it had produced **6-7 a day**, and 22 August had none at all. The task itself was
healthy — correct interval, exit code 0, next run scheduled. The machine was simply asleep.

The volume was not the real damage. This was:

| hours of day | samples |
|---|---|
| 00:00-02:00 | some |
| 10:00-15:00 | some |
| 21:00-23:00 | some |
| **03:00-09:00** | **none** |
| **16:00-20:00** | **none** |

**Twelve of twenty-four hours had no samples whatsoever**, including 17:00-20:00 — the evening peak
that "is this carpark usually full at 7pm?" is entirely about.

A pattern built on that data would not describe when carparks fill up. It would describe when KC is
sitting at his computer. It would also *look* fine: a chart with real numbers, confidently wrong
about every hour it never saw.

## The fix

A GitHub Actions workflow (`.github/workflows/collect.yml`) runs the same collector every 30
minutes on an always-on runner and commits the result. Even sampling, no machine to keep awake.

Two details that matter:

- **Finished days are gzipped.** Raw daily files are about 3MB; left as-is the repository would
  grow by roughly a gigabyte a year. Compressed it is nearer 100MB.
- **Runs are serialised** with a concurrency group, and push is rebase-on-conflict, so two runs can
  never append to the same file at once or clobber each other.

The Windows scheduled task stays as a harmless second sampler — duplicate readings for the same
minute are simply extra rows.

## Then the fix broke too, the same way

Four days later the runner was producing **3 snapshots a day**, covering 3 hours of 24.

Nothing looked wrong. Every run that fired exited 0. None were cancelled or skipped. The workflow
was `active`, the repo public and busy. The runs were simply *not being dispatched* — and the
**once-daily** publish workflow decayed in exactly the same shape, 29 minutes late, then 2h51m,
then missing a day entirely. So it was not this cron's frequency, and not something this repo could
fix. GitHub's scheduler had quietly stopped being punctual for us.

| day | runner | laptop |
|---|---|---|
| 25 Aug | 26 snapshots, 23/24 hours | **48, 24/24** |
| 26 Aug | 24 snapshots, 22/24 hours | **48, 24/24** |
| 27 Aug | 6 snapshots, 6/24 hours | 22, 11/24 |
| 28 Aug | 3 snapshots, 3/24 hours | none — laptop off |

The laptop column is the twist. It had been collecting **perfectly** — 48 a day across every hour —
and publishing none of it, because `collect.ps1` wrote to disk and never pushed. The claim above
that it was "a harmless second sampler" was wrong: it was not a sampler at all, just a folder
filling up. The original "the machine sleeps" diagnosis had also expired, because the laptop's
mains power profile now has sleep disabled outright.

## What collects now

Three sources, deliberately overlapping, because the lesson of both failures is that a single
scheduler is a single point of silence:

1. **The laptop**, every 30 minutes on the hour and half hour — now commits and pushes what it
   collects. Best coverage by far when it is on; nothing at all when it is off.
2. **cron-job.org**, at :10 and :40 — POSTs a `repository_dispatch` to run the workflow. An
   external webhook is not subject to whatever back-pressure GitHub applies to its own cron queue.
   Offset on purpose so it interleaves with the laptop rather than duplicating it.
3. **GitHub's schedule**, still every 30 minutes, now only a third line of defence.

Two writers to one append-only file used to mean a merge conflict and a human picking a side —
which cost real readings once. `.gitattributes` now sets `merge=union` on the history files: every
line is an independent snapshot and order carries no meaning, so the correct merge is always
*both*.

## The check that would have caught it sooner

Both failures were found by accident, days late, because everything being monitored was green.
`scripts/coverage.js` reports snapshots per day, hours covered, and the longest gap — the gap being
the part that hurts, since it is a time of day the app can never learn anything about. The publish
workflow prints it into the run summary and warns below 24 a day. It never fails the publish: thin
history makes the predictions slow to arrive, not wrong.

**Verifying that collection ran proves the mechanism works and says nothing about whether the data
will be usable.** That is now the second time this project has learned that, so it is a script.

## The general lesson

The schedule was verified when it was set up: the task ran, exited 0, and wrote a file. That test
proved the *mechanism* worked and said nothing about whether the *data* would be usable.

**Check the shape of what you collected, not just that collection happened.** Four days of silent
bias were sitting in a directory that looked perfectly healthy from the outside.
