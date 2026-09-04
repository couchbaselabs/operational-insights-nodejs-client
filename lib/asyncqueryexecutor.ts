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

import { BuiltQueryRequest, QueryExecutor } from './queryexecutor.js'
import { QueryOptions, QueryResult, StartQueryOptions } from './querytypes.js'
import * as http from 'node:http'
import { runWithRetry } from './retries.js'
import { OperationalInsightsError } from './errors.js'
import { ConnectionError, InternalConnectionTimeout } from './internalerrors.js'
import { ErrorHandler } from './errorhandler.js'
import { CouchbaseLogger } from './logger.js'
import { Deserializer } from './deserializers.js'

/**
 * @internal
 */
export interface StartQueryResponse {
  /**
   * @internal
   */
  requestID: string
  /**
   * @internal
   */
  handle: string
}

/**
 * @internal
 */
export interface FetchStatusResponse {
  /** The handle path for fetching results. */
  handle?: string
  /** Any additional fields returned by the server. */
  [key: string]: unknown
}

/**
 * @internal
 */
export class AsyncQueryExecutor extends QueryExecutor {
  private _operationTimeout: number = 0

  /**
   * Starts an async query. Sends `mode: "async"` in the request body
   * and returns the raw server response containing the requestID and handle.
   *
   * @internal
   */
  async startQuery(
    statement: string,
    options: StartQueryOptions
  ): Promise<StartQueryResponse> {
    this._operationTimeout =
      options.timeout || this._cluster.handleRequestTimeout
    const deadline = Date.now() + this._operationTimeout

    this._requestContext.setGenericRequestContextFields(
      statement,
      '/api/v1/request',
      'POST'
    )

    const encodedOptions = this._buildAsyncRequestOptions(statement, options)
    const body = JSON.stringify(encodedOptions)

    return await runWithRetry(
      async () => {
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
        return this._attemptStartQuery(requestOptions, body)
      },
      (errs) => ErrorHandler.handleErrors(errs, this._requestContext),
      deadline,
      this._requestContext
    )
  }

  /**
   * @internal
   */
  async fetchStatus(statusHandle: string): Promise<FetchStatusResponse> {
    const deadline = Date.now() + this._operationTimeout

    this._requestContext.setGenericRequestContextFields('', statusHandle, 'GET')

    return await runWithRetry(
      async () => {
        const generic = await this._cluster.httpClient.requestOptions()
        const requestOptions: http.RequestOptions = {
          ...generic,
          method: 'GET',
          path: statusHandle,
          headers: { ...generic.headers, 'Content-Type': 'application/json' },
        }
        return this._attemptJsonRequest(requestOptions)
      },
      (errs) => ErrorHandler.handleErrors(errs, this._requestContext),
      deadline,
      this._requestContext
    )
  }

  /**
   * @internal
   */
  async cancelQuery(requestId: string): Promise<void> {
    const deadline = Date.now() + this._operationTimeout

    const path = '/api/v1/active_requests'
    this._requestContext.setGenericRequestContextFields('', path, 'DELETE')

    const body = `request_id=${encodeURIComponent(requestId)}`

    return await runWithRetry(
      async () => {
        const generic = await this._cluster.httpClient.requestOptions()
        const requestOptions: http.RequestOptions = {
          ...generic,
          method: 'DELETE',
          path: path,
          headers: {
            ...generic.headers,
            'Content-Length': Buffer.byteLength(body),
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
        return this._attemptCancelQuery(requestOptions, body)
      },
      (errs) => ErrorHandler.handleErrors(errs, this._requestContext),
      deadline,
      this._requestContext
    )
  }

  /**
   * @internal
   */
  async fetchResults(
    resultHandle: string,
    deserializer?: Deserializer
  ): Promise<QueryResult> {
    const deadline = Date.now() + this._operationTimeout

    this._requestContext.setGenericRequestContextFields('', resultHandle, 'GET')

    return await runWithRetry(
      async () => {
        const generic = await this._cluster.httpClient.requestOptions()
        const requestOptions: http.RequestOptions = {
          ...generic,
          method: 'GET',
          path: resultHandle,
          headers: { ...generic.headers, 'Content-Type': 'application/json' },
        }
        return this._attemptFetchResults(requestOptions, deadline, deserializer)
      },
      (errs) => ErrorHandler.handleErrors(errs, this._requestContext),
      deadline,
      this._requestContext
    )
  }

  /**
   * @internal
   */
  async discardResults(resultHandle: string): Promise<void> {
    const deadline = Date.now() + this._operationTimeout

    this._requestContext.setGenericRequestContextFields(
      '',
      resultHandle,
      'DELETE'
    )

    return await runWithRetry(
      async () => {
        const generic = await this._cluster.httpClient.requestOptions()
        const requestOptions: http.RequestOptions = {
          ...generic,
          method: 'DELETE',
          path: resultHandle,
          headers: { ...generic.headers, 'Content-Type': 'application/json' },
        }
        return this._attemptDiscardResults(requestOptions)
      },
      (errs) => ErrorHandler.handleErrors(errs, this._requestContext),
      deadline,
      this._requestContext
    )
  }

  private _attemptStartQuery(
    requestOptions: http.RequestOptions,
    body: string
  ): Promise<StartQueryResponse> {
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
            `Received startQuery response from ${requestOptions.host}:${requestOptions.port}. statusCode=${res.statusCode} clientContextId=${this._clientContextId}`
          )
          this._handleJsonResponse(res, resolve, reject, ['requestID', 'handle'])
        }
      )

