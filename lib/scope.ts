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

import { Database } from './database.js'
import { Cluster } from './cluster.js'
import {
  QueryOptions,
  QueryResult,
  QueryHandle,
  StartQueryOptions,
} from './querytypes.js'
import { QueryExecutor } from './queryexecutor.js'
import { AsyncQueryExecutor } from './asyncqueryexecutor.js'
import { InvalidArgumentError } from './errors.js'

/**
 * Volatile: This API is subject to change at any time.
 *
 * Exposes the operations which are available to be performed against a scope.
 * Namely, the ability to access to Collections for performing operations.
 *
 * @category Core
 */
export class Scope {
  private _database: Database
  private _name: string

  /**
     @internal
     */
  constructor(database: Database, scopeName: string) {
    this._database = database
    this._name = scopeName
  }

  /**
     @internal
     */
  get database(): Database {
    return this._database
  }

  /**
     @internal
     */
  get cluster(): Cluster {
    return this._database.cluster
  }

  /**
   * Executes a query against the Operational Insights scope.
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
      throw new Error('timeout must be non-negative.')
    }

    const exec = new QueryExecutor(
      this.cluster,
      options.deserializer || this.cluster.deserializer,
      options.maxRetries || this.cluster.maxRetries,
      options.abortSignal,
      this._database.name,
      this._name
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
      throw new InvalidArgumentError('timeout must be non-negative.')
    }

    const exec = new AsyncQueryExecutor(
      this.cluster,
      this.cluster.deserializer,
      options.maxRetries || this.cluster.maxRetries,
      options.abortSignal,
      this._database.name,
      this._name
    )
    const response = await exec.startQuery(statement, options)
    return new QueryHandle(exec, response)
  }

  /**
   * The name of the scope this Scope object references.
   */
  get name(): string {
    return this._name
  }
}
