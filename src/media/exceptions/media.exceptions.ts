import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';

/** Named domain exceptions for the media module (see FIXES.md #34 convention). */
export class MediaNotFoundException extends NotFoundException {
  constructor() {
    super({ message: 'Media not found', errorCode: 'MEDIA_NOT_FOUND' });
  }
}

export class OnlyRejectedReuploadException extends BadRequestException {
  constructor() {
    super({
      message: 'Only rejected images can be re-uploaded',
      errorCode: 'ONLY_REJECTED_REUPLOAD',
    });
  }
}

export class NotYourImageException extends ForbiddenException {
  constructor() {
    super({
      message: 'This image does not belong to your account',
      errorCode: 'NOT_YOUR_IMAGE',
    });
  }
}

export class DuplicateImageTypeException extends ForbiddenException {
  constructor(fileType: string) {
    super({
      message: `You already have a ${fileType} image. Update or delete it first.`,
      errorCode: 'DUPLICATE_IMAGE_TYPE',
    });
  }
}
