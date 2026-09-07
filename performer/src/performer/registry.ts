import { PerformerError } from './errors'
import { RegisteredQuery } from './commands/registeredQuery'
import { AsyncQuery } from './commands/asyncQuery'

import { Cluster } from 'couchbase-operational-insights'

export class ConnectionRegistry {
  private _connections: { [connectionId: string]: Cluster } = {}

  getConnection(connectionId: string): Cluster {
    if (connectionId in this._connections) {
      return this._connections[connectionId]
    }
    throw new PerformerError(`Connection ${connectionId} does not exist`)
  }

  registerConnection(connectionId: string, connection: Cluster): void {
    if (!(connectionId in this._connections)) {
      this._connections[connectionId] = connection
    }
  }

  async unregisterConnection(connectionId: string): Promise<void> {
    if (connectionId in this._connections) {
      await this._connections[connectionId].close()
      delete this._connections[connectionId]
      return
    }
    throw new PerformerError(`Connection ${connectionId} does not exist`)
  }

  async unregisterAllConnections(): Promise<void> {
    const connectionIds = Object.keys(this._connections)
    for (const connectionId of connectionIds) {
      await this.unregisterConnection(connectionId)
    }
  }
}

export class QueryRegistry {
  private _queries: { [queryHandle: string]: RegisteredQuery } = {}

  getQuery(queryHandle: string): RegisteredQuery {
    if (queryHandle in this._queries) {
      return this._queries[queryHandle]
    }
    throw new PerformerError(`Query with handle ${queryHandle} does not exist`)
  }

  registerQuery(queryHandle: string, query: RegisteredQuery): void {
    if (!(queryHandle in this._queries)) {
      this._queries[queryHandle] = query
    }
  }

  unregisterQuery(queryHandle: string): void {
    if (queryHandle in this._queries) {
      this._queries[queryHandle].close()
      delete this._queries[queryHandle]
      return
    }
    throw new PerformerError(`Query with handle ${queryHandle} does not exist`)
  }

  unregisterAllQueries(): void {
    for (const handle of Object.keys(this._queries)) {
      if (!(this._queries[handle] instanceof AsyncQuery)) {
        this._queries[handle].close()
        delete this._queries[handle]
      }
    }
  }

  unregisterAllAsyncQueries(): void {
    for (const handle of Object.keys(this._queries)) {
      if (this._queries[handle] instanceof AsyncQuery) {
        this._queries[handle].close()
        delete this._queries[handle]
      }
    }
  }
}

export class PerformerRegistry {
  private readonly _connectionRegistry: ConnectionRegistry
  private readonly _queryRegistry: QueryRegistry

  constructor() {
    this._connectionRegistry = new ConnectionRegistry()
    this._queryRegistry = new QueryRegistry()
  }

  get connection(): ConnectionRegistry {
    return this._connectionRegistry
  }

  get query(): QueryRegistry {
    return this._queryRegistry
  }
}
