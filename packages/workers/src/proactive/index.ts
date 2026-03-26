/**
 * Proactive Outreach Module
 *
 * Exports proactive outreach worker and queues.
 */

export {
  PROACTIVE_OUTREACH_QUEUE,
  createProactiveOutreachQueue,
  type ProactiveOutreachJob,
} from './queues.js';

export { ProactiveOutreachWorker } from './worker.js';
