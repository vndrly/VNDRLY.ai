import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Pure provider-serialization tests: none imports a database or starts an app.
// Keep the database test setup out of this narrow contract-only runner.
export default {
  root: path.resolve(fileURLToPath(new URL('..', import.meta.url)), 'artifacts/api-server'),
  test: { environment: 'node', include: ['src/assistant/tool-registry.test.ts', 'src/assistant/realtime-session.test.ts', 'src/assistant/tool-packs.test.ts'] },
};
