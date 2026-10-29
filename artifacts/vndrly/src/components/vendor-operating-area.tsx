import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MapPin, Check, X } from "lucide-react";
import { hotlistApi } from "@/lib/hotlist-api";
import { Popover, PopoverTrigger, PopoverContent } from "./ui/popover";
import { Input } from "./ui/input";
import { useToast } from "@/hooks/use-toast";

export default function VendorOperatingArea({ vendorId, canEdit }: { vendorId: number; canEdit: boolean }) {
  const cache = useQueryClient(), { toast } = useToast();
  const key = ["hotlist", "operating-area", vendorId];
  const { data: area } = useQuery({ queryKey: key, queryFn: () => hotlistApi.getOperatingArea(vendorId), enabled: !!vendorId });
  const [open, setOpen] = useState(false), [radius, setRadius] = useState("");
  const [currentLocation, setCurrentLocation] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState("");
  const generation = useRef(0);
  const changeOpen = (value: boolean) => {
    generation.current++;
    if (value) { setRadius(area?.operatingRadiusMiles == null ? "" : String(area.operatingRadiusMiles)); setCurrentLocation(false); setError(""); }
    setSaving(false); setOpen(value);
  };
  const save = async () => {
    const miles = radius.trim() === "" ? null : Number(radius);
    if (miles !== null && (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(radius.trim()) || !Number.isFinite(miles) || miles < 0 || miles > 5000)) { setError("Enter a radius between 0 and 5,000 miles."); return; }
    const attempt = generation.current;
    setSaving(true); setError("");
    try {
      let location: { latitude: number; longitude: number } | undefined;
      if (currentLocation) {
        if (!navigator.geolocation) throw new Error("Current location is unavailable on this device.");
        const position = await new Promise<GeolocationPosition>((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, () => reject(new Error("Could not get your location. Allow location access or uncheck Use my current location.")), { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }));
        location = { latitude: position.coords.latitude, longitude: position.coords.longitude };
      }
      if (generation.current !== attempt) return;
      const result = await hotlistApi.setOperatingArea(vendorId, { operatingRadiusMiles: miles, ...(location ? { currentLocation: location } : {}) });
      void cache.invalidateQueries({ queryKey: key }); void cache.invalidateQueries({ queryKey: ["hotlist", "list"] });
      if (generation.current !== attempt) return;
      if (result.geocodeWarning) toast({ title: "Saved, but address could not be geocoded", description: result.geocodeWarning, variant: "destructive" });
      else toast({ title: "Operating area saved" });
      changeOpen(false);
    } catch (e) { if (generation.current === attempt) setError(e instanceof Error ? e.message : "Could not save operating area."); }
    finally { if (generation.current === attempt) setSaving(false); }
  };
  const summary = area?.operatingRadiusMiles != null ? `${area.operatingRadiusMiles} miles` : "Not set";
  return <div className="vendor-operating-radius-control" data-testid="operating-area-section">
    <div className="vendor-operating-radius-label">Operating Radius</div>
    {canEdit ? <Popover open={open} onOpenChange={changeOpen}>
      <PopoverTrigger asChild><button type="button" className="vendor-radius-mini-card" data-testid="button-edit-operating-area"><MapPin aria-hidden="true" className="h-4 w-4" /><span><strong data-testid="text-operating-radius">{summary}</strong></span></button></PopoverTrigger>
      <PopoverContent align="start" sideOffset={8} collisionPadding={12} className="vendor-radius-flyout" aria-label="Set operating radius">
        <h3>Operating Radius</h3>
        <form onSubmit={event => { event.preventDefault(); void save(); }}>
          <label htmlFor={`radius-${vendorId}`}>Radius (miles)</label>
          <Input id={`radius-${vendorId}`} type="text" inputMode="decimal" value={radius} onChange={event => setRadius(event.target.value)} data-testid="input-operating-radius" />
          <p>Sets the distance used to find nearby Hotlist jobs. Uses your saved operating center unless you select your current location.</p>
          <label className="vendor-radius-location"><input type="checkbox" checked={currentLocation} onChange={event => setCurrentLocation(event.target.checked)} />Use my current location</label>
          {error && <p role="alert">{error}</p>}
          <div className="vendor-radius-actions"><button type="submit" className="vendor-mini-card-button" disabled={saving} data-testid="button-save-operating-area"><Check className="h-4 w-4" />{saving ? "Saving…" : "Save"}</button><button type="button" className="vendor-mini-card-button" onClick={() => changeOpen(false)} data-testid="button-cancel-operating-area"><X className="h-4 w-4" />Cancel</button></div>
        </form>
      </PopoverContent>
    </Popover> : <div><strong className="block" data-testid="text-operating-radius">{summary}</strong></div>}
  </div>;
}
