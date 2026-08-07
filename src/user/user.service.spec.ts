jest.mock('argon2', () => ({ hash: jest.fn(), verify: jest.fn() }));

import { BadRequestException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { UserService } from './user.service';
import { Role } from './enums/role.enum';

describe('UserService', () => {
  let service: UserService;
  let accountRepo: any;
  let resolver: any;
  let citizenProfileRepo: any;
  let locationRepo: any;
  let provinceRepo: any;
  let userCache: any;
  let cloudinary: any;
  let redis: any;
  let deviceRepo: any;

  beforeEach(() => {
    accountRepo = {
      findOne: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      save: jest.fn((x) => Promise.resolve(x)),
    };
    resolver = { getRepo: jest.fn() };
    citizenProfileRepo = {
      findOne: jest.fn(),
      create: jest.fn((x) => x),
      save: jest.fn((x) => Promise.resolve({ id: 'cp1', ...x })),
    };
    locationRepo = {
      findOne: jest.fn(),
      create: jest.fn((x) => x),
      save: jest.fn((x) => Promise.resolve({ id: 'loc1', ...x })),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    provinceRepo = { findOne: jest.fn(), findAndCount: jest.fn() };
    deviceRepo = { find: jest.fn(), findOne: jest.fn() };
    userCache = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      invalidate: jest.fn().mockResolvedValue(undefined),
    };
    cloudinary = {
      uploadFile: jest.fn(),
      deleteFile: jest.fn().mockResolvedValue(undefined),
    };
    redis = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue('OK'),
      incr: jest.fn().mockResolvedValue(1),
    };
    service = new UserService(
      accountRepo,
      resolver,
      citizenProfileRepo,
      locationRepo,
      provinceRepo,
      deviceRepo,
      userCache,
      cloudinary,
      redis,
    );
    (argon2.hash as jest.Mock).mockReset();
    (argon2.verify as jest.Mock).mockReset();
  });

  describe('changePassword', () => {
    const dto = { currentPassword: 'old', newPassword: 'newpass12', confirmPassword: 'newpass12' };

    it('rejects when confirmation does not match', async () => {
      await expect(
        service.changePassword('u1', { ...dto, confirmPassword: 'different' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects when the current password is wrong', async () => {
      accountRepo.findOne.mockResolvedValue({ id: 'u1', passwordHash: 'hash' });
      (argon2.verify as jest.Mock).mockResolvedValueOnce(false);
      await expect(service.changePassword('u1', dto)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('hashes and stores a valid new password', async () => {
      accountRepo.findOne.mockResolvedValue({ id: 'u1', passwordHash: 'hash' });
      (argon2.verify as jest.Mock)
        .mockResolvedValueOnce(true) // current matches
        .mockResolvedValueOnce(false); // new differs from old
      (argon2.hash as jest.Mock).mockResolvedValue('newhash');

      const res = await service.changePassword('u1', dto);
      expect(accountRepo.update).toHaveBeenCalledWith('u1', { passwordHash: 'newhash' });
      expect(res.message).toContain('successfully');
    });
  });

  describe('getProfile', () => {
    const ADMIN = {
      id: 'a1',
      name: 'Admin',
      email: 'a@x.io',
      phone: '+962700',
      profileImage: 'img.jpg',
      accountStatus: 'ACTIVE',
      role: Role.ADMIN,
      passwordHash: 'secret',
    };

    it('returns a flat card and never leaks the password', async () => {
      accountRepo.findOne.mockResolvedValue(ADMIN);

      const res: any = await service.getProfile('a1', Role.ADMIN);

      expect(res).toEqual({
        accountId: 'a1', // the ACCOUNT id only — the role-profile id is withheld
        name: 'Admin',
        email: 'a@x.io',
        phone: '+962700',
        profileImage: 'img.jpg',
        accountStatus: 'ACTIVE',
        role: Role.ADMIN,
      });
      // The role-profile id must never appear on a self profile.
      expect(res).not.toHaveProperty('profileId');
      // The old shape nested account+profile; the new one is flat and carries
      // no hash under any key.
      expect(JSON.stringify(res)).not.toContain('secret');
      // No role-profile lookup happens at all any more.
      expect(resolver.getRepo).not.toHaveBeenCalled();
    });

    it('returns "" (not null) for missing string fields', async () => {
      accountRepo.findOne.mockResolvedValue({
        id: 'a2', name: 'No Phone', email: 'n@x.io',
        phone: null, profileImage: null, accountStatus: 'ACTIVE', role: Role.CITIZEN,
      });
      resolver.getRepo.mockReturnValue({ findOne: jest.fn().mockResolvedValue(null) });

      const res: any = await service.getProfile('a2', Role.CITIZEN);

      expect(res.accountId).toBe('a2');
      expect(res.phone).toBe('');
      expect(res.profileImage).toBe('');
      expect(res).not.toHaveProperty('profileId');
    });

    it('never exposes the role-profile id, for any role', async () => {
      accountRepo.findOne.mockResolvedValue({ ...ADMIN, role: Role.FACTORY });
      resolver.getRepo.mockReturnValue({ findOne: jest.fn().mockResolvedValue({ id: 'fp9' }) });

      const res: any = await service.getProfile('a1', Role.FACTORY);

      expect(res).not.toHaveProperty('profileId');
      expect(res.accountId).toBe('a1');
    });

    it('serves the cache without touching the database when warm', async () => {
      userCache.get.mockResolvedValue({ accountId: 'cached', name: 'X' });

      const res: any = await service.getProfile('a1', Role.CITIZEN);

      expect(res).toEqual({ accountId: 'cached', name: 'X' });
      expect(accountRepo.findOne).not.toHaveBeenCalled();
    });

    it('caches the freshly built card', async () => {
      accountRepo.findOne.mockResolvedValue(ADMIN);

      await service.getProfile('a1', Role.ADMIN);

      expect(userCache.set).toHaveBeenCalledWith('profile', 'a1', '', expect.objectContaining({
        name: 'Admin',
      }));
    });
  });

  describe('locations (citizen)', () => {
    const dto = { coordinates: [35.9, 31.9], address: 'Amman', descriptionAddress: 'Home', provinceId: 'p1' };

    it('forbids non-citizen roles from adding locations', async () => {
      await expect(service.addLocation('u1', Role.FACTORY, dto as any)).rejects.toMatchObject({
        status: 403,
      });
    });

    it('adds a location for a citizen (creating the profile if needed)', async () => {
      provinceRepo.findOne.mockResolvedValue({ id: 'p1' });
      citizenProfileRepo.findOne.mockResolvedValue(null); // no profile yet → created

      const res = await service.addLocation('u1', Role.CITIZEN, dto as any);

      expect(citizenProfileRepo.save).toHaveBeenCalled(); // profile auto-created
      expect(locationRepo.save).toHaveBeenCalled();
      expect(res.id).toBe('loc1');
    });

    it('rejects an invalid province', async () => {
      provinceRepo.findOne.mockResolvedValue(null);
      await expect(service.addLocation('u1', Role.CITIZEN, dto as any)).rejects.toMatchObject({
        status: 400,
      });
    });

    it('invalidates the locations cache after adding one', async () => {
      // The list is cached; a new location that did not bust the cache would be
      // invisible until the TTL lapsed.
      provinceRepo.findOne.mockResolvedValue({ id: 'p1' });
      citizenProfileRepo.findOne.mockResolvedValue({ id: 'cp1' });

      await service.addLocation('u1', Role.CITIZEN, dto as any);

      expect(userCache.invalidate).toHaveBeenCalledWith('u1', 'locations');
    });

    it('invalidates the locations cache after removing one', async () => {
      locationRepo.findOne.mockResolvedValue({
        id: 'loc1',
        cititzenProfile: { account: { id: 'u1' } },
      });

      await service.removeLocation('u1', Role.CITIZEN, 'loc1');

      expect(locationRepo.delete).toHaveBeenCalledWith('loc1');
      expect(userCache.invalidate).toHaveBeenCalledWith('u1', 'locations');
    });
  });

  describe('listLocations (paginated + cached, with province name)', () => {
    it('serves the cached page without touching the database', async () => {
      userCache.get.mockResolvedValueOnce({ locations: [], pagination: {} });

      const res: any = await service.listLocations('u1', Role.CITIZEN, 1, 20);

      expect(res).toEqual({ locations: [], pagination: {} });
      expect(citizenProfileRepo.findOne).not.toHaveBeenCalled();
    });

    it('returns each location WITH its province name, paginated, and caches it', async () => {
      citizenProfileRepo.findOne.mockResolvedValue({ id: 'cp1' });
      locationRepo.findAndCount = jest.fn().mockResolvedValue([
        [
          {
            id: 'loc1',
            address: 'Amman',
            DesscriptLocation: 'Home',
            coordinates: { coordinates: [35.9, 31.9] },
            province: { id: 'p1', name_en: 'Amman', name_ar: 'عمّان' },
          },
        ],
        1,
      ]);

      const res: any = await service.listLocations('u1', Role.CITIZEN, 1, 20);

      expect(res.locations[0].province).toEqual({
        id: 'p1',
        name_en: 'Amman',
        name_ar: 'عمّان',
      });
      expect(res.pagination.total_count).toBe(1);
      expect(userCache.set).toHaveBeenCalledWith('locations', 'u1', '1:20', res);
    });

    it('forbids a non-citizen', async () => {
      await expect(
        service.listLocations('u1', Role.FACTORY, 1, 20),
      ).rejects.toMatchObject({ status: 403 });
    });
  });

  describe('profile edit + image', () => {
    const CLOUD_URL =
      'https://res.cloudinary.com/x/image/upload/v1/folder/pic.jpg';

    it('does NOT edit the image through the profile update', async () => {
      accountRepo.findOne.mockResolvedValue({
        id: 'u1', accountStatus: 'ACTIVE', name: 'A', phone: '963931234567',
        profileImage: 'old.jpg',
      });

      // Even if a rogue caller smuggles profileImage past the DTO, the service
      // ignores it — the image is owned by the image routes.
      await service.updateProfile('u1', { name: 'B', profileImage: 'new.jpg' } as any);

      const saved = accountRepo.save.mock.calls[0][0];
      expect(saved.profileImage).toBe('old.jpg'); // untouched
      expect(saved.name).toBe('B');
    });

    it('re-checks phone uniqueness on edit (same guard as add)', async () => {
      accountRepo.findOne
        .mockResolvedValueOnce({ id: 'u1', accountStatus: 'ACTIVE', phone: '963930000000' }) // findById
        .mockResolvedValueOnce({ id: 'other', phone: '963931234567' }); // assertPhoneAvailable → taken

      await expect(
        service.updateProfile('u1', { phone: '963931234567' } as any),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('deletes the Cloudinary asset BEFORE clearing the DB row', async () => {
      const calls: string[] = [];
      accountRepo.findOne.mockResolvedValue({ id: 'u1', accountStatus: 'ACTIVE', profileImage: CLOUD_URL });
      cloudinary.deleteFile.mockImplementation(async () => { calls.push('cloud'); });
      accountRepo.save.mockImplementation(async (a: any) => { calls.push('db'); return a; });

      const res: any = await service.deleteProfileImage('u1');

      expect(calls).toEqual(['cloud', 'db']); // cloud first, then DB
      expect(res.result.profileImage).toBe(''); // empty, not null
    });

    it('aborts the delete (DB untouched) when the cloud delete fails', async () => {
      accountRepo.findOne.mockResolvedValue({ id: 'u1', accountStatus: 'ACTIVE', profileImage: CLOUD_URL });
      cloudinary.deleteFile.mockRejectedValue(new Error('cloud down'));

      await expect(service.deleteProfileImage('u1')).rejects.toThrow();
      expect(accountRepo.save).not.toHaveBeenCalled();
    });

    it('replacing an image cleans up the OLD cloud asset', async () => {
      accountRepo.findOne.mockResolvedValue({ id: 'u1', accountStatus: 'ACTIVE', profileImage: CLOUD_URL });
      cloudinary.uploadFile.mockResolvedValue({ imageUrl: 'https://res.cloudinary.com/x/image/upload/v1/folder/new.jpg' });
      cloudinary.deleteFile.mockResolvedValue(undefined);

      await service.setProfileImage('u1', {} as any, Role.CITIZEN);

      expect(cloudinary.deleteFile).toHaveBeenCalledWith('folder/pic'); // old asset removed
    });
  });

  describe('active sessions', () => {
    it('lists only LIVE sessions (drops logged-out devices) and hides the refresh token', async () => {
      deviceRepo.find.mockResolvedValue([
        { id: 'd1', deviceId: 'phone-1', deviceType: 'ANDROID', language: 'ar', lastLogin: new Date(), createdAt: new Date(), refreshToken: 'hash' },
        { id: 'd2', deviceId: 'phone-2', deviceType: 'IOS', language: 'en', lastLogin: new Date(), createdAt: new Date(), refreshToken: '' }, // logged out
      ]);

      const res: any = await service.listActiveSessions('u1');

      expect(res.count).toBe(1);
      expect(res.sessions[0].id).toBe('d1');
      expect(res.sessions[0]).not.toHaveProperty('refreshToken');
      expect(res.sessions[0]).not.toHaveProperty('refresh_token');
      expect(userCache.set).toHaveBeenCalledWith('sessions', 'u1', '', res);
    });

    it('serves the cached session list', async () => {
      userCache.get.mockResolvedValueOnce({ sessions: [], count: 0 });
      const res: any = await service.listActiveSessions('u1');
      expect(res).toEqual({ sessions: [], count: 0 });
      expect(deviceRepo.find).not.toHaveBeenCalled();
    });
  });

  describe('app settings', () => {
    it('returns the most-recent device language and the available list', async () => {
      deviceRepo.findOne.mockResolvedValue({ language: 'ar' });
      const res: any = await service.getAppSettings('u1', 'en');
      expect(res.language).toBe('ar');
      expect(res.available_languages).toEqual(['en', 'ar']);
    });

    it('falls back to the request language when no device is recorded', async () => {
      deviceRepo.findOne.mockResolvedValue(null);
      const res: any = await service.getAppSettings('u1', 'ar');
      expect(res.language).toBe('ar');
    });
  });

  describe('listProvinces (global cache, id + both names)', () => {
    it('serves the cached page without hitting the database', async () => {
      redis.get
        .mockResolvedValueOnce('3') // version
        .mockResolvedValueOnce(JSON.stringify({ provinces: [{ id: 'p1' }], pagination: {} }));

      const res: any = await service.listProvinces(1, 20);

      expect(res.provinces[0].id).toBe('p1');
      expect(provinceRepo.findAndCount).not.toHaveBeenCalled();
    });

    it('reads through and returns id + both-language names, then caches', async () => {
      redis.get.mockResolvedValue(null); // no cache, version defaults to 0
      provinceRepo.findAndCount.mockResolvedValue([
        [{ id: 'p1', name_en: 'Amman', name_ar: 'عمّان' }],
        1,
      ]);

      const res: any = await service.listProvinces(1, 20);

      expect(res.provinces).toEqual([{ id: 'p1', name_en: 'Amman', name_ar: 'عمّان' }]);
      expect(res.pagination.total_count).toBe(1);
      expect(redis.set).toHaveBeenCalled();
    });
  });

  describe('getLocationById (ownership-checked, cached)', () => {
    it('returns another account’s location as not-found, never its address', async () => {
      locationRepo.findOne.mockResolvedValue({
        id: 'loc1',
        province: { id: 'p1', name_en: 'Amman', name_ar: 'عمّان' },
        cititzenProfile: { account: { id: 'someone-else' } },
      });

      await expect(
        service.getLocationById('u1', Role.CITIZEN, 'loc1'),
      ).rejects.toMatchObject({ status: 403 });
    });

    it('returns the location with province name and caches it', async () => {
      locationRepo.findOne.mockResolvedValue({
        id: 'loc1',
        address: 'Amman',
        DesscriptLocation: 'Home',
        coordinates: { coordinates: [35.9, 31.9] },
        province: { id: 'p1', name_en: 'Amman', name_ar: 'عمّان' },
        cititzenProfile: { account: { id: 'u1' } },
      });

      const res: any = await service.getLocationById('u1', Role.CITIZEN, 'loc1');

      expect(res.id).toBe('loc1');
      expect(res.province.name_ar).toBe('عمّان');
      expect(userCache.set).toHaveBeenCalledWith('location', 'u1', 'loc1', res);
    });
  });
});