      req.once('close', () =>
        this._signal.removeEventListener('abort', abortHandler)
      )

      req.on('error', (err) => {
        CouchbaseLogger.error(
          `Error sending startQuery request to ${requestOptions.host}:${requestOptions.port}, details: ${err.message}. clientContextId=${this._clientContextId}`
        )
        req.destroy()
        this._signal.removeEventListener('abort', abortHandler)
        reject(new ConnectionError(err, true))
      })

      req.on('connectTimeout', () => {
        CouchbaseLogger.error(
          `Connection timeout for startQuery request to ${requestOptions.host}:${requestOptions.port}. clientContextId=${this._clientContextId}`
        )
        req.destroy()
        this._signal.removeEventListener('abort', abortHandler)
        reject(new InternalConnectionTimeout())
      })

      this._attachConnectTimeout(req)

      CouchbaseLogger.debug(
        `Sending startQuery request to ${requestOptions.host}:${requestOptions.port}. body=${body}. clientContextId=${this._clientContextId}`
      )
      req.write(body)
      req.end()
    })
  }

  /**
   * @internal
   */
  private _buildAsyncRequestOptions(
    statement: string,
    options: QueryOptions
  ): BuiltQueryRequest {
    const requestOptions = this._buildQueryRequest(statement, options)
    requestOptions.mode = 'async'
    return requestOptions
  }

  private _attemptJsonRequest(
    requestOptions: http.RequestOptions
  ): Promise<any> {
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
            `Received response from ${requestOptions.host}:${requestOptions.port}. statusCode=${res.statusCode} path=${requestOptions.path} clientContextId=${this._clientContextId}`
          )
          this._handleJsonResponse(res, resolve, reject)
        }
      )

      req.once('close', () =>
        this._signal.removeEventListener('abort', abortHandler)
      )

      req.on('error', (err) => {
        CouchbaseLogger.error(
          `Error sending request to ${requestOptions.host}:${requestOptions.port}${requestOptions.path}, details: ${err.message}. clientContextId=${this._clientContextId}`
        )
        req.destroy()
        this._signal.removeEventListener('abort', abortHandler)
        reject(new ConnectionError(err, true))
      })

      req.on('connectTimeout', () => {
        req.destroy()
        this._signal.removeEventListener('abort', abortHandler)
        reject(new InternalConnectionTimeout())
      })

      this._attachConnectTimeout(req)
      req.end()
    })
  }

  private _attemptCancelQuery(
    requestOptions: http.RequestOptions,
    body: string
  ): Promise<void> {
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
            `Received cancelQuery response. statusCode=${res.statusCode} clientContextId=${this._clientContextId}`
          )
          this._handleCancelResponse(res, resolve, reject)
        }
      )

      req.once('close', () =>
        this._signal.removeEventListener('abort', abortHandler)
      )

      req.on('error', (err) => {
        req.destroy()
        this._signal.removeEventListener('abort', abortHandler)
        reject(new ConnectionError(err, true))
      })

      req.on('connectTimeout', () => {
        req.destroy()
        this._signal.removeEventListener('abort', abortHandler)
        reject(new InternalConnectionTimeout())
      })

      this._attachConnectTimeout(req)
      req.write(body)
      req.end()
    })
  }

  private _attemptFetchResults(
    requestOptions: http.RequestOptions,
    deadline: number,
    deserializer?: Deserializer
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
            `Received fetchResults response. statusCode=${res.statusCode} clientContextId=${this._clientContextId}`
          )
          this._handleStreamingResponse(
            res,
            resolve,
            reject,
            deadline,
            deserializer
          )
        }
      )

      req.once('close', () =>
        this._signal.removeEventListener('abort', abortHandler)
      )

      req.on('error', (err) => {
        req.destroy()
        this._signal.removeEventListener('abort', abortHandler)
        reject(new ConnectionError(err, true))
      })

      req.on('connectTimeout', () => {
        req.destroy()
        this._signal.removeEventListener('abort', abortHandler)
        reject(new InternalConnectionTimeout())
      })

      this._attachConnectTimeout(req)
      req.end()
    })
  }

  private _attemptDiscardResults(
    requestOptions: http.RequestOptions
  ): Promise<void> {
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
            `Received discardResults response. statusCode=${res.statusCode} clientContextId=${this._clientContextId}`
          )
          this._handleDiscardResponse(res, resolve, reject)
        }
      )

      req.once('close', () =>
        this._signal.removeEventListener('abort', abortHandler)
      )

      req.on('error', (err) => {
        req.destroy()
        this._signal.removeEventListener('abort', abortHandler)
        reject(new ConnectionError(err, true))
      })

      req.on('connectTimeout', () => {
        req.destroy()
        this._signal.removeEventListener('abort', abortHandler)
        reject(new InternalConnectionTimeout())
      })

      this._attachConnectTimeout(req)
      req.end()
    })
  }

  /**
   * @internal
   */
  private _handleJsonResponse<T>(
    res: http.IncomingMessage,
    resolve: (value: T) => void,
    reject: (err: any) => void,
    requiredKeys?: string[]
  ): void {
    res.once('error', (err) => {
      CouchbaseLogger.error(
        `Error receiving response, details: ${err.message}. clientContextId=${this._clientContextId}`
      )
      res.destroy()
      return reject(new ConnectionError(err, false))
    })

    this._requestContext.updateGenericResContextFields(res)

    if (res.statusCode < 200 || res.statusCode >= 300) {
      return this._handleNonSuccessfulStatusCode(res, reject)
    }

    let raw = ''
    res.on('data', (chunk) => (raw += chunk))
    res.on('end', () => {
      let parsed: any
      try {
        parsed = JSON.parse(raw)
      } catch (e) {
        return reject(
          new OperationalInsightsError(
            this._requestContext.attachErrorContext(
              `Failed to parse JSON response: ${(e as Error).message}`
            )
          )
        )
      }

      if (parsed.errors) {
        return reject(parsed.errors)
      }

      if (requiredKeys && requiredKeys.length > 0) {
        const missingFields = requiredKeys.filter(
          (key) => parsed[key] === undefined
        )
        if (missingFields.length > 0) {
          return reject(
            new OperationalInsightsError(
              this._requestContext.attachErrorContext(
                `Server response is missing required fields: ${missingFields.join(', ')}`
              )
            )
          )
        }
      }

      resolve(parsed)
    })
  }

  /**
   * @internal
   */
  private _handleCancelResponse(
    res: http.IncomingMessage,
    resolve: (value: void) => void,
    reject: (err: any) => void
  ): void {
    this._handleSuccessOrNotFoundResponse(res, resolve, reject)
  }

  /**
   * @internal
   */
  private _handleDiscardResponse(
    res: http.IncomingMessage,
    resolve: (value: void) => void,
    reject: (err: any) => void
  ): void {
    this._handleSuccessOrNotFoundResponse(res, resolve, reject)
  }

  /**
   * @internal
   */
  private _handleSuccessOrNotFoundResponse(
    res: http.IncomingMessage,
    resolve: (value: void) => void,
    reject: (err: any) => void
  ): void {
    this._requestContext.updateGenericResContextFields(res)

    // We treat 404 as successful in Discard/Cancel
    if (res.statusCode === 404) {
      res.resume()
      return resolve()
    }

    if (res.statusCode < 200 || res.statusCode >= 300) {
      return this._handleNonSuccessfulStatusCode(res, reject)
    }

    res.resume()
    resolve()
  }
}
