import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { ONBOARDING_STEPS } from "@src/onboarding/config/onboarding.config";
import { AccountProgress } from "@src/onboarding/entities/account-progress.entity";
import { Account } from "@src/user/entities/account.entity";
import { Repository } from "typeorm";


@Injectable() 
export class CommonService{
    constructor(
        @InjectRepository(AccountProgress)
        private readonly progressRepo:Repository<AccountProgress> 
    ){}
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

}