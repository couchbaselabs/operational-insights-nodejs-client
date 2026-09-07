import { v4 as uuidv4 } from 'uuid'
import { sendUnaryData } from '@grpc/grpc-js'
import { SdkCommandQueryOptions } from '../options/queryOptions'
import { PerformerError } from '../errors'
import { QueryResultIterator } from './queryResultIterator'
import { RegisteredQuery } from './registeredQuery'

import {
  ExecuteQueryRequest as ExecuteQueryRequestPb,
  ExecuteQueryResponse as ExecuteQueryResponsePb,
  QueryResultMetadataResponse as QueryResultMetadataResponsePb,
  QueryRowResponse as QueryRowResponsePb,
} from '../../proto/columnar.query_pb'
import { ExecutionContextScopeLevel as ExecutionContextScopeLevelPb } from '../../proto/columnar.execution_context_pb'

import {
  Cluster,
  Scope,
  QueryResult,
  QueryOptions,
} from 'couchbase-operational-insights'

export class Query implements RegisteredQuery {
  private readonly _handle: string
  private readonly _statement: string
  private readonly _options: QueryOptions
  private readonly _connection: Cluster | Scope
  private _resultPromise: Promise<QueryResult> | undefined
  private _iterator: QueryResultIterator | undefined
  private _abortController: AbortController | undefined

  constructor(req: ExecuteQueryRequestPb, conn: Cluster) {
    this._handle = uuidv4()
    this._statement = req.getStatement()
    this._options = SdkCommandQueryOptions.toSdkQueryOptions(req.getOptions())
    if (req.getRequireCancellation()) {
      this._abortController = new AbortController()
      this._options['abortSignal'] = this._abortController.signal
    }
    if (req.hasClusterLevel()) {
      this._connection = conn
    } else {
      const scopeLevel = req.getScopeLevel() as ExecutionContextScopeLevelPb
      this._connection = conn
        .database(scopeLevel.getDatabaseName())
        .scope(scopeLevel.getScopeName())
    }
  }

  get handle(): string {
    return this._handle
  }

  get iterator(): QueryResultIterator | undefined {
    return this._iterator
  }

  execute(): ExecuteQueryResponsePb {
    this._resultPromise = this._connection.executeQuery(
      this._statement,
      this._options
    )
    // executeQuery() can fast-fail if there were bootstrap problems
    // if we don't add this catch we will get an uncaughtException issue
    this._resultPromise.catch((err) => {
      console.error('executeQuery() fast-failed. Details: ', err)
    })
    return new ExecuteQueryResponsePb().setQueryHandle(this._handle)
  }

  async result(): Promise<void> {
    if (typeof this._resultPromise === 'undefined') {
      throw new PerformerError('Cannot call result() before execute()')
    }
    const queryResult = await this._resultPromise
    if (typeof queryResult === 'undefined') {
      throw new PerformerError('No results available.')
    }
    this._iterator = new QueryResultIterator(queryResult)
  }

  close(): void {
    if (this._iterator) {
      this._iterator.close()
      this._iterator = undefined
    }
    this._resultPromise = undefined
  }

  row(
    callback: sendUnaryData<QueryRowResponsePb>,
    callbackCalled: boolean
  ): void {
    if (!this.iterator)
      throw new PerformerError('Query result is not yet available')
    this.iterator.row(callback, callbackCalled)
  }

  metadata(): QueryResultMetadataResponsePb {
    if (!this.iterator)
      throw new PerformerError('Query result is not yet available')
    return this.iterator.metadata()
  }

  cancel() {
    if (!this._abortController) {
      throw new PerformerError(
        'Cancel called but AbortController is not set up.' +
          ' If we are in this state and the driver set requireCancellation, this is a performer bug'
      )
    }
    try {
      this._abortController.abort()
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        throw new PerformerError(`Expected AbortError, but got: ${err}`)
      }
    }
  }

  fetchStatus(): Promise<{ resultsReady: boolean; toString: string }> {
    throw new PerformerError('fetchStatus() is not supported on a sync Query')
  }

  statusResultHandle(): void {
    throw new PerformerError(
      'statusResultHandle() is not supported on a sync Query'
    )
  }

  cancelHandle(): Promise<void> {
    throw new PerformerError('cancelHandle() is not supported on a sync Query')
  }

  fetchResults(_opts: { deserializer?: any }): Promise<void> {
    throw new PerformerError('fetchResults() is not supported on a sync Query')
  }

  discardResults(): Promise<void> {
    throw new PerformerError(
      'discardResults() is not supported on a sync Query'
    )
  }
}
