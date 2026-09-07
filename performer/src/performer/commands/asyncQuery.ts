import { sendUnaryData } from '@grpc/grpc-js'
import {
  QueryHandle,
  QueryStatus,
  QueryResultHandle,
} from 'couchbase-operational-insights'
import { PerformerError } from '../errors'
import { QueryResultIterator } from './queryResultIterator'
import { RegisteredQuery } from './registeredQuery'

import {
  QueryResultMetadataResponse as QueryResultMetadataResponsePb,
  QueryRowResponse as QueryRowResponsePb,
} from '../../proto/columnar.query_pb'

export class AsyncQuery implements RegisteredQuery {
  private readonly _queryHandle: QueryHandle
  private _queryStatus: QueryStatus | undefined
  private _resultHandle: QueryResultHandle | undefined
  private _iterator: QueryResultIterator | undefined

  constructor(queryHandle: QueryHandle) {
    this._queryHandle = queryHandle
  }

  fetchStatus(): Promise<{ resultsReady: boolean; toString: string }> {
    return this._queryHandle.fetchStatus().then((queryStatus) => {
      this._queryStatus = queryStatus
      return {
        resultsReady: queryStatus.resultsReady(),
        toString: queryStatus.toString(),
      }
    })
  }

  statusResultHandle(): void {
    if (!this._queryStatus) {
      throw new PerformerError(
        'No QueryStatus available. Was fetchStatus called first?'
      )
    }
    this._resultHandle = this._queryStatus.resultsHandle()
  }

  cancelHandle(): Promise<void> {
    return this._queryHandle.cancel()
  }

  fetchResults(opts: { deserializer?: any }): Promise<void> {
    if (!this._resultHandle) {
      throw new PerformerError(
        'No QueryResultHandle available. Was statusResultHandle called first?'
      )
    }
    return this._resultHandle.fetchResults(opts).then((queryResult) => {
      this._iterator = new QueryResultIterator(queryResult)
    })
  }

  discardResults(): Promise<void> {
    if (!this._resultHandle) {
      throw new PerformerError(
        'No QueryResultHandle available. Was statusResultHandle called first?'
      )
    }
    return this._resultHandle.discardResults()
  }

  row(
    callback: sendUnaryData<QueryRowResponsePb>,
    callbackCalled: boolean
  ): void {
    if (!this._iterator) {
      throw new PerformerError(
        'No results available. Was fetchResults called first?'
      )
    }
    this._iterator.row(callback, callbackCalled)
  }

  metadata(): QueryResultMetadataResponsePb {
    if (!this._iterator) {
      throw new PerformerError(
        'No results available. Was fetchResults called first?'
      )
    }
    return this._iterator.metadata()
  }

  result(): Promise<void> {
    throw new PerformerError('result() is not supported on an AsyncQuery')
  }

  cancel(): void {
    throw new PerformerError('cancel() is not supported on an AsyncQuery')
  }

  close(): void {
    if (this._iterator) {
      this._iterator.close()
      this._iterator = undefined
    }
    this._resultHandle = undefined
    this._queryStatus = undefined
  }
}
