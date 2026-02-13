#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${1:-}" ]]; then
  echo "Usage: ./release.sh <version> [release notes]"
  echo "Example: ./release.sh 1.0.1 \"Bug fixes\""
  exit 1
fi

# Ensure git is clean (ignoring untracked files)
if ! git diff-index --quiet HEAD --; then
  echo "ERROR: Working directory is not clean. Commit or stash changes first."
  exit 1
fi

VERSION="$1"
NOTES="${2:-Release $VERSION}"
TAG="v$VERSION"

# Update version in package.json and create git tag
npm version "$VERSION" -m "Release %s"

# Push commit and tags
git push origin HEAD --tags

if command -v gh >/dev/null 2>&1; then
  if gh release view "$TAG" >/dev/null 2>&1; then
    echo "Release $TAG already exists; skipping GitHub release creation."
  else
    gh release create "$TAG" --title "$VERSION" --notes "$NOTES"
  fi
else
  echo "WARNING: gh CLI not found; skipping GitHub release creation."
fi

echo "SUCCESS: Released version $VERSION"
