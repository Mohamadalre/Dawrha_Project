import { SuggestionsController } from './suggestions.controller';
import { AdminSuggestionsController } from './admin-suggestions.controller';

/**
 * The suggestion HTTP surface: the buyer route uploads every image BEFORE the
 * row is written, and the admin routes delegate read/reply straight through.
 */
describe('SuggestionsController (buyer)', () => {
  it('uploads each image, then creates the suggestion with the resulting URLs', async () => {
    const service = { create: jest.fn().mockResolvedValue({ ok: true }) };
    const cloudinary = {
      uploadFile: jest.fn(async (_f: any) => ({ imageUrl: 'https://cdn/x.jpg' })),
    };
    const ctrl = new SuggestionsController(service as any, cloudinary as any);
    const user = { id: 'u1' };
    const files = [{ n: 1 }, { n: 2 }] as any;
    const dto = { name: 'Cardboard', category_id: 'cat1' } as any;

    await ctrl.suggest(user, files, dto);

    // One upload per file, scoped to the proposer.
    expect(cloudinary.uploadFile).toHaveBeenCalledTimes(2);
    expect(cloudinary.uploadFile).toHaveBeenCalledWith(files[0], 'u1', 'suggestion', 'image');
    // The service receives the uploaded URLs, not the raw files.
    expect(service.create).toHaveBeenCalledWith(user, dto, [
      'https://cdn/x.jpg',
      'https://cdn/x.jpg',
    ]);
  });

  it('creates with no images when none are sent', async () => {
    const service = { create: jest.fn().mockResolvedValue({}) };
    const cloudinary = { uploadFile: jest.fn() };
    const ctrl = new SuggestionsController(service as any, cloudinary as any);
    await ctrl.suggest({ id: 'u1' }, undefined as any, { name: 'X' } as any);
    expect(cloudinary.uploadFile).not.toHaveBeenCalled();
    expect(service.create).toHaveBeenCalledWith({ id: 'u1' }, { name: 'X' }, []);
  });
});

describe('AdminSuggestionsController', () => {
  const build = () => {
    const suggestions = {
      listForAdmin: jest.fn().mockResolvedValue({ items: [] }),
      detailForAdmin: jest.fn().mockResolvedValue({ id: 's1' }),
      reply: jest.fn().mockResolvedValue({ sent: true }),
    };
    return { ctrl: new AdminSuggestionsController(suggestions as any), suggestions };
  };

  it('lists with the query filter', async () => {
    const { ctrl, suggestions } = build();
    const q = { submitted_by: 'FACTORY' } as any;
    await ctrl.list(q);
    expect(suggestions.listForAdmin).toHaveBeenCalledWith(q);
  });

  it('fetches one by id', async () => {
    const { ctrl, suggestions } = build();
    await ctrl.detail('s1');
    expect(suggestions.detailForAdmin).toHaveBeenCalledWith('s1');
  });

  it('replies to the proposer with the admin id and message', async () => {
    const { ctrl, suggestions } = build();
    await ctrl.reply({ id: 'admin1' }, 's1', { message: 'hello' } as any);
    expect(suggestions.reply).toHaveBeenCalledWith('admin1', 's1', 'hello');
  });
});
