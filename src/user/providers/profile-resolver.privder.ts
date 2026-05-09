import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { CitizenProfile } from "@src/user/entities/profile/citizen-profile.entity";
import { CollectorProfile } from "@src/user/entities/profile/collector-profile.entity";
import { ExternalPartnerProfile } from "@src/user/entities/profile/external-partner-profile.entity";
import { FactoryProfile } from "@src/user/entities/profile/factory-profile.entity";
import { InstitutionProfile } from "@src/user/entities/profile/institution-profile.entity";
import { Repository } from "typeorm";


@Injectable()
export class ProfileResolver {
    private profileMap = new Map<string, Repository<any>>();

    constructor(
        @InjectRepository(CitizenProfile)
        private citizenRepo: Repository<CitizenProfile>,

        @InjectRepository(FactoryProfile)
        private factoryRepo: Repository<FactoryProfile>,
        @InjectRepository(InstitutionProfile)
        private institutionRepo: Repository<InstitutionProfile>,
        @InjectRepository(ExternalPartnerProfile)
        private externalPartnerRepo: Repository<ExternalPartnerProfile>,
        @InjectRepository(CollectorProfile)
        private collectorRepo: Repository<CollectorProfile>,
    ) {
        this.profileMap.set('CITIZEN', this.citizenRepo);
        this.profileMap.set('FACTORY', this.factoryRepo);
        this.profileMap.set('INSTITUTIONS', this.institutionRepo);
        this.profileMap.set('EXTERNAL_PARTNER', this.externalPartnerRepo);
        this.profileMap.set('COLLECTOR', this.collectorRepo);
    }

    getRepo(role: string) {
        const repo = this.profileMap.get(role);

        if (!repo) {
            throw new Error('No profile repo for this role');
        }

        return repo;
    }
}