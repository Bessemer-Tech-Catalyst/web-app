# GitHub Actions CI Integration Setup

This guide walks through setting up automatic PR preview scanning with Odyssey.

## Architecture

When a PR is created or updated, the workflow:
1. Gets the PR's preview URL (from your deployment job)
2. Calls the deployed Odyssey app to start a scan
3. Polls for completion (max 10 minutes)
4. Exports the report as Markdown
5. Posts/updates a comment on the PR with results (coverage, bugs found, pass rate)

```
PR Created/Updated
       ↓
GitHub Actions triggers
       ↓
Deploy job publishes preview URL
       ↓
Odyssey scan workflow runs
       ↓
Calls deployed Odyssey /api/runs (with auth token)
       ↓
Polls until scan completes
       ↓
Fetches report.md from /api/runs/[id]/report.md
       ↓
Posts PR comment with summary + link to full report
```

## Prerequisites

1. **Deployed Odyssey instance** — The app must be accessible from GitHub Actions (e.g. Vercel staging, AWS, etc.). It cannot be localhost.
2. **Your existing PR preview deploy job** — The workflow assumes you have a step that publishes a preview URL (e.g. Vercel, Netlify). The workflow needs you to wire that URL.

## Setup Steps

### Step 1: Set Environment Variable on Deployed Odyssey

On your deployed Odyssey instance, add an environment variable:

```
ODYSSEY_CI_TOKEN=<generate-a-random-strong-token>
```

Example: `ODYSSEY_CI_TOKEN=odyssey_sk_1a2b3c4d5e6f7g8h9i0j`

**Important**: This should be a random, hard-to-guess value (not reused anywhere else).

### Step 2: Add GitHub Secrets to the Repository

Go to **Settings → Secrets and variables → Actions** and add:

| Secret Name | Value |
|-------------|-------|
| `ODYSSEY_URL` | Your deployed Odyssey base URL (e.g., `https://odyssey-staging.vercel.app`) |
| `dev` | Bearer token value (same as `ODYSSEY_CI_TOKEN` env var on the deployed app) |

### Step 3: Wire Preview URL to the Workflow

Edit `.github/workflows/odyssey-scan.yml` and update the "Get preview URL" step to pull from your actual deploy job:

**For Vercel Preview Deployments:**
```yaml
- name: Get preview URL
  id: preview
  run: |
    preview_url=${{ needs.deploy.outputs.preview_url }}
    echo "preview_url=$preview_url" >> $GITHUB_OUTPUT
```

**For GitHub Pages / Custom Deploy:**
Replace the step with your own logic. The step should set `preview_url` output, e.g.:
```yaml
- name: Get preview URL
  id: preview
  run: |
    # Example: construct URL from PR number
    preview_url="https://preview-pr-${{ github.event.pull_request.number }}.example.com"
    echo "preview_url=$preview_url" >> $GITHUB_OUTPUT
```

### Step 4: Commit and Deploy

```bash
git add .github/workflows/odyssey-scan.yml
git commit -m "Wire Odyssey CI workflow to deployment job"
git push origin main
```

## Testing

### Test 1: Create a PR

1. Create a new PR against the repo
2. Watch the "Odyssey Scan" action run in the PR's Checks tab
3. Wait for the workflow to complete (~1-2 minutes)
4. Verify a comment appears on the PR with:
   - Coverage score (X/100)
   - Bugs found
   - Passed/failed/healed test breakdown
   - Link to full report

### Test 2: Push Another Commit

1. Push a new commit to the same PR
2. Watch the workflow run again
3. Verify the PR comment **updates** (not duplicated) with new results

## Understanding the Workflow

### Authentication

- **Bearer Token**: The workflow sends `Authorization: Bearer <token>` in API requests
- **Protected Routes**: 
  - `POST /api/runs` — Creates a new scan
  - `GET /api/runs/[id]/report.md` — Exports the report
- **Backward Compatible**: If `ODYSSEY_CI_TOKEN` env var is NOT set on the server, authentication is disabled (for local development)

### Polling Timeout

The workflow waits up to **10 minutes** for the scan to complete. If:
- The target site is slow to respond
- The scan hits the budget limit
- Network issues occur

The workflow will timeout and the PR comment will fail to post. Check the workflow logs for details.

### Report Export

The workflow calls `GET /api/runs/[id]/report.md` which:
- Returns the full test report in Markdown format
- Uses the existing `reportMarkdown()` function from Odyssey
- Contains coverage score, bugs, risks, PRD traceability, healing actions
- Is uploaded as a GitHub Actions artifact (available in workflow summary)

## Troubleshooting

### Workflow fails: "Invalid token"

**Cause**: The `ODYSSEY_CI_TOKEN` secret doesn't match the env var on the deployed app

**Fix**: 
1. Regenerate a new token
2. Update both places (deployed app env var + GitHub Secret)
3. Re-run the workflow

### Workflow fails: "Run not found or report incomplete"

**Cause**: The scan didn't finish, or the URL is wrong

**Fix**:
1. Check `ODYSSEY_URL` is correct (should be base URL without `/api`)
2. Verify preview URL is accessible and valid
3. Check deployed Odyssey logs for errors
4. Increase timeout in workflow if scans are slow (edit `MAX_WAIT=600` in workflow)

### PR comment doesn't appear

**Cause**: Workflow succeeded but comment step failed (usually GitHub token issue)

**Fix**:
1. Check workflow logs for the `github-script` step
2. Verify the PR comment permission is granted (usually default for `GITHUB_TOKEN`)
3. Re-run the workflow

### How to manually test the API

```bash
# Create a run
curl -X POST \
  -H "Authorization: Bearer <ODYSSEY_CI_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com"}' \
  https://odyssey-staging.vercel.app/api/runs

# Check run status
curl -H "Authorization: Bearer <ODYSSEY_CI_TOKEN>" \
  https://odyssey-staging.vercel.app/api/runs/<run-id>

# Download report
curl -H "Authorization: Bearer <ODYSSEY_CI_TOKEN>" \
  https://odyssey-staging.vercel.app/api/runs/<run-id>/report.md
```

## Disabling the Workflow

To temporarily disable PR scanning:

```bash
# Rename the workflow (GitHub won't run it)
mv .github/workflows/odyssey-scan.yml .github/workflows/odyssey-scan.yml.disabled
```

Or edit the workflow and change the `on:` trigger to `on: workflow_dispatch` (manual trigger only).

## Next Steps

1. ✅ Wire the preview URL to your deploy job
2. ✅ Set environment variables on deployed Odyssey
3. ✅ Add GitHub Secrets
4. ✅ Create a test PR
5. ✅ Monitor the workflow and PR comment
6. ✅ Celebrate! Every PR now gets automatic quality insights.

---

**Questions?** Check the Odyssey docs at `/ODYSSEY_PROJECT.md` or review the workflow YAML at `.github/workflows/odyssey-scan.yml`.
