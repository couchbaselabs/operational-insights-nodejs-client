/*
 *  Copyright 2016-2025. Couchbase, Inc.
 *  All Rights Reserved.
 *
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 */

import { RequestContext } from './requestcontext.js'
import {
  OperationalInsightsError,
  InvalidCredentialError,
  QueryError,
  QueryNotFoundException,
  TimeoutError,
} from './errors.js'
import {
  ConnectionError,
  HttpStatusError,
  InternalConnectionTimeout,
} from './internalerrors.js'
import { RequestBehaviour } from './retries.js'

/**
 * Static class for shared error handling logic
 *
 * @internal
 */
export class ErrorHandler {
  /**
   * @internal
   */
  static handleErrors(errs: any, context: RequestContext): RequestBehaviour {
    if (errs instanceof HttpStatusError) {
      if (errs.statusCode === 401) {
        return RequestBehaviour.fail(
          new InvalidCredentialError(
            context.attachErrorContext('Invalid credentials')
          )
        )
      } else if (errs.statusCode === 404) {
        return RequestBehaviour.fail(
          new QueryNotFoundException(
            context.attachErrorContext('Query not found')
          )
        )
      } else if (errs.statusCode === 503) {
        return RequestBehaviour.retry(
          new OperationalInsightsError(
            context.attachErrorContext(
              'The server returned a 503 Service Unavailable error. This is likely a temporary issue.'
            )
          )
        )
      }

      return RequestBehaviour.fail(
        new OperationalInsightsError(
          context.attachErrorContext(
            `Unhandled HTTP status error occurred: ${errs}`
          )
        )
      )
    } else if (errs instanceof TimeoutError) {
      return RequestBehaviour.fail(errs)
    } else if (errs instanceof InternalConnectionTimeout) {
      return RequestBehaviour.retry(
        new TimeoutError(
          context.attachErrorContext(
            'Timed out attempting to establish a connection to a Node within the connectTimeout period.'
          )
        )
      )
    } else if (errs instanceof ConnectionError) {
      if (this._isRetriableConnectionError(errs)) {
        return RequestBehaviour.retry(
          new OperationalInsightsError(
            context.attachErrorContext(
              `Got a retriable connection error from the HTTP library, details: ${errs.cause}`
            )
          )
        )
      }

      return RequestBehaviour.fail(
        new OperationalInsightsError(
          context.attachErrorContext(
            `Got an unretriable error from the HTTP library, details: ${errs.cause.message}`
          )
        )
      )
    } else if (errs instanceof OperationalInsightsError) {
      return RequestBehaviour.fail(errs)
    } else if (errs.name && errs.name === 'AbortError') {
      // We consider AbortError a platform error so we don't wrap it in OperationalInsightsError
      return RequestBehaviour.fail(errs)
    } else if (Array.isArray(errs)) {
      // Server error array from query JSON response
      return this._parseServerErrors(errs, context)
    }

    return RequestBehaviour.fail(
      new OperationalInsightsError(
        context.attachErrorContext(`Unknown Error received: ${String(errs)}`)
      )
    )
  }

  /**
   * @internal
   */
  private static _parseServerErrors(
    errors: string[] | object[],
    context: RequestContext
  ): RequestBehaviour {
    const addRemainingErrorsToContext = () => {
      context.pushOtherServerErrors(
        ...errors.filter((_, i) => parsedErrors[i] !== selectedError)
      )
    }

    // Server error array from query JSON response
    let firstNonRetriableError: any = null
    let firstRetriableError: any = null

    // Each error will be a string if they come from the json streamer, or an object if they've already been parsed on a non-successful status code
    const parsedErrors = errors.map((err) =>
      typeof err === 'string' ? JSON.parse(err) : err
    )

    for (const jsonErr of parsedErrors) {
      const retriable = 'retriable' in jsonErr ? jsonErr.retriable : false

      if (!retriable && !firstNonRetriableError) {
        firstNonRetriableError = jsonErr
      }

      if (retriable && !firstRetriableError) {
        firstRetriableError = jsonErr
      }
    }

    const selectedError = firstNonRetriableError || firstRetriableError

    if (!selectedError) {
      return RequestBehaviour.fail(
        new OperationalInsightsError(
          context.attachErrorContext('Server returned an empty error array')
        )
      )
    }

    if (selectedError.code === 20000) {
      addRemainingErrorsToContext()
      return RequestBehaviour.fail(
        new InvalidCredentialError(
          context.attachErrorContext(
            `Server response indicated invalid credentials. Server message: ${selectedError.msg}. Server error code: ${selectedError.code}`
          )
        )
      )
    } else if (selectedError.code === 21002) {
      addRemainingErrorsToContext()
      return RequestBehaviour.fail(
        new TimeoutError(
          context.attachErrorContext(
            `Server side timeout occurred. Server message: ${selectedError.msg}. Server error code: ${selectedError.code}`
          )
        )
      )
    } else if (firstRetriableError && !firstNonRetriableError) {
      addRemainingErrorsToContext()
      return RequestBehaviour.retry(
        new QueryError(
          context.attachErrorContext(
            `Retriable server-side query error occurred: Server message: ${selectedError.msg}. Server error code: ${selectedError.code}`
          ),
          selectedError.msg,
          selectedError.code
        )
      )
    } else {
      addRemainingErrorsToContext()
      return RequestBehaviour.fail(
        new QueryError(
          context.attachErrorContext(
            `Server-side query error occurred: Server message: ${selectedError.msg}. Server error code: ${selectedError.code}`
          ),
          selectedError.msg,
          selectedError.code
        )
      )
    }
  }

  /**
   * @internal
   */
  private static _isRetriableConnectionError(error: ConnectionError): boolean {
    const nodeError = error.cause as NodeJS.ErrnoException
    if (!error.isRequestError || !nodeError || !nodeError.code) {
      return false
    }

    return !connectionDenyList.has(nodeError.code)
  }
}

/**
 * Taken from https://github.com/sindresorhus/is-retry-allowed
 * @internal
 */
const connectionDenyList = new Set([
  'ENOTFOUND',
  'ENETUNREACH',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_CRL',
  'UNABLE_TO_DECRYPT_CERT_SIGNATURE',
  'UNABLE_TO_DECRYPT_CRL_SIGNATURE',
  'UNABLE_TO_DECODE_ISSUER_PUBLIC_KEY',
  'CERT_SIGNATURE_FAILURE',
  'CRL_SIGNATURE_FAILURE',
  'CERT_NOT_YET_VALID',
  'CERT_HAS_EXPIRED',
  'CRL_NOT_YET_VALID',
  'CRL_HAS_EXPIRED',
  'ERROR_IN_CERT_NOT_BEFORE_FIELD',
  'ERROR_IN_CERT_NOT_AFTER_FIELD',
  'ERROR_IN_CRL_LAST_UPDATE_FIELD',
  'ERROR_IN_CRL_NEXT_UPDATE_FIELD',
  'OUT_OF_MEM',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'CERT_CHAIN_TOO_LONG',
  'CERT_REVOKED',
  'INVALID_CA',
  'PATH_LENGTH_EXCEEDED',
  'INVALID_PURPOSE',
  'CERT_UNTRUSTED',
  'CERT_REJECTED',
  'HOSTNAME_MISMATCH',
])
