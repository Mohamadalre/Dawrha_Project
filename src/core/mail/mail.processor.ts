import { MailerService } from "@nestjs-modules/mailer";
import { OnWorkerEvent, Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { Job } from "bullmq";



@Processor('mail-queue', {
    concurrency: 5
})
export class MailProcessor extends WorkerHost {

    private readonly logger = new Logger('JOBS')
    constructor(
        private readonly mailerService: MailerService) {
        super();
    }
    async process(job: Job<any, any, string>): Promise<any> {
        const { email, otp } = job.data;

        this.logger.log(`Processing job ${job.id} for email: ${email}`);
        try {

            await this.mailerService.sendMail({
                to: email,
                subject: 'Verification Code - Dawrha App',
                template: 'otp',
                context: { otp }
            });


        }

        catch (error) {
            if (error.response && error.response.code === 'EENVELOPE') {
                this.logger.warn(`Unrecoverable Error:Invalid email address ${job.data.emai}.Job discarded.`)
                await job.discard()
                throw new Error('Unrecoverable Error :Invalid Email')
            }
            this.logger.error(`Failed to process job ${job.id}:${error.message}`)
            throw error;
        }

        return { status: 'completed' }
    }

    /**Logger Events */
    @OnWorkerEvent('failed')
    onFailed(job: Job, error: Error) {
        const errorData = {
            jobId: job.id,
            jobName:job.name,
            email:job.data.email,
            attemptsMade:job.attemptsMade,
            reason:error.message
        };
        this.logger.warn(`job ${job.id} permanently failed: ${JSON.stringify(errorData)}`);
    }
    
    @OnWorkerEvent('completed')
    onCompleted(job:Job){
        this.logger.log(`job ${job.id} has been finished successfully.`)
    }
}

