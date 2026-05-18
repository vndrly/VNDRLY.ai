// Thin wrapper around JSZip so the rest of the report code doesn't depend
// directly on the library — easier to swap later if we need streaming.

import JSZip from "jszip";

export interface ZipFileEntry {
  name: string;
  content: string | Buffer;
}

export async function buildZip(entries: ZipFileEntry[]): Promise<Buffer> {
  const zip = new JSZip();
  for (const e of entries) {
    zip.file(e.name, e.content);
  }
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
