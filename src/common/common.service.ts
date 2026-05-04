import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { ONBOARDING_STEPS } from "@src/onboarding/config/onboarding.config";
import { AccountProgress } from "@src/onboarding/entities/account-progress.entity";
import { Account } from "@src/user/entities/account.entity";
import { Repository } from "typeorm";


@Injectable()
export class CommonService {
  constructor(
    @InjectRepository(AccountProgress)
    private readonly progressRepo: Repository<AccountProgress>
  ) { }
  async getCurrentStep(account: Account) {
    const steps = ONBOARDING_STEPS[account.role] || [];

    if (!steps.length) return null;

    const progress = await this.progressRepo.findOne({
      where: { accountId: account.id },
    });


    if (!progress) {
      return steps[0] || null;
    }

    const nextStep = steps.find(
      (step) => !progress.completedSteps.includes(step),
    );

    return nextStep || null;
  }


  async completeStep(account: Account, stepInp: string) {
    const steps = ONBOARDING_STEPS[account.role] || [];

    let progress = await this.progressRepo.findOne({
      where: { accountId: account.id },
    });

    if (!progress) {
      let newprog = this.progressRepo.create({
        account: account,
        accountId: account.id,
        completedSteps: []
      });

      if (stepInp === steps[0]) {
        newprog.completedSteps.push(stepInp);
      }

      await this.progressRepo.save(newprog);
      return steps[0];
    }

    progress.completedSteps = progress.completedSteps || [];

    const nextStep = steps.find(
      (step) => !progress.completedSteps.includes(step),
    );

    if (nextStep === stepInp) {
      progress.completedSteps.push(stepInp);
    }

    await this.progressRepo.save(progress);

    return nextStep;
  }

}