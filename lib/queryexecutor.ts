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

import { Cluster } from './cluster.js'
import {
  QueryMetadata,
  QueryOptions,
  QueryResult,
  QueryResultStream,
  QueryScanConsistency,
} from './querytypes.js'
import * as http from 'node:http'
import stream_json from 'stream-json'
const { parser } = stream_json
import type { Parser } from 'stream-json'
import { pipeline } from 'node:stream'
import { runWithRetry } from './retries.js'
import { OperationalInsightsError } from './errors.js'
import {
  ConnectionError,
  HttpStatusError,
  InternalConnectionTimeout,
} from './internalerrors.js'
import { randomUUID } from 'node:crypto'
import { Deserializer } from './deserializers.js'
import { JsonTokenParserStream, PrimitiveFrame } from './jsonparser.js'
import * as https from 'node:https'
import { RequestContext } from './requestcontext.js'
import { ErrorHandler } from './errorhandler.js'
import { CouchbaseLogger } from './logger.js'

/**
 * @internal
 */
export class QueryExecutor {
  protected _cluster: Cluster
  protected _requestContext: RequestContext
  protected _databaseName: string | undefined
  protected _scopeName: string | undefined
  private _metadata: QueryMetadata | undefined
  private _deserializer: Deserializer
  private _abortController: AbortController
  protected _signal: AbortSignal
  protected _clientContextId: string | undefined

  /**
   * @internal
   */
  constructor(
    cluster: Cluster,
    deserializer: Deserializer,
    maxRetries: number,
    signal?: AbortSignal,
    databaseName?: string,
    scopeName?: string
  ) {
    this._cluster = cluster
    this._databaseName = databaseName
    this._scopeName = scopeName
    this._deserializer = deserializer
    this._requestContext = new RequestContext(maxRetries)
    this._abortController = new AbortController()
    this._signal = signal
      ? AbortSignal.any([this._abortController.signal, signal])
      : this._abortController.signal

    this._signal.addEventListener('abort', () => {
      CouchbaseLogger.debug(
        `Query was aborted. clientContextId=${this._clientContextId}`
      )
      this.handleAbort()
    })
  }

  /**
   * @internal
   */
  get metadata(): QueryMetadata | undefined {
    return this._metadata
  }

  /**
   * @internal
   */
  get deserializer(): Deserializer {
    return this._deserializer
  }

  /**
   * @internal
   */
  get requestContext(): RequestContext {
    return this._requestContext
  }

  /**
   * @internal
   */
  async query(statement: string, options: QueryOptions): Promise<QueryResult> {
    const deadline =
      Date.now() + (options.timeout || this._cluster.queryTimeout)

    this._requestContext.setGenericRequestContextFields(
      statement,
      '/api/v1/request',
      'POST'
    )
    const encodedOptions = this._buildQueryRequest(statement, options)
    const body = JSON.stringify(encodedOptions)

    return await runWithRetry(
      async () => {
        // Rebuild per attempt so a credential rotated mid-query takes effect
        // on the next retry, and so each attempt re-selects an A/AAAA record.
        const generic = await this._cluster.httpClient.requestOptions()
        const requestOptions: http.RequestOptions = {
          ...generic,
          method: 'POST',
          path: '/api/v1/request',
          headers: {
            ...generic.headers,
            'Content-Length': Buffer.byteLength(body),
            'Content-Type': 'application/json',
          },
        }
        return this._attemptQuery(requestOptions, body, deadline)
      },
      (errs) => ErrorHandler.handleErrors(errs, this._requestContext),
      deadline,
      this._requestContext
    )
  }

  /**
   * Attempts to execute a query.
   *
   * @internal
   */
  private async _attemptQuery(
    requestOptions: http.RequestOptions,
    body: string,
    deadline: number
  ): Promise<QueryResult> {
    return new Promise((resolve, reject) => {
      const abortHandler = () => {
        req.destroy()
        return reject(this._signal.reason)
      }

      this._signal.addEventListener('abort', abortHandler)

      const req = this._cluster.httpClient.module.request(
        requestOptions,
        (res) => {
          CouchbaseLogger.debug(
            `Received query response from ${requestOptions.host}:${requestOptions.port}. statusCode=${res.statusCode} clientContextId=${this._clientContextId}`
          )
          this._handleStreamingResponse(res, resolve, reject, deadline)
        }
      )

      req.once('close', () => {
        this._signal.removeEventListener('abort', abortHandler)
      })

      req.on('error', (err) => {
        CouchbaseLogger.error(
          `Error occurred while sending query request to ${requestOptions.host}:${requestOptions.port}, details: ${err.message}. clientContextId=${this._clientContextId}`
        )
        req.destroy()
        this._signal.removeEventListener('abort', abortHandler)
        reject(new ConnectionError(err, true))
      })

      req.on('connectTimeout', () => {
        CouchbaseLogger.error(
          `Connection timeout for query request to ${requestOptions.host}:${requestOptions.port}. clientContextId=${this._clientContextId}`
        )
        req.destroy()
        this._signal.removeEventListener('abort', abortHandler)
        reject(new InternalConnectionTimeout())
      })

      this._attachConnectTimeout(req)

      CouchbaseLogger.debug(
        `Sending request to ${requestOptions.host}:${requestOptions.port}. body=${body}. clientContextId=${this._clientContextId}`
      )

      req.write(body)
      req.end()
    })
  }

