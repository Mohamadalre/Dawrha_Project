import { NotFoundException } from '@nestjs/common';
import { UserService } from './user.service';
import { Language } from '@src/common/enums/language.enum';

/**
 * Setting the account language. Once saved it is the source of truth for every
 * response and for the settings screen.
 */
describe('UserService.setLanguage', () => {
  const build = (account: any) => {
    const accountRepository = {
      findOne: jest.fn().mockResolvedValue(account),
      save: jest.fn(async (a: any) => a),
    };
    // Only accountRepository is used by setLanguage / getAppSettings.
    const svc = new UserService(
      accountRepository as any, null as any, null as any, null as any,
      null as any, null as any, null as any, null as any, null as any,
    );
    return { svc, accountRepository };
  };

  it('saves the chosen language', async () => {
    const account: any = { id: 'a-1', language: Language.EN };
    const { svc, accountRepository } = build(account);

    const res: any = await svc.setLanguage('a-1', Language.AR);

    expect(res.result.language).toBe(Language.AR);
    expect(accountRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ language: Language.AR }),
    );
  });

  it('404s an unknown account', async () => {
    const { svc } = build(null);
    await expect(svc.setLanguage('nope', Language.AR)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('getAppSettings returns the saved language', async () => {
    const { svc } = build({ id: 'a-1', language: Language.AR });
    const res: any = await svc.getAppSettings('a-1');
    expect(res.language).toBe(Language.AR);
    expect(res.available_languages).toEqual([Language.EN, Language.AR]);
  });
});
