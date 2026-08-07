import { Controller, Get } from '@nestjs/common';
import { I18nContext, I18nService } from 'nestjs-i18n';

/**
 * Public static content (about / terms / privacy). Texts live in the i18n
 * dictionaries (`src/i18n/{ar,en}/translation.json` under `content.*`) so they
 * are served in the request language (x-lang header) and editable without a
 * code change.
 *
 * No auth, on purpose: these screens are shown pre-login AND in every account
 * status (a pending or blocked user must still be able to read the terms and
 * the privacy policy). They are NOT Redis-cached — the text is already an
 * in-memory dictionary lookup with no database query, so a cache round-trip
 * would only ADD latency, not remove a query. The i18n layer is the cache.
 */
@Controller({ path: 'content', version: '1' })
export class ContentController {
  constructor(private readonly i18n: I18nService) {}

  @Get('about')
  about() {
    return {
      message: 'About content fetched successfully',
      result: this.block('about'),
    };
  }

  @Get('terms')
  terms() {
    return {
      message: 'Terms of use fetched successfully',
      result: this.block('terms'),
    };
  }

  @Get('privacy')
  privacy() {
    return {
      message: 'Privacy policy fetched successfully',
      result: this.block('privacy'),
    };
  }

  private block(key: 'about' | 'terms' | 'privacy') {
    const lang = I18nContext.current()?.lang ?? 'en';
    return {
      title: this.i18n.t(`translation.content.${key}.title`, { lang }),
      body: this.i18n.t(`translation.content.${key}.body`, { lang }),
      last_updated: this.i18n.t(`translation.content.${key}.lastUpdated`, { lang }),
    };
  }
}