  protected _handleStreamingResponse(
    res: http.IncomingMessage,
    resolve: (value: QueryResult) => void,
    reject: (err: any) => void,
    deadline: number,
    deserializer?: Deserializer
  ): void {
    res.once('error', (err) => {
      CouchbaseLogger.error(
        `Error occurred while receiving query response from ${res.socket.remoteAddress}:${res.socket.remotePort}, details: ${err.message}. clientContextId=${this._clientContextId}`
      )
      res.destroy()
      return reject(new ConnectionError(err, false))
    })

    this._requestContext.updateGenericResContextFields(res)

    if (res.statusCode < 200 || res.statusCode >= 300) {
      return this._handleNonSuccessfulStatusCode(res, reject)
    }

    const jsonTokenizer: Parser = parser()
    const jsonTokenParser = new JsonTokenParserStream()
    const effectiveDeserializer = deserializer ?? this._deserializer
    const queryStream = new QueryResultStream(
      this,
      deadline,
      this._signal,
      effectiveDeserializer
    )

    jsonTokenizer.once('error', (err) => {
      res.destroy()
      reject(
        new OperationalInsightsError(
          this._requestContext.attachErrorContext(
            `Got an error parsing server JSON response, details: ${err.message}`
          )
        )
      )
    })

    queryStream.once('readable', () => {
      return resolve(new QueryResult(this, queryStream))
    })

    queryStream.once('end', () => {
      this._metadata = QueryMetadata.parse(
        (jsonTokenParser.stack.pop() as PrimitiveFrame).value
      )
    })

    jsonTokenParser.once('errorsComplete', (errors) => {
      if (errors.length) {
        CouchbaseLogger.error(
          `Server query errors received: ${JSON.stringify(errors)}. clientContextId=${this._clientContextId}`
        )
        res.destroy()
        queryStream.destroy()
        return reject(errors)
      }
    })

    pipeline(res, jsonTokenizer, jsonTokenParser, queryStream, (err) => {
      if (err)
        return reject(
          new OperationalInsightsError(
            this._requestContext.attachErrorContext(
              `Error occurred during query pipeline: ${err.message}`
            )
          )
        )
    })
  }

  protected _handleNonSuccessfulStatusCode(
    res: http.IncomingMessage,
    reject: (err: any) => void
  ): void {
    CouchbaseLogger.error(
      `Received non-successful status code from the server: ${res.statusCode}. clientContextId=${this._clientContextId}`
    )

    if (
      res.statusCode === 401 ||
      res.statusCode === 404 ||
      res.statusCode === 503
    ) {
      res.destroy()
      return reject(new HttpStatusError(res.statusCode))
    }

    let raw = ''
    res.on('data', (chunk) => (raw += chunk))
    res.on('end', () => {
      let parsed: any = null
      try {
        parsed = JSON.parse(raw)
      } catch (_e) {
        return reject(
          new OperationalInsightsError(
            this._requestContext.attachErrorContext(
              `Server returned HTTP ${res.statusCode} with a non-JSON body`
            )
          )
        )
      }

      if (parsed && parsed.errors && Array.isArray(parsed.errors)) {
        return reject(parsed.errors)
      }

      return reject(
        new OperationalInsightsError(
          this._requestContext.attachErrorContext(
            `Server returned HTTP ${res.statusCode} with no errors in body`
          )
        )
      )
    })
  }

  protected _attachConnectTimeout(req: http.ClientRequest): void {
    req.on('socket', (socket) => {
      if (!socket.connecting) {
        return
      }

      const timeoutMs = this._cluster.connectTimeout

      const timeoutId = setTimeout(() => {
        req.emit('connectTimeout')
      }, timeoutMs)

      const clear = () => clearTimeout(timeoutId)

      if (this._cluster.httpClient.module === https) {
        socket.once('secureConnect', clear)
      } else {
        socket.once('connect', clear)
      }

      socket.once('close', clear)
    })
  }

  /**
   * @internal
   */
  protected _buildQueryRequest(
    statement: string,
    options: QueryOptions
  ): BuiltQueryRequest {
    const opts: Partial<BuiltQueryRequest> = {
      statement: statement,
      client_context_id: options.clientContextId || randomUUID(),
    }
    this._clientContextId = opts.client_context_id

    if (this._databaseName && this._scopeName) {
      opts.query_context = `default:\`${this._databaseName}\`.\`${this._scopeName}\``
    }

    if (options.positionalParameters) {
      opts.args = options.positionalParameters
    }
    if (options.namedParameters) {
      for (const [origK, v] of Object.entries(options.namedParameters)) {
        const k = origK.startsWith('$') ? origK : `$${origK}`
        opts[k] = v
      }
    }
    if (options.readOnly !== undefined) {
      opts.readonly = options.readOnly
    }
    if (options.scanConsistency) {
      switch (options.scanConsistency) {
        case QueryScanConsistency.NotBounded:
          opts.scan_consistency = 'not_bounded'
          break
        case QueryScanConsistency.RequestPlus:
          opts.scan_consistency = 'request_plus'
          break
      }
    }
    const timeout = options.timeout || this._cluster.queryTimeout
    const serverTimeout = timeout + 5000
    opts.timeout = `${serverTimeout}ms`

    if (options.raw) {
      for (const [k, v] of Object.entries(options.raw)) {
        opts[k] = v
      }
    }

    return opts as BuiltQueryRequest
  }

  /**
   * @internal
   */
  handleAbort(): void {
    if (!this._signal.aborted) {
      this._abortController.abort()
    }
  }
}

/**
 * @internal
 */
export type BuiltQueryRequest = {
  statement: string
  client_context_id: string
  mode?: string
  query_context?: string
  args?: any[]
  readonly?: boolean
  scan_consistency?: 'not_bounded' | 'request_plus'
  timeout: string
  [key: string]: any // named params and raw options
}
