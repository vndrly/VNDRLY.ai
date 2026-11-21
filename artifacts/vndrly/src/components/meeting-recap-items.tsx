type Item = { id?: string; text: string; status?: string; owner?: string | null; due?: string | null };
export function MeetingRecapItems({ value }: { value: unknown }) {
  const items: Item[] = Array.isArray(value) ? value.flatMap(item => typeof item === "string" ? [{text:item}] : item && typeof item === "object" && typeof item.text === "string" ? [item] : []) : [];
  if (!items.length) return <p>No items yet.</p>;
  return <ul className="meeting-recap-items" aria-live="polite">{items.map((item,index) => <li key={item.id ?? index}><span>{item.status ? `${item.status.charAt(0).toUpperCase()}${item.status.slice(1)} · ` : ""}{item.text}</span>{(item.owner || item.due) && <small>{[item.owner,item.due].filter(Boolean).join(" · ")}</small>}</li>)}</ul>;
}
