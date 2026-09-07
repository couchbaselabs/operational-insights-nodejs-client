import { v4 as uuidv4 } from 'uuid'
import { sendUnaryData } from '@grpc/grpc-js'
import { Readable } from 'node:stream'
import { ErrorUtils, PerformerError } from '../errors'
import { SdkQueryCommandResult } from '../results/queryResults'
import { RegisteredQuery } from './registeredQuery'

import {
  QueryResultMetadataResponse as QueryResultMetadataResponsePb,
  QueryRowResponse as QueryRowResponsePb,
} from '../../proto/columnar.query_pb'
import ResultPb = QueryRowResponsePb.Result

import { QueryResult } from 'couchbase-operational-insights'

export class QueryResultIterator implements RegisteredQuery {
  private readonly _handle: string
  protected _result: QueryResult | undefined
  private _stream: Readable | undefined
  private _streamEndResult: QueryRowResponsePb.Result | undefined
  private _hasPendingRowRequest = false

  constructor(result: QueryResult, handle?: string) {
    this._handle = handle ?? uuidv4()
    this._result = result
    this._stream = result.rows()
    this._stream.pause()
  }

  get handle(): string {
    return this._handle
  }

  row(
    callback: sendUnaryData<QueryRowResponsePb>,
    _initialCallbackCalled: boolean
  ): void {
    if (!this._stream) {
      throw new PerformerError(
        'QueryRowStream is not available. Has the query been closed?'
      )
    }

    // This flag is a defensive safeguard. The test driver is expected to call queryRow
    // sequentially. If this is triggered, most likely indicates a bug in the driver's logic.
    if (this._hasPendingRowRequest) {
      return callback(
        new PerformerError(
          'Already waiting for a row from this stream.' +
            ' This would appear to be a driver bug as requests to stream rows is presumed to be sequential.'
        ) as any,
        null
      )
    }

    const response = new QueryRowResponsePb()

    const row = this._stream.read()
    if (row !== null) {
      const result = new ResultPb().setRow(
        SdkQueryCommandResult.toQueryRow(row)
      )
      response.setSuccess(result)
      return callback(null, response)
    }

    if (this._streamEndResult || this._stream.readableEnded) {
      this._streamEndResult =
        this._streamEndResult || new ResultPb().setEndOfStream(true)
      response.setSuccess(this._streamEndResult)
      return callback(null, response)
    }

    // Else wait for readable event
    this._hasPendingRowRequest = true
    let callbackCalled = false

    // Helper to prevent memory leaks and double-callbacks
    const cleanup = () => {
      if (callbackCalled) return
      callbackCalled = true
      this._hasPendingRowRequest = false
      if (this._stream) {
        this._stream.removeListener('readable', onReadable)
        this._stream.removeListener('end', onEnd)
        this._stream.removeListener('error', onError)
      }
    }

    const onReadable = () => {
      cleanup()
      const delayedRow = this._stream!.read()
      if (delayedRow !== null) {
        response.setSuccess(
          new ResultPb().setRow(SdkQueryCommandResult.toQueryRow(delayedRow))
        )
      } else {
        // If read() is null here, it means the stream ended
        this._streamEndResult = new ResultPb().setEndOfStream(true)
        response.setSuccess(this._streamEndResult)
      }
      callback(null, response)
    }

    const onEnd = () => {
      cleanup()
      this._streamEndResult = new ResultPb().setEndOfStream(true)
      response.setSuccess(this._streamEndResult)
      callback(null, response)
    }

    const onError = (err: any) => {
      cleanup()
      response.setRowLevelFailure(ErrorUtils.toProtoError(err))
      callback(null, response)
    }

    this._stream.once('readable', onReadable)
    this._stream.once('end', onEnd)
    this._stream.once('error', onError)
  }

  metadata(): QueryResultMetadataResponsePb {
    const response = new QueryResultMetadataResponsePb()
    try {
      if (!this._result) {
        throw new PerformerError(
          'QueryResult is not available. Has the query been closed?'
        )
      }
      const metadata = this._result.metadata()
      const metadataPb = SdkQueryCommandResult.toQueryMetadata(metadata)
      return response.setSuccess(metadataPb)
    } catch (e) {
      return response.setFailure(ErrorUtils.toProtoError(e))
    }
  }

  close(): void {
    if (this._stream) {
      this._stream.removeAllListeners()
      this._stream.destroy()
      this._stream = undefined
    }
    this._streamEndResult = undefined
    this._hasPendingRowRequest = false
    this._result = undefined
  }

  result(): Promise<void> {
    throw new PerformerError(
      'result() is not supported on a QueryResultIterator'
    )
  }

  cancel(): void {
    throw new PerformerError(
      'cancel() is not supported on a QueryResultIterator'
    )
  }

  fetchStatus(): Promise<{ resultsReady: boolean; toString: string }> {
    throw new PerformerError(
      'fetchStatus() is not supported on a QueryResultIterator'
    )
  }

  statusResultHandle(): void {
    throw new PerformerError(
      'statusResultHandle() is not supported on a QueryResultIterator'
    )
  }

  cancelHandle(): Promise<void> {
    throw new PerformerError(
      'cancelHandle() is not supported on a QueryResultIterator'
    )
  }

  fetchResults(_opts: { deserializer?: any }): Promise<void> {
    throw new PerformerError(
      'fetchResults() is not supported on a QueryResultIterator'
    )
  }

  discardResults(): Promise<void> {
    throw new PerformerError(
      'discardResults() is not supported on a QueryResultIterator'
    )
  }
}
