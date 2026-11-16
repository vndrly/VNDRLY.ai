# iPhone Gate outage recording

The native Gate screen exposes an Offline log below its embedded page. It can
open even if that page fails to load. Authenticated API roster reads time out
after 12 seconds; network errors and server failures open the native log.

Before an outage, open Gate and select the working site and gate. The authenticated
page supplies that context to native encrypted storage. Native refresh reads all
pages of the current site's roster. The cache is facts, not authorization, and is
isolated by user, membership and organization. It does not expire during an outage.
First-time setup and signing in as a different user still require service.

The gatekeeper reviews a crossing, then confirms Save on device. The original
device timestamp, operation UUID, selected gate and reported visitor details are
persisted before the saved message appears. A failed local write retains the form
and shows an error. Check-outs reference either an exact cached visit or an exact
locally recorded arrival, never a guessed matching plate. Missing plate/company
information can be recorded in notes rather than inventing it.

The native journal uses the existing SQLCipher SQLite store and SecureStore key.
The Expo browser preview uses its existing in-memory store; browser refresh is
not a durability test for iPhone. Storage capacity is bounded at 5,000 journal
events / 10 MB. Unresolved work is never evicted. A newer, complete server roster
can compact acknowledged closed visits; canonical server audit receipts remain.

While the app is active, recovery polling retries original operations. A single
flush handles up to 50 records, and a slow upload does not hold the local write
lock. Each Gate request has a 12-second timeout. Lost responses use the same
operation UUID on retry. Linked exits wait for their arrival receipt. Rate limits,
server errors and timeouts remain retryable; conflicts and access refusals remain
on the device for authorized resolution. The app does not promise background
execution while iOS suspends it; foregrounding resumes synchronization.

The server rechecks current authorization and site/gate ownership. Uploaded
crossings retain observed times, record upload time and receive
`needs_supervisor_review` / pending admission. An observed crossing is not proof
that admission or a current hold was checked. Offline records do not send alerts.
The standing MidCon notification hold remains unchanged.

Known on site combines cached server facts and device crossings, deduplicating
server receipts. It is explicitly not a live, verified headcount. Other devices'
offline work is unavailable until they synchronize. For an exit absent from both
the cached roster and this device's arrivals, do not invent an entry to force a
match; this remains a limitation requiring a later unmatched-observation workflow.

## Verification

Automated checks cover a simulated two-hour 503 outage, journal reload, receipt
loss after server commit, ordered entry/exit replay, duplicate taps, concurrent
capture during stalled upload, account isolation, exact visitor exits, storage
failure, cache selection races and explicit modal dismissal.

Release acceptance on a physical iPhone still requires airplane mode, force-close
and relaunch, keyboard-open portrait/landscape, and reconnection against a test
account. No test should create synthetic crossings in a real operating gate.

## AskV boundary

This change supplies manual outage capture. It does not add offline speech
recognition or an on-device language model. Cloud AskV cannot process requests
during a service/network outage. Connected conversational readback/confirmation,
header access and full Gate helper inventory remain separate work; do not claim
that a saved observation was admitted or reviewed by V.
