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

import {
  CertificateCredential,
  type ClusterCredential,
  Credential,
  JwtCredential,
} from './credential.js'
import { Database } from './database.js'
import { Deserializer, JsonDeserializer } from './deserializers.js'
import {
  QueryOptions,
  QueryResult,
  QueryHandle,
  StartQueryOptions,
} from './querytypes.js'
import { QueryExecutor } from './queryexecutor.js'
import { AsyncQueryExecutor } from './asyncqueryexecutor.js'
import { HttpClient } from './httpclient.js'
import { InvalidArgumentError } from './errors.js'
import { ConnSpec } from './connspec.js'
import {
  CouchbaseLogger,
  LOG_LEVELS,
  Logger,
  NOOP_LOGGER,
  LogLevel,
  createConsoleLogger,
} from './logger.js'
import { ParsingUtilities } from './utilities.js'

/**
 * Specifies the timeout options for the client.
 *
 * @category Core
 */
export interface TimeoutOptions {
  /**
   * Specifies the default timeout allocated to complete bootstrap connection, specified in millseconds.
   */
  connectTimeout?: number

  /**
   * Specifies the default timeout for query operations, specified in millseconds.
   */
  queryTimeout?: number

  /**
   * Specifies the default timeout for server async API handle requests, specified in milliseconds.
   */
  handleRequestTimeout?: number
}

/**
 * Specifies security options for the client.
 *
 * @category Core
 */
export interface SecurityOptions {
  /**
   * Specifies the SDK will only trust the Capella CA certificate(s).
   */
  trustOnlyCapella?: boolean

  /**
   * Specifies the SDK will only trust the PEM-encoded certificate(s)
   * at the specified file path.
   */
  trustOnlyPemFile?: string

  /**
   * Specifies the SDK will only trust the PEM-encoded certificate(s)
   * in the specified string.
   */
  trustOnlyPemString?: string

  /**
   * Specifies the SDK will only trust the PEM-encoded certificate(s)
   * specified.
   */
  trustOnlyCertificates?: string[]

  /**
   * If disabled, SDK will trust any certificate regardless of validity.
   * Should not be disabled in production environments.
   */
  disableServerCertificateVerification?: boolean
}

/**
 * Specifies the options which can be specified when connecting
 * to a cluster.
 *
 * @category Core
 */
export interface ClusterOptions {
  /**
   * Specifies the security options for connections of this cluster.
   */
  securityOptions?: SecurityOptions

  /**
   * Specifies the default timeouts for various operations performed by the SDK.
   */
  timeoutOptions?: TimeoutOptions

  /**
   * Sets the default deserializer for converting query result rows into objects.
   * If not specified, the SDK uses an instance of the default {@link JsonDeserializer}.
   *
   * Can also be set per-operation with {@link QueryOptions.deserializer}.
   */
  deserializer?: Deserializer

  /**
   * Specifies the default maximum number of retries for operations performed by the SDK. Defaults to 7.
   *
   * Volatile: This API is subject to change at any time.
   */
  maxRetries?: number

  /**
   * Provides an implementation of the {@link Logger} interface to be used by the SDK.
   */
  logger?: Logger
}

/**
 * Exposes the operations which are available to be performed against a cluster.
 * Namely, the ability to access to Databases as well as performing management
 * operations against the cluster.
 *
 * @category Core
 */
export class Cluster {
  private _queryTimeout: number
  private _connectTimeout: number
  private _handleRequestTimeout: number
  private _httpClient: HttpClient
  private _maxRetries: number
  private _deserializer: Deserializer

  /**
     @internal
     */
  get queryTimeout(): number {
    return this._queryTimeout
  }

  /**
     @internal
     */
  get connectTimeout(): number {
    return this._connectTimeout
  }

  /**
   * @internal
   */
  get handleRequestTimeout(): number {
    return this._handleRequestTimeout
  }

  /**
   * @internal
   */
  get maxRetries(): number {
    return this._maxRetries
  }

  /**
     @internal
     */
  get deserializer(): Deserializer {
    return this._deserializer
  }

  /**
   * @internal
   */
  get httpClient(): HttpClient {
    return this._httpClient
  }

  /**
     @internal
     */
  private constructor(
    httpEndpoint: string,
    credential: ClusterCredential,
    options?: ClusterOptions
  ) {
    if (!options) {
      options = {}
    }
    this._validateCredential(credential)

    if (!options.logger) {
      const envLogLevel = (
        process.env.NCBOILOGLEVEL || ''
      ).toLowerCase() as LogLevel

      options.logger = LOG_LEVELS.includes(envLogLevel)
        ? createConsoleLogger(envLogLevel)
        : NOOP_LOGGER
    }
    CouchbaseLogger.set(options.logger)

    const url = new URL(httpEndpoint)
    const connStrParams = ConnSpec.getConnStringParams(url)

    if (!options.timeoutOptions) {
      options.timeoutOptions = {}
    }

    if (connStrParams['timeout.connect_timeout']) {
      options.timeoutOptions.connectTimeout =
        ParsingUtilities.parseGolangSyntaxDuration(
          connStrParams['timeout.connect_timeout']
        )
    }

    if (connStrParams['timeout.query_timeout']) {
      options.timeoutOptions.queryTimeout =
        ParsingUtilities.parseGolangSyntaxDuration(
          connStrParams['timeout.query_timeout']
        )
    }

    if (connStrParams['timeout.handle_request_timeout']) {
      options.timeoutOptions.handleRequestTimeout =
        ParsingUtilities.parseGolangSyntaxDuration(
          connStrParams['timeout.handle_request_timeout']
        )
    }

    this._validateTimeoutOptions(options.timeoutOptions)

    if (!options.securityOptions) {
      options.securityOptions = {}
    }

    if (connStrParams['security.trust_only_pem_file']) {
      options.securityOptions.trustOnlyPemFile =
        connStrParams['security.trust_only_pem_file']
    }

    if (connStrParams['security.disable_server_certificate_verification']) {
      options.securityOptions.disableServerCertificateVerification =
        ConnSpec.parseBoolean(
          connStrParams['security.disable_server_certificate_verification']
        )
    }

    this._validateSecurityOptions(options.securityOptions)

    this._queryTimeout = options.timeoutOptions.queryTimeout || 600_000
    this._connectTimeout = options.timeoutOptions.connectTimeout || 10_000
    this._handleRequestTimeout =
      options.timeoutOptions.handleRequestTimeout || 10_000
    this._deserializer = options.deserializer || new JsonDeserializer()
    this._maxRetries = options.maxRetries || 7
    this._httpClient = new HttpClient(
      url,
      credential,
      options.securityOptions
    )
  }

