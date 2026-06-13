import { Queue } from 'bullmq';
import { bullConnection } from './connection';

// Jobs are never consumed — any enqueue triggers an alert for manual investigation.
export const deadLetterQueue = new Queue('dead-letter', { connection: bullConnection });
