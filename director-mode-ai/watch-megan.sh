#!/bin/bash
# Poll until Megan accepts her invitation (or ~3h passes), then exit so the
# session is re-invoked with the result.
cd /c/Users/darri/DirectorModeAI/director-mode-ai
for i in $(seq 1 180); do
  OUT=$(node scripts/dbrun.mjs "select coalesce(to_char(accepted_at,'YYYY-MM-DD HH24:MI'),'PENDING') as accepted, coalesce(accepted_by::text,'-') as who from cc_club_invites where email='meganmariasullivan@gmail.com' and revoked_at is null" 2>/dev/null)
  if echo "$OUT" | grep -q "PENDING"; then
    sleep 60
  else
    echo "MEGAN ACCEPTED"
    echo "$OUT"
    exit 0
  fi
done
echo "STILL PENDING after 3 hours"
exit 0
