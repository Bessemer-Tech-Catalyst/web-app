# GitHub Actions CI Integration — Summary

## What Was Built

A complete GitHub Actions workflow that automatically scans PR preview deployments with Odyssey, generating quality reports and posting results directly on the PR.

### New Files

1. **`.github/workflows/odyssey-scan.yml`** (250+ lines)
   - Triggered on PR open/update/reopen
   - Gets preview URL from deploy job
   - Calls deployed Odyssey app to start scan
   - Polls for completion (max 10 min)
   - Exports Markdown report
   - Posts idempotent PR comment with summary

2. **`src/app/api/auth/require-ci-token.ts`**
   - Bearer-token validation helper
   - Checks `Authorization: Bearer <token>` header
   - Backward-compatible: no-op when `ODYSSEY_CI_TOKEN` env var unset

3. **`src/app/api/runs/[id]/report.md/route.ts`**
   - Exports full test report as Markdown
   - Uses existing `reportMarkdown()` function
   - Protected by auth token
   - Returns `404` if report not ready

4. **`.github/ODYSSEY_CI_SETUP.md`** (200+ lines)
   - Complete setup guide
   - Step-by-step instructions
   - Troubleshooting section
   - Testing procedures

### Modified Files

1. **`src/app/api/runs/route.ts`**
   - Added `requireCiToken()` check to `POST /api/runs`
   - Gated run creation with bearer token when env var is set

## How It Works

### Workflow Flow

```
1. PR Created/Updated
   ↓
2. GitHub Actions triggered
   ↓
3. Deployment job publishes preview URL
   ↓
4. Odyssey scan workflow fetches preview URL
   ↓
5. POST /api/runs with bearer token
   ← Response: { id: "run_abc123" }
   ↓
6. Poll GET /api/runs/[id] until report ready
   ← Response: { state: { report: {...} }, live: false }
   ↓
7. GET /api/runs/[id]/report.md (static markdown)
   ← Response: Full Markdown report
   ↓
8. Write to $GITHUB_STEP_SUMMARY
   ↓
9. Post PR comment (or update if exists)
   - Coverage score
   - Bugs found
   - Pass/fail/heal breakdown
   - Link to full report
```

### Authentication Design

**Backward Compatible:**
- If `ODYSSEY_CI_TOKEN` env var is **NOT** set on server → auth disabled (current behavior)
- If `ODYSSEY_CI_TOKEN` is set → all callers must send `Authorization: Bearer <token>`

**Why this approach:**
- Local development unaffected (no auth required)
- Production/staging protected (token required)
- Simple, no middleware.ts needed (consistent with repo style)
- Browser UI can still work if token is not set

## Setup Instructions (Quick)

1. **Deploy Odyssey** to a publicly-accessible URL (Vercel, AWS, etc.)

2. **Set env var** on deployed Odyssey:
   ```
   ODYSSEY_CI_TOKEN=odyssey_sk_<random>
   ```

3. **Add GitHub Secrets**:
   - `ODYSSEY_URL` = deployed app URL
   - `dev` = bearer token (same value as env var on deployed app)

4. **Wire preview URL** in `.github/workflows/odyssey-scan.yml`:
   - Update "Get preview URL" step to pull from your deploy job

5. **Create PR** — workflow auto-runs, scans, comments with results

For detailed setup, see `.github/ODYSSEY_CI_SETUP.md`

## Key Features

✅ **Automatic on every PR** — No manual triggers needed
✅ **Report export** — Full markdown report available
✅ **Idempotent comments** — Updates existing comment on rerun
✅ **Real preview URLs** — Tests actual PR deployment, not main branch
✅ **Auth-protected** — Token prevents unauthorized API access
✅ **Timeout safety** — 10-minute max wait for scan completion
✅ **Live report link** — PR comment includes link to full report dashboard
✅ **Step summary** — GitHub Actions summary page shows results

## API Endpoints Used

### `POST /api/runs` (Create scan)
```bash
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://pr-preview.example.com"}' \
  $ODYSSEY_URL/api/runs

# Response: { id: "run_abc123" }
```

### `GET /api/runs/[id]` (Poll status)
```bash
curl -H "Authorization: Bearer $TOKEN" \
  $ODYSSEY_URL/api/runs/run_abc123

# Response: { state: { report: {...} }, input: {...}, live: false }
```

### `GET /api/runs/[id]/report.md` (Export report)
```bash
curl -H "Authorization: Bearer $TOKEN" \
  $ODYSSEY_URL/api/runs/run_abc123/report.md

# Response: Full Markdown report
```

## Example PR Comment

```
## 🧪 Odyssey Test Scan

| Metric | Value |
|--------|-------|
| Coverage | 88/100 |
| Bugs Found | 2 |
| Passed | 13 |
| Failed | 1 |
| Healed | 1 |

📊 View Full Report (link to dashboard)
```

## Testing the Integration

1. Create a PR against the repo
2. Watch Actions tab for "Odyssey Scan" workflow
3. Wait for completion (~1-2 minutes)
4. Check PR comments for Odyssey report
5. Push another commit to same PR
6. Verify comment **updates** (not duplicated)

## Important Notes

- **Polling timeout**: 10 minutes max. If scan takes longer, workflow times out.
- **Budget limit**: The scan respects the budget set in RunOptions (default $5). If exceeded, workflow waits for completion anyway.
- **Preview URL**: Must be accessible from GitHub Actions (no localhost).
- **Token rotation**: If you regenerate the token, update both the deployed app env var AND the GitHub Secret.

## Next Steps

1. Deploy Odyssey app to staging/production
2. Follow `.github/ODYSSEY_CI_SETUP.md` for full setup
3. Create a test PR to verify workflow runs
4. Celebrate automatic quality insights on every PR!

---

**See also:**
- `.github/workflows/odyssey-scan.yml` — Full workflow YAML
- `.github/ODYSSEY_CI_SETUP.md` — Complete setup guide with troubleshooting
- `/ODYSSEY_PROJECT.md` — Full project documentation
