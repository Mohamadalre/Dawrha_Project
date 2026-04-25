import { MailerService } from "@nestjs-modules/mailer";
import { OnWorkerEvent, Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { Job } from "bullmq";



@Processor('mail-queue', {
    concurrency: 10,
    stalledInterval:3000,
    lockDuration:6000
})
export class MailProcessor extends WorkerHost {

    private readonly logger = new Logger('JOBS')
    constructor(
        private readonly mailerService: MailerService) {
        super();
    }
    private handlers: Record<
        string,
        (job: Job) => Promise<any>
    > = {
            'send-otp': this.handleOtp.bind(this),
            'send-reset-link': this.handleReset.bind(this),
        };

    async process(job: Job): Promise<any> {
        this.logger.log(
            `Processing job ${job.id} of type ${job.name}`,
        );

        const handler = this.handlers[job.name];

        if (!handler) {
            this.logger.error(`No handler for job: ${job.name}`);
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
            this.logger.warn(
                `Invalid email ${ job.data.email } → discard,`
            );
            await job.discard();
            throw new Error('Invalid Email');
        }

        this.logger.error(
            `Job ${ job.id } failed: ${ error.message },`
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
        this.logger.warn(`job ${job.id} permanently failed: ${JSON.stringify(errorData)}`);
    }

    @OnWorkerEvent('completed')
    onCompleted(job: Job) {
        this.logger.log(`job ${job.id} has been finished successfully.`)
    }
}

