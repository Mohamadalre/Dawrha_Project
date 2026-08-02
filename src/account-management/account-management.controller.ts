import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '@src/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '@src/permission/guards/permissions.guard';
import { Permissions } from '@src/permission/derorators/permissions.decorator';
import { Role } from '@src/user/enums/role.enum';
import { AccountManagementService } from './account-management.service';
import {
  AccountListQueryDto,
  BlockedAccountStatusDto,
  CancelReuploadRequestsDto,
  RequestReuploadDto,
  UpdateAccountStatusDto,
} from './dto/update-account-status.dto';
import { UpdateMediaStatusDto } from './dto/update-media-status.dto';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller({
  path: 'account-management',
  version: '1',
})
export class AccountManagementController {
  constructor(
    private readonly accountManagementService: AccountManagementService,
  ) {}

  // ---------------------------------------------------------------------------
  // The review queue — one route per role, PENDING_APPROVAL only, oldest first
  // ---------------------------------------------------------------------------
  //
  // Separate from the by-status listings below because it answers a different
  // question. This one is "what do I still owe somebody?"; those are "show me
  // the rejected ones". Serving both from one route with a filter made the
  // default view a mixture of finished and unfinished work, in which the
  // application that had been waiting longest was indistinguishable from one
  // answered a month ago.

  @Get('factory/pending')
  @Permissions('admin.accounts.view')
  async getFactoryQueue(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
  ) {
    const result = await this.accountManagementService.listReviewQueue(
      Role.FACTORY, page, limit,
    );
    return { message: 'Pending factory applications fetched successfully', result };
  }

  @Get('institution/pending')
  @Permissions('admin.accounts.view')
  async getInstitutionQueue(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
  ) {
    const result = await this.accountManagementService.listReviewQueue(
      Role.INSTITUTIONS, page, limit,
    );
    return { message: 'Pending institution applications fetched successfully', result };
  }

  @Get('external-partner/pending')
  @Permissions('admin.accounts.view')
  async getExternalPartnerQueue(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
  ) {
    const result = await this.accountManagementService.listReviewQueue(
      Role.EXTERNAL_PARTNER, page, limit,
    );
    return { message: 'Pending free-facility applications fetched successfully', result };
  }

  // ---------------------------------------------------------------------------
  // By status — one route per role. No `status` means every status.
  // ---------------------------------------------------------------------------

  @Get('factory')
  @Permissions('admin.accounts.view')
  async getFactories(@Query() query: AccountListQueryDto) {
    const result = await this.accountManagementService.getProfiles(Role.FACTORY, query);
    return { message: 'Factories fetched successfully', result };
  }

  @Get('institution')
  @Permissions('admin.accounts.view')
  async getInstitutions(@Query() query: AccountListQueryDto) {
    const result = await this.accountManagementService.getProfiles(
      Role.INSTITUTIONS, query,
    );
    return { message: 'Institutions fetched successfully', result };
  }

  @Get('external-partner')
  @Permissions('admin.accounts.view')
  async getExternalPartners(@Query() query: AccountListQueryDto) {
    const result = await this.accountManagementService.getProfiles(
      Role.EXTERNAL_PARTNER, query,
    );
    return { message: 'Free facilities fetched successfully', result };
  }

  // ---------------------------------------------------------------------------
  // One applicant
  // ---------------------------------------------------------------------------

  /**
   * Everything about one applicant, laid out as the review question.
   *
   * Named `account-details`, not `profile`: what it returns is the account AND
   * the profile AND the documents, and a path naming one of the three sends the
   * reader looking for the other two somewhere else.
   */
  @Get('account-details/:profileId')
  @Permissions('admin.accounts.view')
  async getAccountDetails(@Param('profileId', ParseUUIDPipe) profileId: string) {
    const result = await this.accountManagementService.getAccountDetails(profileId);
    return { message: 'Account details fetched successfully', result };
  }

