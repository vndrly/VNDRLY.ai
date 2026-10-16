/** Operator Gate entry/checkout accept optional device evidence; self check-in is a separate API. */
export const isOperatorGateAction = (name: string) => ["confirm_visitor_check_in", "confirm_visitor_check_out"].includes(name);
export const requiresActionLocation = (name: string, input: Record<string, unknown> = {}) => ["start_paid_travel", "set_ticket_lifecycle", "close_ticket_for_review"].includes(name) || (name === "confirm_field_trips_action" && input.action === "location");
export const ACTION_LOCATION_CLIENT = `document.querySelector('form[data-location="required"],form[data-location="optional_gate"]')?.addEventListener('submit', function(event) {
  if (this.dataset.located === 'yes') return;
  const form = this, optional = form.dataset.location === 'optional_gate';
  if (optional && !navigator.geolocation) return;
  event.preventDefault();
  const status = document.getElementById('location-status');
  status.textContent = 'Getting your current location…';
  let submitted = false;
  const timer = optional ? setTimeout(proceedWithoutLocation, 1500) : null;
  function proceedWithoutLocation() { if(submitted)return; submitted=true; if(timer!==null)clearTimeout(timer); status.textContent = 'Submitting without GPS evidence.'; form.dataset.located = 'yes'; form.requestSubmit(); }
  if (!navigator.geolocation) { status.textContent = 'Location permission is required for this VNDRLY action. Enable location and try again.'; return; }
  try { navigator.geolocation.getCurrentPosition(function(position) {
    if(submitted)return; submitted=true; if(timer!==null)clearTimeout(timer);
    form.elements.latitude.value = position.coords.latitude;
    form.elements.longitude.value = position.coords.longitude;
    form.elements.accuracyMeters.value = position.coords.accuracy;
    form.dataset.located = 'yes'; form.requestSubmit();
  }, function() {
    if (optional) proceedWithoutLocation();
    else status.textContent = 'Location permission is required for this VNDRLY action. Enable location and try again.';
  }, {enableHighAccuracy:true,timeout:optional?1500:15000,maximumAge:0}); } catch { if(optional)proceedWithoutLocation(); else status.textContent = 'Location permission is required for this VNDRLY action. Enable location and try again.'; }
});`;
