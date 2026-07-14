import { Controller, Get } from '@nestjs/common';
import { I18nContext, I18nService } from 'nestjs-i18n';

/**
 * Public static content (about / terms). Texts live in the i18n dictionaries
 * (`src/i18n/{ar,en}/translation.json` under `content.*`) so they are served in
 * the request language (x-lang header) and editable without a code change.
 * No auth: both screens are shown pre-login in the apps.
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

  private block(key: 'about' | 'terms') {
    const lang = I18nContext.current()?.lang ?? 'en';
    return {
      title: this.i18n.t(`translation.content.${key}.title`, { lang }),
      body: this.i18n.t(`translation.content.${key}.body`, { lang }),
      last_updated: this.i18n.t(`translation.content.${key}.lastUpdated`, { lang }),
    };
  }
}
