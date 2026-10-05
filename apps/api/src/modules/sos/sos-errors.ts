import { HttpStatus } from '@nestjs/common';
import { ApiException, Errors } from '../../common/errors/api-exception';

export const SosErrors = {
  notFound: () => Errors.notFound('SOS not found'),
  invalidState: (message = 'This action is not possible in the current state of the SOS') =>
    Errors.conflict('SOS_INVALID_STATE', message),
  helperLimit: () => Errors.conflict('SOS_HELPER_LIMIT', 'This SOS already has the maximum number of accepted helpers'),
  helperBusy: () => Errors.conflict('SOS_HELPER_BUSY', 'This helper is already helping with another SOS'),
  offerLimit: () => Errors.conflict('SOS_OFFER_LIMIT', 'This SOS already has the maximum number of offers'),
  phoneNotVerified: () => Errors.forbidden('A verified phone number is required to request help', 'PHONE_NOT_VERIFIED'),
  ratingTooLow: () => Errors.forbidden('Your rating is too low for this action', 'RATING_TOO_LOW'),
  banned: (until: Date) => new ApiException(HttpStatus.FORBIDDEN, 'SOS_BANNED', 'You are temporarily not allowed to create SOS', { until: until.toISOString() }),
  rateLimit: (retryAfterSec: number) =>
    new ApiException(HttpStatus.TOO_MANY_REQUESTS, 'SOS_RATE_LIMIT', 'Too many SOS in the last 24 hours', { retryAfterSec }),
  alreadyOpen: () => Errors.conflict('SOS_ALREADY_OPEN', 'You already have an open SOS'),
  requesterOnly: () => Errors.forbidden('Only the requester can do this'),
};
