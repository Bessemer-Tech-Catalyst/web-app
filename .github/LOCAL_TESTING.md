# Local GitHub Actions Testing with `act`

The GitHub Actions workflow calls `http://localhost:3000` which **cannot** be reached from GitHub's remote runners. For local testing, use `act` to simulate the workflow on your machine.

## Setup

### 1. Install `act`

Download from: https://github.com/nektos/act/releases

Or using Chocolatey (Windows):
```powershell
choco install act
```

Or using Homebrew (macOS):
```bash
brew install act
```

### 2. Start Odyssey Dev Server

In one terminal:
```bash
npm run dev
```

Odyssey will run on `http://localhost:3000`

### 3. Run the Workflow Locally

In another terminal:
```bash
act pull_request -s ODYSSEY_CI_TOKEN=test_token
```

This simulates a PR event and runs the entire workflow locally.

## What Happens

1. `act` simulates the GitHub Actions environment
2. Workflow runs on your machine (in Docker by default)
3. API calls go to `http://localhost:3000` (on your local network)
4. Scan completes and PR comment is simulated

## Output

You'll see:
```
[Odyssey Scan/scan] ✅ Scan complete!
[Odyssey Scan/scan] Started scan with run ID: run_74a5a9a6
[Odyssey Scan/scan] 📊 Summary: Coverage=88, Bugs=2, Passed=13, Failed=1, Healed=1
```

## Troubleshooting

### "Cannot reach localhost:3000"
- Ensure `npm run dev` is still running in another terminal
- Check that Odyssey is listening on port 3000: `curl http://localhost:3000`

### "Docker is required"
- Install Docker Desktop for your OS
- Or use the `-P` flag to run in shell mode (less isolated): `act pull_request -P ubuntu-latest=node:20 -s ODYSSEY_CI_TOKEN=test_token`

### "Authentication failed"
- The token defaults to `test_token` - make sure your Odyssey instance accepts it
- Check `src/app/api/auth/require-ci-token.ts` - if `ODYSSEY_CI_TOKEN` env var is not set on the server, auth is disabled

## Advanced: Test with Real GitHub Secret

Create a `.secrets` file in the repo root:
```
ODYSSEY_CI_TOKEN=my_test_token
```

Then run:
```bash
act pull_request --secret-file .secrets
```

(Add `.secrets` to `.gitignore` to avoid committing it)

## Real PR Testing

Once you're ready to test on real GitHub PRs:

1. Deploy Odyssey to a public URL (Vercel, AWS, etc.)
2. Update `.github/workflows/odyssey-scan.yml` to use that URL instead of `http://localhost:3000`
3. Add `ODYSSEY_CI_TOKEN` secret to GitHub (Settings → Secrets and variables → Actions)
4. Create a PR - workflow will run automatically

---

**See also:**
- `.github/workflows/odyssey-scan.yml` — The workflow
- `.github/ODYSSEY_CI_SETUP.md` — Full setup guide
- `src/app/api/auth/require-ci-token.ts` — Auth implementation
