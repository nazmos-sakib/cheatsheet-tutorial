#!/bin/sh
# Pull new commits from GitHub and rebuild the site, but only if something changed.
set -eu
cd "$(dirname "$0")/.."

git fetch --quiet origin main
if [ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ]; then
  exit 0
fi

echo "$(date '+%F %T') updating to $(git rev-parse --short origin/main)"
git merge --ff-only --quiet origin/main
sudo docker compose up -d --build
sudo docker image prune -f > /dev/null