  /** Where the applicant is. One route for factories, institutions and free facilities. */
  @Get('location/:profileId')
  @Permissions('admin.accounts.view')
  async getLocation(@Param('profileId', ParseUUIDPipe) profileId: string) {
    const result = await this.accountManagementService.getProfileLocation(profileId);
    return { message: 'Location fetched successfully', result };
  }

  /** Every document this applicant uploaded — one object each. */
  @Get(':profileId/media')
  @Permissions('admin.accounts.view')
  async getProfileDocuments(@Param('profileId', ParseUUIDPipe) profileId: string) {
    const result = await this.accountManagementService.getProfileDocuments(profileId);
    return { message: 'Documents fetched successfully', result };
  }

  /** One document, in full. */
  @Get('media/:mediaId')
  @Permissions('admin.accounts.view')
  async getMediaDetails(@Param('mediaId', ParseUUIDPipe) mediaId: string) {
    const result = await this.accountManagementService.getMediaDetails(mediaId);
    return { message: 'Document fetched successfully', result };
  }

  // ---------------------------------------------------------------------------
  // Decisions
  // ---------------------------------------------------------------------------

  /**
   * Mark a document acceptable or not — SILENTLY.
   *
   * The applicant is not told and the account does not move. Rejecting a
   * document is the reviewer recording a judgement, not addressing the
   * applicant; addressing them is the next route down.
   */
  @Patch('media/:mediaId/status')
  @Permissions('admin.accounts.manage')
  async updateMediaStatus(
    @Param('mediaId', ParseUUIDPipe) mediaId: string,
    @Body() dto: UpdateMediaStatusDto,
  ) {
    return this.accountManagementService.updateMediaStatus(mediaId, dto);
  }

  /**
   * Ask the applicant for one document again.
   *
   * The document must already be REJECTED. This is the only route in the review
   * flow that reaches the applicant: it moves the account to NEED_CHANGES and
   * sends them the reason. It is also the way back into a REJECTED application
   * — see the service for why it is the only way back.
   */
  @Post('media/:mediaId/request-reupload')
  @Permissions('admin.accounts.manage')
  async requestReupload(
    @Param('mediaId', ParseUUIDPipe) mediaId: string,
    @Body() dto: RequestReuploadDto,
  ) {
    return this.accountManagementService.requestReupload(mediaId, dto);
  }

  /**
   * Stop waiting for an applicant who never answered.
   *
   * The way out of the one state the review flow could not leave: asking for a
   * document moves the account to NEED_CHANGES, no decision may be taken in
   * NEED_CHANGES, so an applicant who never comes back left the reviewer with
   * no move at all — unable to approve, reject or close it.
   *
   * This withdraws the question, not the finding: the documents keep the status
   * they were given, so the account returns to the queue where it can be
   * rejected, and still cannot be approved over a document marked unacceptable.
   */
  @Post(':accountId/cancel-reupload-requests')
  @Permissions('admin.accounts.manage')
  async cancelReuploadRequests(
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Body() dto: CancelReuploadRequestsDto,
  ) {
    return this.accountManagementService.cancelReuploadRequests(accountId, dto);
  }

  /** Approve or reject the application. */
  @Patch(':accountId/status')
  @Permissions('admin.accounts.manage')
  async updateAccountStatus(
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Body() dto: UpdateAccountStatusDto,
  ) {
    return this.accountManagementService.updateStatus(accountId, dto);
  }

  /** Block an approved account, or lift a block. */
  @Patch(':accountId/block-status')
  @Permissions('admin.accounts.manage')
  async blockAccountStatus(
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Body() dto: BlockedAccountStatusDto,
  ) {
    return this.accountManagementService.blockStatus(accountId, dto);
  }

  // NOTE: the collector (driver) listing is absent on purpose — driver
  // applications are pushed to ODOO (PUSH_DRIVER_REQUEST) and reviewed there.
}
