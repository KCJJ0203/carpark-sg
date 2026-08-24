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

## The general lesson

The schedule was verified when it was set up: the task ran, exited 0, and wrote a file. That test
proved the *mechanism* worked and said nothing about whether the *data* would be usable.

**Check the shape of what you collected, not just that collection happened.** Four days of silent
bias were sitting in a directory that looked perfectly healthy from the outside.
