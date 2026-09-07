import { sendUnaryData, status, ServerErrorResponse } from '@grpc/grpc-js'

import {
  ColumnarError as ColumnarErrorPb,
  Error as ErrorPb,
  InvalidCredentialException as InvalidCredentialExceptionPb,
  PlatformError as PlatformErrorPb,
  PlatformErrorType as PlatformErrorTypePb,
  QueryException as QueryExceptionPb,
  QueryNotFoundException as QueryNotFoundExceptionPb,
  SubColumnarError as SubColumnarErrorPb,
  TimeoutException as TimeoutExceptionPb,
} from '../proto/columnar.errors_pb'

import {
  OperationalInsightsError,
  InvalidCredentialError,
  QueryError,
  QueryNotFoundException,
  TimeoutError,
} from 'couchbase-operational-insights'

export class PerformerError extends Error {
  constructor(message: string) {
    super(message)
  }

  grpcError(): ServerErrorResponse {
    return {
      message: this.message,
      name: this.name,
      code: status.INTERNAL,
    }
  }
}

export class NotImplementedError extends PerformerError {
  constructor(msg: string) {
    super(msg + ' is not implemented')
  }

  grpcError(): ServerErrorResponse {
    return {
      message: this.message,
      name: 'NotImplementedError',
      code: status.UNIMPLEMENTED,
    }
  }
}

export class ErrorUtils {
  static toProtoError(err: any): ErrorPb {
    const error = new ErrorPb()
    if (err instanceof OperationalInsightsError) {
      const columnarErrPb = new ColumnarErrorPb()
      columnarErrPb.setSubException(this.getColumnarSubException(err))
      columnarErrPb.setAsString(err.toString())
      error.setColumnar(columnarErrPb)
      return error
    }

    const platformErr = new PlatformErrorPb()
    platformErr.setType(this.getPlatformErrorType(err))
    platformErr.setAsString(err.toString())
    error.setPlatform(platformErr)
    return error
  }

  static getColumnarSubException(
    err: OperationalInsightsError
  ): SubColumnarErrorPb | undefined {
    if (err instanceof QueryNotFoundException) {
      return new SubColumnarErrorPb().setQueryNotFoundException(
        new QueryNotFoundExceptionPb()
      )
    } else if (err instanceof InvalidCredentialError) {
      return new SubColumnarErrorPb().setInvalidCredentialException(
        new InvalidCredentialExceptionPb()
      )
    } else if (err instanceof TimeoutError) {
      return new SubColumnarErrorPb().setTimeoutException(
        new TimeoutExceptionPb()
      )
    } else if (err instanceof QueryError) {
      return new SubColumnarErrorPb().setQueryException(
        new QueryExceptionPb()
          .setErrorCode(err.code)
          .setServerMessage(err.serverMessage)
      )
    }
    return undefined
  }

  static getPlatformErrorType(_err: Error): PlatformErrorTypePb {
    return PlatformErrorTypePb.PLATFORM_ERROR_OTHER //TODO Come back to this once we figure out the 'platform' errors in the SDK
  }

  static handleNonSdkError(err: any, callback: sendUnaryData<any>): void {
    console.error(err)
    if (err instanceof PerformerError) {
      callback(err.grpcError(), null)
    } else {
      callback(err, null)
    }
  }
}
