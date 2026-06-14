import { Role } from "@src/user/enums/role.enum";

export class AccountDetailsDto {
  account: {
    id: string;
    name: string;
    email: string;
    phone?: string;
    profileImage?: string;
    role: Role;
    accountStatus: string;
    isEmailVerified: boolean;
    createdAt: Date;
  };

  profile: Record<string, any>;

  materials?: Record<string, any>;

  location?: Record<string, any>;

  mediaIds: string[];
}
