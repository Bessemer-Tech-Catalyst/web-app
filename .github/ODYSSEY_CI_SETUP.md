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

## Setup Steps (Local Development)

### Step 1: Add GitHub Secret

Go to **Settings → Secrets and variables → Actions** and add:

| Secret Name | Value |
|-------------|-------|
| `ODYSSEY_CI_TOKEN` | Any test token (e.g., `test_token_12345`) |

### Step 2: Start Local Odyssey Dev Server

Before the workflow runs, start your local Odyssey instance:

```bash
npm run dev
# Odyssey runs on http://localhost:3000
```

The workflow will call `http://localhost:3000/api/runs` directly. This requires the workflow to run in an environment where `localhost:3000` is accessible (e.g., on the same machine, in a Docker container, or via port forwarding).

**Note**: GitHub Actions runners (ubuntu-latest) **cannot** reach `localhost:3000` by default. This setup is meant for:
- Local testing (running workflow manually with `act`)
- Docker-based CI (where Odyssey runs in the same container network)
- Custom self-hosted runners with local access to port 3000

### Step 3: Commit

```bash
git add .github/workflows/odyssey-scan.yml
git commit -m "Configure Odyssey CI for local development"
git push origin main
```

## Testing Locally

### Option 1: Use `act` (GitHub Actions Local Tester)

```bash
# Install act: https://github.com/nektos/act

# Create a local secrets file (.secrets)
echo "ODYSSEY_CI_TOKEN=test_token_12345" > .secrets

# In one terminal, start Odyssey
npm run dev

# In another terminal, run the workflow locally
act pull_request -s ODYSSEY_CI_TOKEN=test_token_12345
```

The workflow will call `http://localhost:3000/api/runs` and create a test scan.

### Option 2: Create a Real PR

1. **Start local Odyssey** in one terminal:
   ```bash
   npm run dev
   ```

2. **Create a PR** against the repo

3. Watch the "Odyssey Scan" action in the PR's Checks tab (it will likely fail if running on GitHub's servers, since they can't reach localhost)

4. For local development, use `act` instead (Option 1)

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
