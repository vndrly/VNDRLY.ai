export function noteMessageBody(name: string, documentId: string) {
  return `Saved note: ${name}\n/api/work-hub/file-library/${documentId}/download`;
}

/** Only recognize our authenticated file route; never render arbitrary message HTML. */
export function NoteMessage({ body }: { body: string }) {
  const receipt = /^Receipt: ([^\n]+)\n(\/work-hub\/chat\?channel=[a-f0-9-]{36}&receipt=[a-f0-9-]{36})$/.exec(body);
  if (receipt) return <a className="font-medium underline underline-offset-2" href={receipt[2]}>Receipt · {receipt[1]}</a>;
  const match = /^Saved note: ([^\n]+)\n(\/api\/work-hub\/file-library\/[a-f0-9-]{36}\/download)$/.exec(body);
  return match ? <a className="font-medium underline underline-offset-2" href={match[2]}>{match[1]}</a> : <>{body}</>;
}
