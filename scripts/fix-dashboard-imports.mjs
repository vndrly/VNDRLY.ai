import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const p = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../artifacts/vndrly/src/pages/dashboard.tsx",
);
let c = fs.readFileSync(p, "utf8");
c = c.replace(
  /import \{\r?\nimport \{ PILL_IDLE_SRC[^\r\n]+\r?\nimport RolloverButton[^\r\n]+\r?\n  useGetDashboardSummary,/,
  "import {\r\n  useGetDashboardSummary,",
);
if (
  !c.includes(
    '} from "@workspace/api-client-react";\r\nimport RolloverButton',
  ) &&
  !c.includes(
    '} from "@workspace/api-client-react";\nimport RolloverButton',
  )
) {
  c = c.replace(
    '} from "@workspace/api-client-react";',
    '} from "@workspace/api-client-react";\r\nimport RolloverButton from "@/components/rollover-button";\r\nimport { PILL_IDLE_SRC, hoverPillForTone } from "@/lib/pill-button-palette";',
  );
}
fs.writeFileSync(p, c);
console.log("dashboard fixed");
