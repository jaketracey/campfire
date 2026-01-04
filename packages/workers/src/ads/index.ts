/**
 * Ads Module
 *
 * Exports ad spend sync and LTV calculation workers and queues.
 */

export {
  AD_SPEND_SYNC_QUEUE,
  LTV_CALCULATION_QUEUE,
  createAdSpendSyncQueue,
  createLtvCalculationQueue,
  type AdSpendSyncJob,
  type LtvCalculationJob,
} from './queues.js';

export { AdSpendSyncWorker } from './spend-sync-worker.js';
export { LtvCalculationWorker } from './ltv-worker.js';
