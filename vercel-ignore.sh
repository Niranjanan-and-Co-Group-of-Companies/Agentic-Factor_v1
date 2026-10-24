#!/bin/sh
# Vercel's "Ignored Build Step": exit 0 skips the build, exit 1 builds.
# Skips only when nothing outside mobile/ (the phone app) changed since the last deployment. Builds whenever
# that can't be told: a redeploy of the same commit, or a last-deployed commit missing from Vercel's shallow
# clone (as after merging many commits at once).
prev="${VERCEL_GIT_PREVIOUS_SHA:-}"
[ -n "$prev" ] || prev="$(git rev-parse --verify --quiet HEAD^)" || exit 1
[ "$prev" = "${VERCEL_GIT_COMMIT_SHA:-}" ] && exit 1
git cat-file -e "${prev}^{commit}" 2>/dev/null || exit 1
if git diff --quiet "$prev" HEAD -- . ':(exclude)mobile'; then exit 0; fi
exit 1
