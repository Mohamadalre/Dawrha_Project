import { BadRequestException } from '@nestjs/common';

export function imageFilter(req, file, cb) {
  if (!file.mimetype.match(/\/(jpg|jpeg|png)$/)) {
    return cb(
      new BadRequestException('Only images allowed'),
      false,
    );
  }
  cb(null, true);
}