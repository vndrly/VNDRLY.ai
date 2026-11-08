import { runWithTrainingWorkerDatabase } from '@workspace/db';
import { buildStoredTrainingProjections } from '../work-hub/stored-training-projections';

/** Prepare real worker snapshots before exercising the ordinary read path. */
export async function prepareTrainingProjections(work: () => Promise<unknown>) {
  if (process.env.VNDRLY_TEST_DB_MODE !== 'fresh-local' ||
      new URL(process.env.DATABASE_URL!).hostname !== '127.0.0.1') {
    throw new Error('Training projection fixtures require a fresh isolated database');
  }
  await runWithTrainingWorkerDatabase(() => buildStoredTrainingProjections(work));
}
