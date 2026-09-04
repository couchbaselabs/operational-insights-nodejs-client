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

import { Deserializer } from './deserializers.js'
import { QueryExecutor } from './queryexecutor.js'
import {
  AsyncQueryExecutor,
  FetchStatusResponse,
  StartQueryResponse,
} from './asyncqueryexecutor.js'
import { Readable, Transform } from 'node:stream'
import { TransformCallback } from 'stream'
import { TimeoutError, OperationalInsightsError } from './errors.js'
import { ParsingUtilities } from './utilities.js'
import type { Cluster } from './cluster.js'
import type { Scope } from './scope.js'
import type { QueryNotFoundException, QueryError } from './errors.js'

/**
 * Contains the results of an Operational Insights query.
 *
 * @category Query
 */
export class QueryResult {
  private _executor: QueryExecutor
  private _stream: QueryResultStream

  /**
   * @internal
   */
  constructor(executor: QueryExecutor, stream: QueryResultStream) {
    this._executor = executor
    this._stream = stream
  }

  /**
   * Returns a [Readable](https://nodejs.org/api/stream.html#readable-streams) stream of rows returned from the Operational Insights query.
   */
  rows(): Readable {
    return this._stream
  }

  /**
   * Volatile: This API is subject to change at any time.
   *
   * Cancel streaming the query results.
   */
  cancel(): void {
    this._executor.handleAbort()
  }

  /**
   * The metadata returned from the query. Only becomes available once all rows have been iterated.
   *
   * @throws {Error} If it is called before all rows have been iterated.
   */
  metadata(): QueryMetadata {
    const metadata = this._executor.metadata
    if (!metadata) {
      throw new Error(
        'Metadata is only available once all rows have been iterated'
      )
    }
    return metadata
  }
}

/**
 * @internal
 */
export class QueryResultStream extends Transform {
  private executor: QueryExecutor
  private deadline: number
  private _timeout: NodeJS.Timeout | undefined
  private _deserializer: Deserializer

  constructor(
    executor: QueryExecutor,
    deadline: number,
    signal: AbortSignal,
    deserializer: Deserializer
  ) {
    super({ objectMode: true, signal: signal })
    this.executor = executor
    this.deadline = deadline
    this._deserializer = deserializer

    const rem = this.deadline - Date.now()
    if (rem <= 0) {
      process.nextTick(() =>
        this.emit(
          'error',
          new TimeoutError(
            this.executor.requestContext.attachErrorContext('Query timed out')
          )
        )
      )
    } else {
      this._timeout = setTimeout(() => {
        this.emit(
          'error',
          new TimeoutError(
            this.executor.requestContext.attachErrorContext(
              'Query timed out during stream'
            )
          )
        )
      }, rem)
    }

    this.once('end', () => clearTimeout(this._timeout))
    this.once('error', () => clearTimeout(this._timeout))
  }

  /**
   * @inheritDoc
   */
  _transform(
    jsonString: any,
    _: BufferEncoding,
    callback: TransformCallback
  ): void {
    this.push(this._deserializer.deserialize(jsonString))
    callback()
  }

  /**
   * @inheritDoc
   */
  _destroy(
    error: Error | null,
    callback: (error?: Error | null) => void
  ): void {
    if (error && error.name !== 'AbortError') {
      callback(error)
    }
    clearTimeout(this._timeout)
    callback(null)
  }
}

/**
 * Contains the meta-data that is returned from a query.
 *
 * @category Query
 */
export class QueryMetadata {
  /**
   * The request ID which is associated with the executed query.
   */
  requestId: string

  /**
   * Any warnings that occurred during the execution of the query.
   */
  warnings: QueryWarning[]

  /**
   * Various metrics which are made available by the query engine.
   */
  metrics: QueryMetrics

  /**
   * @internal
   */
  constructor(data: QueryMetadata) {
    this.requestId = data.requestId
    this.warnings = data.warnings
    this.metrics = data.metrics
  }

  /**
   * @internal
   */
  static parse(json: string): QueryMetadata {
    const data = JSON.parse(json)
    return new QueryMetadata({
      requestId: data.requestID,
      warnings: data.warnings
        ? data.warnings.map((warning: any) => QueryWarning.parse(warning))
        : [],
      metrics: QueryMetrics.parse(data.metrics),
    })
  }
}

/**
 * Contains information about a warning which occurred during the
 * execution of an operational insights query.
 *
 * @category Query
 */
export class QueryWarning {
  /**
   * The numeric code associated with the warning which occurred.
   */
  code: number

  /**
   * A human-readable representation of the warning which occurred.
   */
  message: string

