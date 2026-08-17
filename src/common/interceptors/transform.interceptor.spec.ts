import { I18nContext } from 'nestjs-i18n';
import { translateMessage } from './transform.interceptor';

/**
 * The account's saved language drives the response. `translateMessage` takes an
 * explicit language override (resolved from the signed-in account) that wins
 * over the language the header/query resolvers picked — so a user who chose
 * Arabic in settings gets Arabic without ever sending a header.
 */
describe('translateMessage — account language override', () => {
  const fakeI18n = {
    lang: 'en', // what the header resolver picked
    t: (key: string, opts?: { lang?: string }) => {
      // A tiny dictionary: 'Saved successfully' → Arabic only when lang=ar.
      if (key === 'translation.Saved successfully') {
        return opts?.lang === 'ar' ? 'تم الحفظ بنجاح' : 'Saved successfully';
      }
      return key; // miss → key returned (caller keeps the original)
    },
  };

  beforeEach(() => {
    jest.spyOn(I18nContext, 'current').mockReturnValue(fakeI18n as any);
  });
  afterEach(() => jest.restoreAllMocks());

  it('translates to the OVERRIDE language even when the context language differs', () => {
    // Context language is 'en' (no header); the account chose 'ar'.
    expect(translateMessage('Saved successfully', undefined, 'ar')).toBe('تم الحفظ بنجاح');
  });

  it('leaves the message in the context language when no override is given', () => {
    expect(translateMessage('Saved successfully', undefined)).toBe('Saved successfully');
  });

  it('returns the original message when there is no translation for it', () => {
    expect(translateMessage('Some untranslated line', undefined, 'ar')).toBe(
      'Some untranslated line',
    );
  });

  it('passes non-string messages through untouched', () => {
    expect(translateMessage(undefined as any)).toBe('');
  });
});
