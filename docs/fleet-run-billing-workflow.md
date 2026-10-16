# Fleet run billing workflow

Every new run requires an explicit billing choice: **Run as new ticket** or
**Add run to ticket**. Creating a new ticket and its run is one transaction;
retrying the same operation cannot create another ticket or run. Older recorded
runs remain readable and are not silently backfilled or moved to another ticket.

The pickup site is the billing origin. An existing ticket must belong to the
same company, billing site, AFE snapshot and selected work date, remain open to
additional runs, and permit batching. The office explicitly finalizes the ticket;
midnight, driver closeout and individual run review do not finalize it. An
explicit partner/site Singles requirement still requires a new ticket for each
run. The vendor's default does not override the user's explicit new/shared
choice in this workflow. Existing destination-plan behavior remains compatible.

Prices come from the vendor's assigned service catalog. Fixed per-job/lump-sum
services record one unit per accepted run. Hourly and daily services require an
explicit positive office-reviewed quantity with up to two decimal places.
Recorded GPS, elapsed time and map positions never determine billable quantity.
Dispatchers can choose an authorized service without receiving financial fields;
rate visibility requires the existing separate finance permission.

**Close Run** records driver closeout and puts the run into operational review.
Authorized office staff review each run and either accept it or return it for
correction. Accepted runs receive a canonical ticket charge exactly once. The
office then reviews and explicitly selects **Finalize and submit ticket**.
Submission requires every noncancelled linked run, including historical records,
to be reviewed, its current canonical charges to match, and all ticket crew
sessions to be closed. Ticket and line-item locks protect these checks against
concurrent run attachments or charge changes. Submitted tickets stop admitting
additional runs. A kicked-back ticket can be corrected and explicitly resubmitted
under a fresh reviewed operation without reopening run admission.

Web, iOS, typed/realtime Ask V and the ChatGPT plugin use the same server rules.
Clients preserve uncertain operations and independently read canonical results
before reporting success. ChatGPT ticket finalization requires the explicit
`fleet:billing` consent in addition to current server authority; updating the
plugin does not silently expand existing grants.

Implementation uses existing canonical tickets, ticket lines, Fleet state and
audit records. This change requires no new database columns, storage buckets or
external dependencies. Physical iPhone/push acceptance remains distinct from
automated tests and a successful TestFlight build/submission.
