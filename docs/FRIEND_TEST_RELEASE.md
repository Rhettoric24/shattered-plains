# Friend-Test Release Checkpoint

**Release date:** September 6, 2026  
**Release tag:** `friend-test-2026-09-06`  
**Frontend:** GitHub Pages, explicitly connected to Buzzard  
**Backend/world:** Convex production `groovy-buzzard-108` (Buzzard)  
**Development backend:** Convex development `clean-yak-51` (Yak)

This checkpoint names the exact baseline friends receive. Changes after
this point can be compared with the tagged code and the production data
snapshot instead of relying on memory.

## Release gates completed

- Production authentication and new-account flow smoke-tested.
- Fresh Buzzard world initialized and bootstrap idempotency verified.
- Admin observer access isolated from competitive world calculations.
- GitHub Pages deliberately cut over from Yak to Buzzard.
- Live mobile/PWA navigation and core loops smoke-tested.
- Background Apple push delivery verified through the real Buzzard
  notification path.
- Automated suite green for the release changes; focused PWA checks cover
  recruitment increments, alerts, Hostility teaching, and Highstorm timing.

## Production recovery point

The ignored local `backups/` directory contains:

`buzzard-friend-test-release-2026-09-06.zip`

This is a Convex production export taken at the release checkpoint. It is
kept outside Git because it contains live application data and may contain
account-related records. Do not publish or attach it to issues.

## Accepted friend-test limitations

- Extreme pinch-zoom can expose a cosmetic background seam.
- Phone landscape mode leaves too little usable height; recommend portrait.
- Password recovery is not implemented. Testers must retain their passwords.
- Comprehensive responsive-shell redesign and balance tuning remain deferred
  until player evidence exists.

These are recorded rather than treated as launch blockers because they do not
corrupt data, prevent portrait play, or invalidate the systems being tested.

## Tester handoff

Ask friends to:

- Open the GitHub Pages game and create their own account.
- Use portrait orientation on phones.
- Enable background notifications from the bell menu.
- Remember their password.
- Use the ladybug button for bugs and describe what they expected.

Avoid teaching strategy or revealing hidden systems unless a tester is truly
blocked. Record observed behavior separately from later explanations.

## Change policy during the friend test

Fix immediately only when an issue blocks login or progression, risks data,
breaks a core control, produces an incorrect game result, or causes a server
failure. Batch wording, layout, balance, and feature requests after patterns
emerge across players.
