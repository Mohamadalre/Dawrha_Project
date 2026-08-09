import {
  Column,
  Entity,
  ManyToOne,
  JoinColumn,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { Product } from './product.entity';
import { MaterialCondition } from './material-condition.entity';
import { OfferAudience } from '../enums/offer-audience.enum';
import { OfferBasis } from '../enums/offer-basis.enum';

@Entity('offers')
export class Offer {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Product, (product) => product.offers, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'product_id' })
  product: Product;

  @Index()
  @Column({ name: 'product_id' })
  productId: string;

  /**
   * A single role INSIDE the audience, when the offer is narrowed to one.
   *
   * Null means both roles of that audience — which is the common case and the
   * reason it is optional. It can never cross the audience boundary: a seller
   * offer naming a factory would be an increase applied to a price that is
   * supposed to fall.
   */
  @Column({ name: 'target_roles', type: 'text', array: true, nullable: true })
  targetRoles?: string[] | null;

  /**
   * The GRADE this offer applies to — by id, and the authoritative link.
   *
   * A code is not an identifier. It is unique only inside its own material, so
   * the string "GOOD" says nothing about whose GOOD it is, and an offer holding
   * only a code could be filed against a grade belonging to another material
   * entirely — where it would never match a cart line and simply never apply.
   *
   * The foreign key does what no amount of validation can: it makes the
   * database itself refuse to delete a grade a live offer names. Before this,
   * deleting one left the offer pointing at a code that no longer existed —
   * still listed, still "live", and silently unable to match anything ever
   * again.
   *
   * Null = the offer is on the material's flat price (citizens, institutions,
   * or a material with no grades at all).
   */
  @ManyToOne(() => MaterialCondition, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'condition_id' })
  condition?: MaterialCondition | null;

  @Index()
  @Column({ name: 'condition_id', type: 'uuid', nullable: true })
  conditionId?: string | null;

  /**
   * The same grade's CODE, copied from the row above.
   *
   * Kept because it is the join key everywhere else: `product_pricing`,
   * `cart_items` and the Odoo mirror are all keyed by code, and matching an
   * offer to a price or a basket line goes through it. Resolving the id on
   * every read instead would add a join to the hottest queries in the
   * catalogue for a value that cannot change.
   *
   * Safe to denormalise for one specific reason: a condition's code is
   * IMMUTABLE — `UpdateConditionDto` has no `code` field, so there is no rename
   * that could leave this stale. It is always written from the resolved
   * condition row and never from user input, so the two cannot disagree.
   */
  @Column({ name: 'condition_code', length: 30, nullable: true, type: 'varchar' })
  conditionCode?: string | null;

  /**
   * WHO the offer is for, and therefore which way it moves the price.
   *
   * The platform stands between two sides of one trade: sellers hand material
   * to it, buyers take sorted material from it. "A better offer" means paying
   * a seller MORE and charging a buyer LESS, so an offer that did not record
   * its side could not say what it was offering.
   */
  @Index()
  @Column({ name: 'audience', type: 'varchar', length: 16 })
  audience: OfferAudience;

  /**
   * The AMOUNT the price moves by — absolute, not a price and not a percentage.
   *
   * Added to a seller's price, subtracted from a buyer's. It replaced a stored
   * `offer_price`, which could only ever describe ONE tier: a single offer
   * reaches two roles priced differently, and one final price cannot be right
   * for both. An amount applies to whatever each of them already pays.
   *
   * Validated before storage against every price it touches, so it can never
   * drive one below zero.
   */
  @Column({ name: 'amount', type: 'decimal', precision: 12, scale: 3 })
  amount: string;

  /**
   * What that amount represents as a percentage of the base price — DERIVED.
   *
   * Recomputed whenever the amount or the underlying price moves. Never
   * accepted from a request: a typed percentage is free to disagree with the
   * two numbers either side of it.
   *
   * Unsigned. The audience already says which way the price moves, and a
   * negative here would read as a cut on an offer that is a rise.
   */
  @Column({ type: 'decimal', precision: 5, scale: 2, default: 0 })
  discountPercentage: string;

  /**
   * How the administrator EXPRESSED this offer — and therefore what a later
   * price edit must do to it.
   *
   * Both bases store an `amount`, because everything downstream applies one.
   * What differs is which number is the promise:
   *
   *   AMOUNT     — "5 off" survives a price change; 5 off 80 becomes 5 off 100.
   *   PERCENTAGE — "25% off" survives it instead, and the AMOUNT is recomputed;
   *                leaving it alone would quietly turn a quarter off into a
   *                fifth off the moment the list price rose.
   *
   * Without this column the two are indistinguishable the instant the row is
   * written, and a price edit has no way to know which the admin agreed to.
   */
  @Column({
    name: 'basis',
    type: 'varchar',
    length: 16,
    default: OfferBasis.AMOUNT,
  })
  basis: OfferBasis;

  /**
   * The percentage that was TYPED IN, kept only for a PERCENTAGE offer.
   *
   * Deliberately separate from `discountPercentage` above, which is derived and
   * exists for every offer. They agree at the moment of writing and drift the
   * instant a price moves — and the drift is the point: this one is the promise
   * to honour, that one is what the current amount happens to come to.
   *
   * Null on an AMOUNT offer: there is no promised percentage to keep.
   */
  @Column({
    name: 'basis_percentage',
    type: 'decimal',
    precision: 5,
    scale: 2,
    nullable: true,
  })
  basisPercentage?: string | null;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  validFrom: Date;

  @Column({ type: 'timestamptz', nullable: true })
  validUntil?: Date;

  @Column({ default: true })
  isActive: boolean;

  /**
   * Whether the admin TARGETED this row at a role, or it came from a GENERAL
   * (audience-wide) offer.
   *
   * A role-specific offer is allowed to sit alongside a general one that also
   * reaches the role, and it OVERRIDES the general for that role: the buyer is
   * shown the specific offer, not the general. This flag is what lets the two
   * coexist — the duplicate check only blocks a clash at the SAME level (two
   * generals, or two specifics), and the buyer read collapses each material +
   * grade to the specific row when one exists.
   *
   * `false` = general (no `target_roles` on create); `true` = the admin named
   * the role(s) explicitly.
   */
  @Column({ name: 'role_specific', default: false })
  roleSpecific: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
