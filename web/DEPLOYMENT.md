# Cloud Terminal Deployment Guide

This document provides the authoritative guidelines for deploying changes to the Cloud Terminal web application. **Read this before deploying any changes.**

## Quick Reference

```bash
# Safe deployment workflow
cd cloud-terminal/web
npm run build                          # Verify build succeeds locally
git add -A
git commit -m "feat: your changes"
git pull --rebase origin main          # REQUIRED before push
git push origin main                   # Triggers Vercel deploy
```

## Version Management

### Version Number Location

The application version is stored in `package.json`:
```json
{
  "version": "0.2.15"
}
```

### When to Update Version

**ALWAYS bump the version when deploying new features or fixes:**

| Change Type | Version Bump | Example |
|-------------|--------------|---------|
| Breaking change | Major (x.0.0) | 0.2.15 → 1.0.0 |
| New feature | Minor (0.x.0) | 0.2.15 → 0.3.0 |
| Bug fix | Patch (0.0.x) | 0.2.15 → 0.2.16 |

### How to Update Version

1. Update `package.json`:
   ```bash
   npm version patch  # or minor, or major
   ```
   Or manually edit the version field.

2. The version is automatically read from `package.json` and displayed in the UI.

3. Click the version number in the bottom-left corner to view the changelog.

## Multi-Agent Conflict Avoidance

**CRITICAL**: Multiple Claude Code instances may deploy simultaneously. Follow these rules to prevent conflicts.

### Before Every Push (MANDATORY)

```bash
# 1. Build locally first to catch errors
npm run build

# 2. Fetch latest remote changes
git fetch origin

# 3. Check if remote has new commits
git log HEAD..origin/main --oneline

# 4. If there are new commits, rebase your changes on top
git rebase origin/main

# 5. Only then push
git push origin main
```

**Or use the single-command workflow:**
```bash
npm run build && git pull --rebase origin main && git push origin main
```

### Handling Push Rejections

If you see:
```
! [rejected] main -> main (non-fast-forward)
error: failed to push some refs
```

**DO NOT use `--force`.** Instead:

1. `git fetch origin`
2. `git rebase origin/main`
3. Resolve any conflicts (see below)
4. `git push origin main`

### Resolving Rebase Conflicts

If `git rebase` shows conflicts:

1. Open conflicting files and look for markers: `<<<<<<<`, `=======`, `>>>>>>>`
2. Edit files to resolve conflicts:
   - Keep both changes if they don't overlap
   - Merge logically if they do
3. `git add <resolved-files>`
4. `git rebase --continue`
5. Repeat until complete
6. `git push origin main`

### Forbidden Commands

**NEVER use these** - they can destroy other instances' work:
- `git push --force`
- `git push -f`
- `git push --force-with-lease`
- `git reset --hard origin/main`

## Vercel Deployment

### Deployment Flow

1. Push to GitHub triggers automatic Vercel build
2. Build takes **2-3 minutes** to complete
3. If build fails, errors appear in Vercel dashboard
4. **You must verify deployment succeeds before considering work complete**

### Post-Push Verification

```bash
# Wait for build (2-3 minutes)
sleep 120

# Verify production site loads
curl -s "https://web-noah-edis-projects.vercel.app" | head -20
```

### Verification Checklist

After pushing changes, confirm:

- [ ] Git push succeeded (no conflicts)
- [ ] Waited 2-3 minutes for Vercel build
- [ ] Production site loads: https://web-noah-edis-projects.vercel.app
- [ ] Version number updated in bottom-left corner
- [ ] New feature/fix is working as expected
- [ ] No console errors on the deployed site

### Common Build Errors

| Error | Fix |
|-------|-----|
| Type errors | Run `npm run build` locally first |
| Missing imports | Check import paths, ensure files exist |
| Build timeout | Optimize large dependencies or split code |
| Environment variables | Ensure required vars are in Vercel dashboard |

## Changelog Management

The changelog is automatically generated from git commits and displayed at `/changelog`.

### Commit Message Format

Use conventional commit format for automatic changelog generation:

```
type(scope): description

feat: Add dark mode toggle
fix: Resolve session name overflow
refactor: Simplify message parsing
docs: Update deployment guide
```

### Types

- `feat`: New feature
- `fix`: Bug fix
- `refactor`: Code change that neither fixes nor adds
- `docs`: Documentation only
- `style`: Formatting, missing semicolons, etc.
- `test`: Adding tests
- `chore`: Maintenance tasks

## Complete Deployment Workflow

### Standard Feature Deployment

```bash
# 1. Make your changes
# ...code changes...

# 2. Build and verify locally
cd cloud-terminal/web
npm run build

# 3. Update version (if needed)
npm version patch  # or minor/major

# 4. Commit with descriptive message
git add -A
git commit -m "feat: Add auto-generated session names"

# 5. Pull latest and rebase
git pull --rebase origin main

# 6. Push (triggers Vercel deploy)
git push origin main

# 7. Wait and verify
sleep 120
curl -s "https://web-noah-edis-projects.vercel.app" | head -20

# 8. Check changelog page shows your commit
open "https://web-noah-edis-projects.vercel.app/changelog"
```

### Emergency Hotfix

```bash
# Same as above, but with urgency
npm run build && \
git add -A && \
git commit -m "fix: Critical bug in X" && \
git pull --rebase origin main && \
git push origin main
```

## Troubleshooting

### "Another instance pushed while I was working"

This is normal. Just rebase:
```bash
git fetch origin && git rebase origin/main && git push origin main
```

### "Build failed on Vercel but works locally"

1. Check environment variables in Vercel dashboard
2. Verify all dependencies are in `package.json` (not devDependencies if needed at runtime)
3. Check Vercel build logs for specific errors

### "Version not updating in UI"

1. Verify `package.json` version was updated
2. Clear browser cache (Cmd+Shift+R)
3. Check if build completed successfully

### "Changelog not showing recent commits"

1. Commits are fetched from git history
2. Only commits after the changelog feature was added appear
3. Check `/api/changelog` endpoint directly

## Related Documentation

- [Root CLAUDE.md](/CLAUDE.md) - Project-wide git workflow
- [ARCHITECTURE.md](/cloud-terminal/ARCHITECTURE.md) - System architecture
- [README.md](/cloud-terminal/README.md) - General project info
