import { MailerService } from "@nestjs-modules/mailer";
import { OnWorkerEvent, Processor, WorkerHost } from "@nestjs/bullmq";
import { Job } from "bullmq";
import { winstonLogger } from "@src/core/logger-config/winston.config";
import {
  MAIL_QUEUE_NAME,
  MAIL_SEND_OTP_JOB_NAME,
  MAIL_SEND_RESET_LINK_JOB_NAME,
} from '../queues/mail.queue';

@Processor(MAIL_QUEUE_NAME, {
    concurrency: 10,
    stalledInterval:3000,
    lockDuration:6000
})
export class MailProcessor extends WorkerHost {

    constructor(
        private readonly mailerService: MailerService) {
        super();
    }
    private handlers: Record<
        string,
        (job: Job) => Promise<any>
    > = {
            [MAIL_SEND_OTP_JOB_NAME]: this.handleOtp.bind(this),
            [MAIL_SEND_RESET_LINK_JOB_NAME]: this.handleReset.bind(this),
        };

    async process(job: Job): Promise<any> {
        winstonLogger.log('info', 
            `Processing job ${job.id} of type ${job.name}`,
            { channel: 'jobs' }
        );

        const handler = this.handlers[job.name];

        if (!handler) {
            winstonLogger.error(`No handler for job: ${job.name}`, { channel: 'jobs' });
            throw new Error(`Unknown job type: ${job.name}`);
        }

        try {
            return await handler(job);
        } catch (error) {
            return this.handleError(job, error);
        }
    }

    private async handleOtp(job: Job) {
        const { email, otp } = job.data;

        await this.mailerService.sendMail({
            to: email,
            subject: 'Verification Code - Dawrha App',
            template: 'otp',
            context: { otp }
        });
    
        

        return { status: 'otp_sent' };
    }

    private async handleReset(job: Job) {
        const { email, link } = job.data;

        await this.mailerService.sendMail({
            to: email,
            subject: 'Reset Password - Dawrha App',
            template: 'reset-password',
            context: { link },
        });

        return { status: 'reset_link_sent' };
    }

    private async handleError(job: Job, error: any) {
        if (error.response?.code === 'EENVELOPE') {
            winstonLogger.warn(
                `Invalid email ${ job.data.email } → discard,`,
                { channel: 'jobs' }
            );
            // eslint-disable-next-line @typescript-eslint/await-thenable
            await job.discard();
            throw new Error('Invalid Email');
        }

        winstonLogger.error(
            `Job ${ job.id } failed: ${ error.message },`,
            { channel: 'jobs' }
        );

        throw error;
    }

    /**Logger Events */
    @OnWorkerEvent('failed')
    onFailed(job: Job, error: Error) {
        const errorData = {
            jobId: job.id,
            jobName: job.name,
            email: job.data.email,
            attemptsMade: job.attemptsMade,
            reason: error.message
        };
        winstonLogger.warn(`job ${job.id} permanently failed: ${JSON.stringify(errorData)}`, { channel: 'jobs' });
    }

    @OnWorkerEvent('completed')
    onCompleted(job: Job) {
        winstonLogger.log('info', `job ${job.id} has been finished successfully.`, { channel: 'jobs' });
    }
}

