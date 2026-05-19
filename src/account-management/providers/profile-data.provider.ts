import { Injectable } from '@nestjs/common';
import { Role } from '@src/user/enums/role.enum';

@Injectable()
export class ProfileDataProvider {
  private relationsMap = new Map<Role, string[]>();
  private materialMap = new Map<Role, string>();

  constructor() {
    this.relationsMap.set(Role.FACTORY, ['account', 'factoryMaterial', 'factoryMaterial.wasteTypes', 'factoryMaterial.wasteTypes.wasteType']);
    this.relationsMap.set(Role.INSTITUTIONS, ['account', 'materialInputs', 'materialInputs.wasteTypes', 'materialInputs.wasteTypes.wasteType', 'institutionType']);
    this.relationsMap.set(Role.EXTERNAL_PARTNER, ['account', 'externalPartnerMaterial', 'externalPartnerMaterial.wasteTypes', 'externalPartnerMaterial.wasteTypes.wasteType']);
    this.relationsMap.set(Role.COLLECTOR, ['account']);

    this.materialMap.set(Role.FACTORY, 'factoryMaterial');
    this.materialMap.set(Role.INSTITUTIONS, 'materialInputs');
    this.materialMap.set(Role.EXTERNAL_PARTNER, 'externalPartnerMaterial');
  }

  getRelations(role: Role): string[] {
    return this.relationsMap.get(role) ?? ['account'];
  }

  getMaterialKey(role: Role): string | undefined {
    return this.materialMap.get(role);
  }
}
