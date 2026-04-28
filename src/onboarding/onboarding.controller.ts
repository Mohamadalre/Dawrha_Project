import { Controller, UseGuards } from '@nestjs/common';
import { OnboardingService } from './onboarding.service';
import { OnboardingAuthGuard } from './gurads/onboarding-auth.guard';


@Controller({
  path: 'onboarding',
  version: '1'
})
@UseGuards (OnboardingAuthGuard)
export class OnboardingController {
  constructor(private readonly onboardingService: OnboardingService) {}
}
