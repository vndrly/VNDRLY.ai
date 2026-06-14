export type CrewMapLocation = {
  employeeId: number;
  employeeName: string;
  ticketId: number;
  vendorName?: string | null;
  lifecycleState: string | null;
  siteName: string | null;
  siteCode?: string | null;
  siteLatitude: number | null;
  siteLongitude: number | null;
  latitude: number;
  longitude: number;
  batteryLevel: number | null;
  heading: number | null;
  speedMps: number | null;
  recordedAt: string;
};

export type CrewMapSite = {
  id: number;
  name: string;
  latitude?: number | null;
  longitude?: number | null;
  siteRadiusMeters?: number | null;
};

export function buildCrewMapHtml(
  locations: CrewMapLocation[],
  sites: CrewMapSite[],
  brandColor: string,
  apiBase: string,
  options?: { enableLiveEvents?: boolean },
): string {
  const payload = JSON.stringify({
    locations,
    sites,
    brandColor,
    apiBase,
    enableLiveEvents: options?.enableLiveEvents !== false,
  });
  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<style>
  html,body,#map{margin:0;padding:0;height:100%;width:100%;}
  .leaflet-popup-content-wrapper,.leaflet-popup-tip{background:rgba(255,255,255,0.96);}
  .leaflet-popup-content{font:13px/1.35 Inter,system-ui,sans-serif;text-shadow:0 1px 4px rgba(0,0,0,0.28);}
  .lifecycle-flash-pin-ring{position:absolute;inset:-6px;border-radius:50%;border:2px solid #f59e0b;animation:vndrly-flash 1.2s ease-out infinite;}
  @keyframes vndrly-flash{0%{opacity:1;transform:scale(.85);}100%{opacity:0;transform:scale(1.35);}}
</style>
</head><body><div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
  var cfg = ${payload};
  var map = L.map('map', { zoomControl: true });
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 }).addTo(map);
  var bounds = [];
  (cfg.sites || []).forEach(function(site) {
    if (typeof site.latitude !== 'number' || typeof site.longitude !== 'number') return;
    var radius = site.siteRadiusMeters && site.siteRadiusMeters > 0 ? site.siteRadiusMeters : 402;
    L.circle([site.latitude, site.longitude], { radius: radius, color: '#2563eb', weight: 1, fillOpacity: 0.06 }).addTo(map);
    bounds.push([site.latitude, site.longitude]);
  });
  function carSvg(color, heading) {
    var rot = heading != null ? heading : 0;
    return '<div style="position:relative;width:36px;height:50px;transform:translate(-18px,-25px);filter:drop-shadow(0 1px 2px rgba(0,0,0,.45))">' +
      '<div style="transform:rotate(' + rot + 'deg);transform-origin:50% 50%">' +
      '<svg viewBox="-20 -28 40 56" width="36" height="50"><rect x="-10" y="-22" width="20" height="44" rx="6" fill="' + color + '" stroke="white" stroke-width="1.5"/></svg></div></div>';
  }
  (cfg.locations || []).forEach(function(loc) {
    if (typeof loc.latitude !== 'number' || typeof loc.longitude !== 'number') return;
    var color = loc.lifecycleState === 'en_route' ? '#f59e0b' : loc.lifecycleState === 'on_site' ? '#10b981' : loc.lifecycleState === 'on_location' ? '#6366f1' : cfg.brandColor;
    var icon = L.divIcon({ html: carSvg(color, loc.heading), className: '', iconSize: [36,50], iconAnchor: [18,25] });
    var m = L.marker([loc.latitude, loc.longitude], { icon: icon });
    var popup = '<b>' + (loc.employeeName || 'Crew') + '</b><br/>#' + loc.ticketId;
    if (loc.vendorName) popup += '<br/>' + loc.vendorName;
    if (loc.siteName) popup += '<br/>' + loc.siteName;
    if (loc.lifecycleState) popup += '<br/>' + loc.lifecycleState.replace(/_/g, ' ');
    m.bindPopup(popup);
    m.addTo(map);
    bounds.push([loc.latitude, loc.longitude]);
    if (loc.lifecycleState === 'en_route' && loc.siteLatitude != null && loc.siteLongitude != null) {
      L.polyline([[loc.latitude, loc.longitude],[loc.siteLatitude, loc.siteLongitude]], { color: '#f59e0b', dashArray: '6 4', weight: 2 }).addTo(map);
    }
  });
  if (bounds.length === 1) map.setView(bounds[0], 13);
  else if (bounds.length > 1) map.fitBounds(bounds, { padding: [28, 28] });
  else map.setView([39.5, -98.35], 4);

  if (cfg.enableLiveEvents) {
    try {
      var es = new EventSource(cfg.apiBase + '/api/live-locations/events', { withCredentials: true });
      es.addEventListener('location.ping', function(ev) {
        try {
          var parsed = JSON.parse(ev.data);
          if (!parsed.location) return;
          window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ping', location: parsed.location }));
        } catch (e) {}
      });
      es.onopen = function() {
        window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'live', status: 'open' }));
      };
      es.onerror = function() {
        window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'live', status: 'error' }));
      };
    } catch (e) {}
  }
</script></body></html>`;
}