  /**
   * @internal
   */
  constructor(data: QueryWarning) {
    this.code = data.code
    this.message = data.message
  }

  /**
   * @internal
   */
  static parse(json: any): QueryWarning {
    return new QueryWarning({
      code: json.code,
      message: json.message,
    })
  }
}

/**
 * Contains various metrics that are returned by the server following
 * the execution of an operational insights query.
 *
 * @category Query
 */
export class QueryMetrics {
  /**
   * The total amount of time spent running the query, in milliseconds.
   */
  elapsedTime: number

  /**
   * The total amount of time spent executing the query, in milliseconds.
   */
  executionTime: number

  /**
   * The total number of rows which were part of the result set.
   */
  resultCount: number

  /**
   * The total number of bytes which were generated as part of the result set.
   */
  resultSize: number

  /**
   * The total number of objects that were processed as part of execution of the query.
   */
  processedObjects: number

  /**
   * @internal
   */
  constructor(data: QueryMetrics) {
    this.elapsedTime = data.elapsedTime
    this.executionTime = data.executionTime
    this.resultCount = data.resultCount
    this.resultSize = data.resultSize
    this.processedObjects = data.processedObjects
  }

  /**
   * @internal
   */
  static parse(json: any): QueryMetrics {
    return new QueryMetrics({
      elapsedTime: ParsingUtilities.parseGolangSyntaxDuration(json.elapsedTime),
      executionTime: ParsingUtilities.parseGolangSyntaxDuration(
        json.executionTime
      ),
      resultCount: json.resultCount,
      resultSize: json.resultSize,
      processedObjects: json.processedObjects,
    })
  }
}

/**
 * Represents the various scan consistency options that are available when
 * querying against Operational Insights.
 *
 * @category Query
 */
export enum QueryScanConsistency {
  /**
   * Indicates that no specific consistency is required, this is the fastest
   * options, but results may not include the most recent operations which have
   * been performed.
   */
  NotBounded = 'not_bounded',

  /**
   * Indicates that the results to the query should include all operations that
   * have occurred up until the query was started.  This incurs a performance
   * penalty of waiting for the index to catch up to the most recent operations,
   * but provides the highest level of consistency.
   */
  RequestPlus = 'request_plus',
}

/**
 * @category Query
 */
export interface QueryOptions {
  /**
   * Positional values to be used for the placeholders within the query.
   */
  positionalParameters?: any[]

  /**
   * Named values to be used for the placeholders within the query.
   */
  namedParameters?: { [key: string]: any }

  /**
   * Specifies the consistency requirements when executing the query.
   *
   * @see QueryScanConsistency
   */
  scanConsistency?: QueryScanConsistency

  /**
   * Indicates whether this query should be executed in read-only mode.
   */
  readOnly?: boolean

  /**
   * Specifies any additional parameters which should be passed to the query engine
   * when executing the query.
   */
  raw?: { [key: string]: any }

  /**
   * The timeout for this operation, represented in milliseconds.
   */
  timeout?: number

  /**
   * The returned client context id for this query.
   */
  clientContextId?: string

  /**
   * Sets the deserializer used by {@link QueryResult.rows } to convert query result rows into objects.
   * If not specified, defaults to the cluster's default deserializer.
   */
  deserializer?: Deserializer

  /**
   * Specifies the maximum number of retries for this query. If unset, defaults to the cluster-level maxRetries.
   *
   * Volatile: This API is subject to change at any time.
   */
  maxRetries?: number

  /**
   * Sets an abort signal for the query allowing the operation to be cancelled.
   */
  abortSignal?: AbortSignal
}

/**
 * Options for the {@link Cluster.startQuery} and {@link Scope.startQuery} operations.
 *
 * @category Query
 */
export interface StartQueryOptions {
  /**
   * Positional values to be used for the placeholders within the query.
   */
  positionalParameters?: any[]

  /**
   * Named values to be used for the placeholders within the query.
   */
  namedParameters?: { [key: string]: any }

  /**
   * Specifies the consistency requirements when executing the query.
   *
   * @see QueryScanConsistency
   */
  scanConsistency?: QueryScanConsistency

  /**
   * Indicates whether this query should be executed in read-only mode.
   */
  readOnly?: boolean

  /**
   * Specifies any additional parameters which should be passed to the query engine
   * when executing the query.
   */
  raw?: { [key: string]: any }

  /**
   * The timeout for this operation, represented in milliseconds.
   */
  timeout?: number

  /**
   * The returned client context id for this query.
   */
  clientContextId?: string

  /**
   * Specifies the maximum number of retries for this query. If unset, defaults to the cluster-level maxRetries.
   *
   * Volatile: This API is subject to change at any time.
   */
  maxRetries?: number