  /**
   * Entry point for creating a new cluster object.
   *
   * @param httpEndpoint The HTTP endpoint of the cluster.
   * @param credential The credential to use for authenticating with the cluster.
   * @param options Options to configure the cluster connection and global settings.
   */
  static createInstance(
    httpEndpoint: string,
    credential: ClusterCredential,
    options?: ClusterOptions
  ): Cluster {
    return new Cluster(httpEndpoint, credential, options)
  }

  /**
   * Volatile: This API is subject to change at any time.
   *
   * Creates a database object reference to a specific database.
   *
   * @param databaseName The name of the database to reference.
   */
  database(databaseName: string): Database {
    return new Database(this, databaseName)
  }

  /**
   * Executes a query against the Operational Insights cluster.
   *
   * @param statement The Operational Insights SQL++ statement to execute.
   * @param options Optional parameters for this operation.
   */
  executeQuery(
    statement: string,
    options?: QueryOptions
  ): Promise<QueryResult> {
    if (!options) {
      options = {}
    }

    if (options.timeout && options.timeout < 0) {
      throw new InvalidArgumentError('timeout must be non-negative.')
    }

    const exec = new QueryExecutor(
      this,
      options.deserializer || this._deserializer,
      options.maxRetries || this._maxRetries,
      options.abortSignal
    )
    return exec.query(statement, options)
  }

  /**
   * Starts an asynchronous query against the Operational Insights cluster.
   * Returns a {@link QueryHandle} that can be used to fetch results, and
   * cancel the query.
   *
   * @param statement The Operational Insights SQL++ statement to execute.
   * @param options Optional parameters for this operation.
   */
  async startQuery(
    statement: string,
    options?: StartQueryOptions
  ): Promise<QueryHandle> {
    if (!options) {
      options = {}
    }

    if (options.timeout && options.timeout < 0) {
      throw new InvalidArgumentError('timeout must be non-negative')
    }

    const exec = new AsyncQueryExecutor(
      this,
      this._deserializer,
      options.maxRetries || this._maxRetries,
      options.abortSignal
    )
    const response = await exec.startQuery(statement, options)
    return new QueryHandle(exec, response)
  }

  /**
   * Replace the credential used for subsequent HTTP requests, for example to
   * refresh a JWT or rotate a client certificate. The new credential must be
   * the same kind as the current one and takes effect on the next request.
   *
   * @param credential The new credential to use.
   * @throws {InvalidArgumentError} If `credential` is null/undefined or is a
   *   different kind than the current credential.
   */
  setCredential(credential: ClusterCredential): void {
    this._validateCredential(credential)
    this._httpClient.setCredential(credential)
  }

  /**
   * Shuts down this cluster object.  Cleaning up all resources associated with it.
   *
   */
  close(): void {
    this._httpClient.close()
  }

  /**
   * @internal
   */
  private _validateCredential(credential: ClusterCredential): void {
    if (credential == null) {
      throw new InvalidArgumentError('credential must not be null/undefined.')
    }
    if (
      !(credential instanceof Credential) &&
      !(credential instanceof JwtCredential) &&
      !(credential instanceof CertificateCredential)
    ) {
      throw new InvalidArgumentError(
        'credential must be a Credential, JwtCredential, or CertificateCredential.'
      )
    }
  }

  /**
   * @internal
   */
  private _validateTimeoutOptions(timeoutOptions: TimeoutOptions): void {
    if (timeoutOptions.connectTimeout && timeoutOptions.connectTimeout < 0) {
      throw new Error('connectTimeout must be non-negative.')
    }

    if (timeoutOptions.queryTimeout && timeoutOptions.queryTimeout < 0) {
      throw new Error('queryTimeout must be non-negative')
    }

    if (
      timeoutOptions.handleRequestTimeout &&
      timeoutOptions.handleRequestTimeout < 0
    ) {
      throw new Error('handleRequestTimeout must be non-negative')
    }
  }

  private _validateSecurityOptions(securityOptions: SecurityOptions): void {
    const trustOptionsCount =
      (securityOptions.trustOnlyCapella ? 1 : 0) +
      (securityOptions.trustOnlyPemFile ? 1 : 0) +
      (securityOptions.trustOnlyPemString ? 1 : 0) +
      (securityOptions.trustOnlyCertificates ? 1 : 0)

    if (trustOptionsCount > 1) {
      throw new InvalidArgumentError(
        'Only one of trustOnlyCapella, trustOnlyPemFile, trustOnlyPemString, or trustOnlyCertificates can be set.'
      )
    }
  }
}
