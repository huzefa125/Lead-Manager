import type { AuthenticatedUser } from '../users/user.types';

declare global {
  namespace Express {
    interface Request {
      /** Correlation id, assigned by the requestId middleware before anything else. */
      requestId: string;
      /** Present only after `authenticate` has run. */
      user?: AuthenticatedUser;
      /** Payload of query/params validated by `validate()`. */
      validated?: {
        query?: unknown;
        params?: unknown;
      };
    }
  }
}

export {};