  /**
   * Sets an abort signal for the query allowing the operation to be canceled.
   */
  abortSignal?: AbortSignal
}

/**
 * Options for {@link QueryHandle.cancel}.
 *
 * @category Query
 */
export interface CancelOptions {}

/**
 * Options for {@link QueryHandle.fetchStatus}.
 *
 * @category Query
 */
export interface FetchStatusOptions {}

/**
 * Options for {@link QueryResultHandle.fetchResults}.
 */
export interface FetchResultsOptions {
  /**
   * Sets the deserializer used by {@link QueryResult.rows } to convert query result rows into objects.
   * If not specified, defaults to the cluster's default deserializer.
   */
  deserializer?: Deserializer
}

/**
 * Options for {@link QueryResultHandle.discardResults}.
 *
 * @category Query
 */
export interface DiscardResultsOptions {}

/**
 * Represents a handle to a server-side async query.
 * Provides methods to check status, and cancel the query.
 *
 * @category Query
 */
export class QueryHandle {
  private _handle: string
  private _requestId: string
  private _executor: AsyncQueryExecutor

  /**
   * @internal
   */
  constructor(executor: AsyncQueryExecutor, response: StartQueryResponse) {
    this._executor = executor
    this._requestId = response.requestID
    this._handle = response.handle
  }

  /**
   * Fetches the current status of the async query from the server.
   * Returns a {@link QueryStatus} describing the query's current state.
   *
   * @param _options The options to use for the fetchStatus operation.
   *
   * @throws {QueryNotFoundException} If the query is not found (404).
   * @throws {QueryError} If the server reports an error for the query.
   */
  async fetchStatus(_options?: FetchStatusOptions): Promise<QueryStatus> {
    const response = await this._executor.fetchStatus(this._handle)
    return new QueryStatus(this._executor, this._requestId, response)
  }

  /**
   * Cancels the async query on the server.
   * Does not throw if the query has already been canceled or discarded (404).
   *
   * @param _options The options to use for the cancel operation.
   */
  async cancel(_options?: CancelOptions): Promise<void> {
    return this._executor.cancelQuery(this._requestId)
  }
}

/**
 * Represents the status of a server-side async query.
 *
 * @category Query
 */
export class QueryStatus {
  private readonly _executor: AsyncQueryExecutor
  private readonly _requestId: string
  private readonly _raw: FetchStatusResponse

  /**
   * @internal
   */
  constructor(
    executor: AsyncQueryExecutor,
    requestId: string,
    raw: FetchStatusResponse
  ) {
    this._executor = executor
    this._requestId = requestId
    this._raw = raw
  }

  /**
   * Returns `true` if the query results are ready to be fetched.
   */
  resultsReady(): boolean {
    return typeof this._raw.handle === 'string' && this._raw.handle.length > 0
  }

  /**
   * Returns a {@link QueryResultHandle} for fetching the results of the completed query.
   *
   * @throws {OperationalInsightsError} If results are not yet ready (i.e. {@link QueryStatus.resultsReady} Returns `false`).
   */
  resultsHandle(): QueryResultHandle {
    if (!this._raw.handle) {
      throw new OperationalInsightsError('Results are not ready')
    }
    return new QueryResultHandle(
      this._executor,
      this._requestId,
      this._raw.handle
    )
  }

  /**
   * Returns a JSON string representation of the raw status response from the server.
   */
  toString(): string {
    return JSON.stringify(this._raw)
  }
}

/**
 * Represents a handle to fetch or discard the results of a completed async query.
 *
 * @category Query
 */
export class QueryResultHandle {
  private readonly _requestId: string
  private readonly _handle: string
  private _executor: AsyncQueryExecutor

  /**
   * @internal
   */
  constructor(executor: AsyncQueryExecutor, requestId: string, handle: string) {
    this._executor = executor
    this._requestId = requestId
    this._handle = handle
  }

  /**
   * Fetches the query results from the server.
   * Returns a {@link QueryResult} which provides a stream of rows.
   *
   * @param options The options to use for the fetchResults operation.
   *
   * @throws {QueryNotFoundException} If the results are not found (404).
   */
  async fetchResults(options?: FetchResultsOptions): Promise<QueryResult> {
    return this._executor.fetchResults(this._handle, options?.deserializer)
  }

  /**
   * Discards the query results on the server, freeing server-side resources.
   * Does not throw if the results have already been discarded or canceled (404).
   *
   * @param _options The options to use for the discardResults operation.
   */
  async discardResults(_options?: DiscardResultsOptions): Promise<void> {
    return this._executor.discardResults(this._handle)
  }
}
