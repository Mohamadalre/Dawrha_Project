import { Injectable } from '@nestjs/common';
import { Role } from '@src/user/enums/role.enum';
import { CatalogService } from './catalog.service';

interface Caller {
  id: string;
  role: Role;
}

/**
 * Aggregates the home-screen payload for a buyer. Restriction by assigned
 * categories is handled inside CatalogService, so the same aggregator serves
 * individual, company, factory and free-facility home screens.
 */
@Injectable()
export class HomeService {
  constructor(private readonly catalog: CatalogService) {}

  async getHome(caller: Caller) {
    const categories = await this.catalog.getCategories(caller, {
      page: 1,
      limit: 10,
      sort: 'name',
      order: 'asc',
    });

    const offers = await this.catalog.getOffers(caller, {
      page: 1,
      limit: 5,
      active_only: true,
      sort: 'discount',
    });

    return {
      role: caller.role,
      categories: categories.categories,
      offers: offers.offers,
    };
  }
}
