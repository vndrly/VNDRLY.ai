import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { format } from "prettier";
import { retryGeneratedWrite } from "./generated-file-write.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
async function formatDirectory(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort(
    (a, b) => a.name.localeCompare(b.name),
  )) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await formatDirectory(path);
    else if (entry.name.endsWith(".ts")) {
      const source = readFileSync(path, "utf8");
      const formatted = await format(source, { filepath: path });
      if (formatted !== source)
        retryGeneratedWrite(() => writeFileSync(path, formatted));
    }
  }
}
await formatDirectory(join(root, "api-client-react", "src", "generated"));
await formatDirectory(join(root, "api-zod", "src", "generated"));
