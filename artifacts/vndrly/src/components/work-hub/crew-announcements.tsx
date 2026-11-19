import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { commandEnvelope, workHubRequest, type WorkHubOwner } from "@/lib/work-hub-client";
import { ProfileActionButton } from "@/components/gate-profile-chrome";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { BrandedSelect } from "./chrome";
import type { WorkCrew } from "./work-crews";
type Row=Record<string,any>;
function Notice({error}:{error:unknown}) { return error ? <p role="alert">{error instanceof Error?error.message:String(error)}</p> : null; }
export function CrewAnnouncements({owner,crews}:{owner:WorkHubOwner;crews:WorkCrew[]}) {
  const qc = useQueryClient();
  const crewQuery = {data:{crews}};
  const {data} = useQuery<Record<string, any>>({queryKey:["work-hub","admin",owner.type,owner.id],queryFn:()=>workHubRequest("/admin"),retry:false});
  const [announcement, setAnnouncement] = useState({
    title: "",
    body: "",
    crewId: "",
    acknowledgementRequired: true,
    urgency: "normal",
  });
  const publish = useMutation({
    mutationFn: () =>
      workHubRequest(`/work-crews/${announcement.crewId}/announcements`, {
        method: "POST",
        body: JSON.stringify(
          commandEnvelope(owner!, {
            title: announcement.title,
            body: announcement.body,
            urgency: announcement.urgency,
            acknowledgementRequired: announcement.acknowledgementRequired,
          }),
        ),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["work-hub", "admin"] }),
  });
  const acknowledge = useMutation({
    mutationFn: (id: string) =>
      workHubRequest(`/announcements/${id}/acknowledge`, {
        method: "POST",
        body: "{}",
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["work-hub", "admin"] }),
  });
  return <div className="grid gap-3">
          <form
            className="grid gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              publish.mutate();
            }}
          >
            <Input
              aria-label="Announcement title"
              value={announcement.title}
              onChange={(e) =>
                setAnnouncement({ ...announcement, title: e.target.value })
              }
              placeholder="Announcement title"
              required
            />
            <Textarea
              aria-label="Announcement body"
              value={announcement.body}
              onChange={(e) =>
                setAnnouncement({ ...announcement, body: e.target.value })
              }
              placeholder="Operational announcement"
              required
            />
            <label className="grid gap-1 text-sm">Crew
              <BrandedSelect aria-label="Announcement crew" style={{colorScheme:"dark"}} value={announcement.crewId} onChange={event=>setAnnouncement({...announcement,crewId:event.target.value})} required>
                <option value="">Choose a work crew</option>
                {(crewQuery.data?.crews??[]).filter(crew=>!crew.expired).map(crew=><option key={crew.id} value={crew.id}>{crew.name}</option>)}
              </BrandedSelect>
            </label>
            <label className="grid gap-1 text-sm">Announcement priority
              <BrandedSelect aria-label="Announcement priority" style={{colorScheme:"dark"}} value={announcement.urgency} onChange={(e) => setAnnouncement({ ...announcement, urgency: e.target.value })}><option value="normal">Normal</option><option value="urgent">Urgent — notify recipients</option></BrandedSelect>
            </label>
            <label className="flex gap-2 text-sm">
              <input
                type="checkbox"
                checked={announcement.acknowledgementRequired}
                onChange={(e) =>
                  setAnnouncement({
                    ...announcement,
                    acknowledgementRequired: e.target.checked,
                  })
                }
              />
              Require acknowledgement
            </label>
            <ProfileActionButton type="submit" color="brand" disabled={!owner || !announcement.crewId || publish.isPending}>
              Send announcement
            </ProfileActionButton>
          </form>
          <Notice error={publish.error ?? acknowledge.error} />
          {data?.announcements?.filter((row: Row) => row.workCrewId).map((row: Row) => (
            <article key={row.id} className="rounded-lg border p-3">
              <strong>{row.title}</strong>
              <p className="text-sm text-muted-foreground">{row.body}</p>
              {row.acknowledgementRequired && (
                <ProfileActionButton
                  className="mt-2"
                  color="brand"
                  onClick={() => acknowledge.mutate(row.id)}
                >
                  Acknowledge
                </ProfileActionButton>
              )}
            </article>
          ))}
  </div>;
}
