import { Queue, Worker, type JobsOptions, type Job, type Processor } from 'bullmq';
import { getRedisClient, createDedicatedRedisClient } from './index.js';

export { Worker, Job, type Processor };
export const EMAIL_QUEUE_NAME = 'emails';

let globalEmailQueue: Queue | null = null;

export function getEmailQueue(): Queue {
  if (!globalEmailQueue) {
    const prefix = process.env.BULLMQ_PREFIX || 'reachinbox';
    globalEmailQueue = new Queue(EMAIL_QUEUE_NAME, {
      connection: getRedisClient(),
      prefix,
    });
  }

  return globalEmailQueue;
}

export interface EnqueueEmailJobParams {
  emailId: string;
  senderId: string;
  userId: string;
  recipientEmail: string;
  subject: string;
  scheduledAt: Date;
}

/**
 * Enqueues a delayed job in BullMQ with a deterministic jobId matching emailId (BE-05, BE-07)
 */
export async function enqueueEmailJob(
  params: EnqueueEmailJobParams,
): Promise<{ jobId: string; delay: number }> {
  const queue = getEmailQueue();
  const delay = Math.max(0, params.scheduledAt.getTime() - Date.now());

  const jobOpts: JobsOptions = {
    jobId: params.emailId, // Deterministic Job ID derived from email UUID
    delay,
    removeOnComplete: false,
    removeOnFail: false,
  };

  const job = await queue.add(
    'send-email',
    {
      emailId: params.emailId,
      senderId: params.senderId,
      userId: params.userId,
      recipientEmail: params.recipientEmail,
      subject: params.subject,
      scheduledAt: params.scheduledAt.toISOString(),
    },
    jobOpts,
  );

  return {
    jobId: job.id as string,
    delay,
  };
}

/**
 * Enqueues a batch of delayed jobs using BullMQ addBulk for performance (BE-03, BE-07)
 */
export async function enqueueEmailJobsBatch(
  jobs: EnqueueEmailJobParams[],
): Promise<Array<{ jobId: string; delay: number }>> {
  const queue = getEmailQueue();
  const now = Date.now();

  const bulkJobs = jobs.map((param) => {
    const delay = Math.max(0, param.scheduledAt.getTime() - now);
    return {
      name: 'send-email',
      data: {
        emailId: param.emailId,
        senderId: param.senderId,
        userId: param.userId,
        recipientEmail: param.recipientEmail,
        subject: param.subject,
        scheduledAt: param.scheduledAt.toISOString(),
      },
      opts: {
        jobId: param.emailId, // Deterministic Job ID
        delay,
        removeOnComplete: false,
        removeOnFail: false,
      },
    };
  });

  const addedJobs = await queue.addBulk(bulkJobs);
  return addedJobs.map((j, idx) => ({
    jobId: j.id as string,
    delay: bulkJobs[idx].opts.delay,
  }));
}

export async function closeQueue(): Promise<void> {
  if (globalEmailQueue) {
    await globalEmailQueue.close();
    globalEmailQueue = null;
  }
}

export interface CreateWorkerOptions {
  concurrency?: number;
}

/**
 * Creates and initializes a BullMQ Worker instance for email job execution (BE-11, RATE-01)
 */
export function createEmailWorker(processor: Processor, options?: CreateWorkerOptions): Worker {
  const prefix = process.env.BULLMQ_PREFIX || 'reachinbox';
  const connection = createDedicatedRedisClient();

  return new Worker(EMAIL_QUEUE_NAME, processor, {
    connection,
    concurrency: options?.concurrency || 5,
    prefix,
  });
}
