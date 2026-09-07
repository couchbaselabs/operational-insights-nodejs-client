import { sendUnaryData } from '@grpc/grpc-js'
import {
  QueryResultMetadataResponse as QueryResultMetadataResponsePb,
  QueryRowResponse as QueryRowResponsePb,
} from '../../proto/columnar.query_pb'

/**
 * Unified interface for all entries in the QueryRegistry.
 *
 * Every implementation supports all methods — unsupported operations throw PerformerError.
 */
export interface RegisteredQuery {
  // Row iteration
  row(
    callback: sendUnaryData<QueryRowResponsePb>,
    callbackCalled: boolean
  ): void
  metadata(): QueryResultMetadataResponsePb

  // Regular query lifecycle
  result(): Promise<void>
  cancel(): void

  // Async query lifecycle
  fetchStatus(): Promise<{ resultsReady: boolean; toString: string }>
  statusResultHandle(): void
  cancelHandle(): Promise<void>
  fetchResults(opts: { deserializer?: any }): Promise<void>
  discardResults(): Promise<void>

  // Resource cleanup — release any underlying stream/result.
  close(): void
}
