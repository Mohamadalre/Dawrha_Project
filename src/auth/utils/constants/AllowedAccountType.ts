export const AllowedAccountType:Record<string,string[]> = {
  'user_app': ['CITIZEN', 'INSTITUTIONS'],
  'collector_app': ['COLLECTOR'],
  'factory_app': ['FACTORY', 'EXTERNAL_PARTNER'],
  'admin': ['ADMIN'],
};

export type AppType = keyof typeof AllowedAccountType;