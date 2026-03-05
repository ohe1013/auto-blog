# OpenClaw + Playwright Orchestration (v1)

## Responsibility split

- **OpenClaw / blog-mvp API**: create structured publish jobs, queue/retry bookkeeping, notifications.
- **Playwright worker**: execute browser UI steps (title/body/images/save/publish).

## Job schema (`src/lib/job.ts`)

- id, createdAt, source
- title, bodyText, bodyHtml(optional)
- images[]: `{ path, alt, insertOrder }`
- tags, category, visibility, scheduledAt(optional)
- checkpoint: `{ step, retries }`

## Queue layout

- `scripts/jobs/*.queued.json` : waiting jobs
- `scripts/jobs/*.done.json` : succeeded jobs
- `scripts/jobs/*.failed.json` : failed jobs
- `scripts/checkpoints/*.png|json` : step-level diagnostics

## Worker execution

```bash
cd blog-mvp
pnpm add -D playwright
npx playwright install chromium
node workers/naver-worker.mjs
```

## Login credential strategy

- Preferred: `storageState` reuse (`scripts/naver-storage-state.json`)
- Auto recovery: worker can read Windows Credential Manager and perform login when redirected to Naver login page.
- Credential scripts:
  - `scripts/set-naver-credential.ps1`
  - `scripts/get-naver-credential.ps1`

## Retry strategy (implemented v1)

- `maxRetries` default: 2 (job-level override supported)
- Worker stores `checkpoint.step` + `checkpoint.retries` + `checkpoint.lastError`
- Files move by state:
  - `.queued.json` -> active queue
  - `.done.json` -> success
  - `.failed.json` -> exceeded retries
- Resume behavior: worker reads `checkpoint.step` and continues from next step.

## Image insert rules (implemented v1)

`imageInsertStrategy`:

- `append` (default):
  1. Fill full body text
  2. Upload images in `insertOrder`
- `interleave`:
  1. Split body by blank lines
  2. Type each chunk
  3. Insert one image between chunks (remaining images appended)

Both modes save draft only (no publish).

## Notes

- Run worker in dedicated profile/VM for account stability.
- Keep `storageState` file for persistent login.
- If captcha appears, mark as `needs-human` and stop.
