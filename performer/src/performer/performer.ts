import {
  sendUnaryData,
  Server,
  ServerCredentials,
  ServerUnaryCall,
  UntypedHandleCall,
} from '@grpc/grpc-js'
import { SdkUtils } from './utils'
import { ErrorUtils, PerformerError } from './errors'
import { PerformerRegistry } from './registry'
import { Query } from './commands/query'
import { AsyncQuery } from './commands/asyncQuery'

import {
  ColumnarCrossServiceService,
  ColumnarServiceService,
} from '../proto/columnar.services_grpc_pb'
import {
  CloseAllQueryResultsRequest as CloseAllQueryResultsRequestPb,
  CloseQueryResultRequest as CloseQueryResultRequestPb,
  ExecuteQueryRequest as ExecuteQueryRequestPb,
  ExecuteQueryResponse as ExecuteQueryResponsePb,
  QueryCancelRequest as QueryCancelRequestPb,
  QueryMetadataRequest as QueryMetadataRequestPb,
  QueryResultMetadataResponse as QueryResultMetadataResponsePb,
  QueryResultRequest as QueryResultRequestPb,
  QueryRowRequest as QueryRowRequestPb,
  QueryRowResponse as QueryRowResponsePb,
  StartQueryRequest as StartQueryRequestPb,
  StartQueryResponse as StartQueryResponsePb,
  AsyncFetchStatusRequest as AsyncFetchStatusRequestPb,
  AsyncFetchStatusResponse as AsyncFetchStatusResponsePb,
  AsyncCancelHandleRequest as AsyncCancelHandleRequestPb,
  AsyncFetchResultsRequest as AsyncFetchResultsRequestPb,
  AsyncDiscardResultsRequest as AsyncDiscardResultsRequestPb,
  AsyncQueryStatusResultHandleRequest as AsyncQueryStatusResultHandleRequestPb,
} from '../proto/columnar.query_pb'
import { EmptyResultOrFailureResponse as EmptyResultOrFailureResponsePb } from '../proto/columnar.result_pb'
import {
  CloseAllColumnarClustersRequest as CloseAllColumnarClustersRequestPb,
  ClusterCloseRequest as ClusterCloseRequestPb,
  ClusterNewInstanceRequest as ClusterNewInstanceRequestPb,
  SetCredentialRequest as SetCredentialRequestPb,
} from '../proto/columnar.cluster_management_pb'
import {
  EchoRequest as EchoRequestPb,
  EchoResponse as EchoResponsePb,
} from '../proto/shared.echo_pb'
import {
  AnalyticsProduct,
  CredentialSupport as CredentialSupportPb,
  FetchPerformerCapsRequest as FetchPerformerCapsRequestPb,
  FetchPerformerCapsResponse as FetchPerformerCapsResponsePb,
  PerApiElementClusterClose as PerApiElementClusterClosePb,
  PerApiElementClusterNewInstance as PerApiElementClusterNewInstancePb,
  PerApiElementExecuteQuery as PerApiElementExecuteQueryPb,
  SDK as SDKPb,
  SdkConnectionError as SdkConnectionErrorPb,
} from '../proto/columnar.caps_pb'
import {
  ExecutionContextClusterLevel as ExecutionContextClusterLevelPb,
  ExecutionContextScopeLevel as ExecutionContextScopeLevelPb,
} from '../proto/columnar.execution_context_pb'

import {
  createInstance,
  Cluster,
  Scope,
  JsonDeserializer,
  PassthroughDeserializer,
  FetchResultsOptions,
} from 'couchbase-operational-insights'
import { v4 as uuidv4 } from 'uuid'
import { SdkCommandQueryOptions } from './options/queryOptions'
import { Deserializer as DeserializerPb } from '../proto/columnar.serialization_pb'
import { ResponseMetadata } from '../proto/columnar.metadata_pb'
import ExecuteQueryReturnsPb = PerApiElementExecuteQueryPb.ExecuteQueryReturns
import RowIterationPb = PerApiElementExecuteQueryPb.RowIteration
import RowDeserializationPb = PerApiElementExecuteQueryPb.RowDeserialization
import CredentialPb = ClusterNewInstanceRequestPb.Credential

const registry = new PerformerRegistry()

class ColumnarCrossService {
  [name: string]: UntypedHandleCall

  closeAllQueryResults(
    call: ServerUnaryCall<
      CloseAllQueryResultsRequestPb,
      EmptyResultOrFailureResponsePb
    >,
    callback: sendUnaryData<EmptyResultOrFailureResponsePb>
  ): void {
    console.info('closeAllQueryResults called')
    const returnResult = new EmptyResultOrFailureResponsePb()
    try {
      registry.query.unregisterAllQueries()
      registry.query.unregisterAllAsyncQueries()
      callback(null, returnResult.setEmptySuccess(true))
    } catch (e: any) {
      ErrorUtils.handleNonSdkError(e, callback)
    }
  }

  closeQueryResult(
    call: ServerUnaryCall<
      CloseQueryResultRequestPb,
      EmptyResultOrFailureResponsePb
    >,
    callback: sendUnaryData<EmptyResultOrFailureResponsePb>
  ): void {
    console.info('closeQueryResult called')
    const returnResult = new EmptyResultOrFailureResponsePb()
    try {
      registry.query.unregisterQuery(call.request.getQueryHandle())
      callback(null, returnResult.setEmptySuccess(true))
    } catch (e: any) {
      ErrorUtils.handleNonSdkError(e, callback)
    }
  }

  executeQuery(
    call: ServerUnaryCall<ExecuteQueryRequestPb, ExecuteQueryResponsePb>,
    callback: sendUnaryData<ExecuteQueryResponsePb>
  ): void {
    console.info('executeQuery called')
    const initiated = SdkUtils.getInitiated()
    try {
      let connectionId
      if (call.request.hasClusterLevel()) {
        const clusterLevel =
          call.request.getClusterLevel() as ExecutionContextClusterLevelPb
        connectionId = clusterLevel.getClusterId()
      } else {
        const scopeLevel =
          call.request.getScopeLevel() as ExecutionContextScopeLevelPb
        connectionId = scopeLevel.getClusterId()
      }
      const reqConnection = registry.connection.getConnection(connectionId)
      const query = new Query(call.request, reqConnection)
      registry.query.registerQuery(query.handle, query)
      const resp = query.execute()
      resp.setMetadata(new ResponseMetadata().setInitiated(initiated))
      callback(null, resp)
    } catch (e: any) {
      ErrorUtils.handleNonSdkError(e, callback)
    }
  }

  queryCancel(
    call: ServerUnaryCall<QueryCancelRequestPb, EmptyResultOrFailureResponsePb>,
    callback: sendUnaryData<EmptyResultOrFailureResponsePb>
  ): void {
    console.info('queryCancel called')
    const returnResult = new EmptyResultOrFailureResponsePb()
    const initiated = SdkUtils.getInitiated()
    try {
      const query = registry.query.getQuery(call.request.getQueryHandle())
      query.cancel()
      callback(
        null,
        returnResult
          .setEmptySuccess(true)
          .setMetadata(new ResponseMetadata().setInitiated(initiated))
      )
    } catch (e: any) {
      ErrorUtils.handleNonSdkError(e, callback)
    }
  }

  queryMetadata(
    call: ServerUnaryCall<
      QueryMetadataRequestPb,
      QueryResultMetadataResponsePb
    >,
    callback: sendUnaryData<QueryResultMetadataResponsePb>
  ): void {
    console.info('queryMetadata called')
    const initiated = SdkUtils.getInitiated()
    try {
      const query = registry.query.getQuery(call.request.getQueryHandle())
      const metadataResult = query.metadata()
      metadataResult.setMetadata(new ResponseMetadata().setInitiated(initiated))
      callback(null, metadataResult)
    } catch (e: any) {
      ErrorUtils.handleNonSdkError(e, callback)
    }
  }

  queryResult(
    call: ServerUnaryCall<QueryResultRequestPb, EmptyResultOrFailureResponsePb>,
    callback: sendUnaryData<EmptyResultOrFailureResponsePb>
  ): void {
    console.info('queryResult called')
    const returnResult = new EmptyResultOrFailureResponsePb()
    const initiated = SdkUtils.getInitiated()
    try {
      const query = registry.query.getQuery(call.request.getQueryHandle())
      query
        .result()
        .then(() => {
          callback(
            null,
            returnResult
              .setEmptySuccess(true)
              .setMetadata(new ResponseMetadata().setInitiated(initiated))
          )
        })
        .catch((err) => {
          callback(
            null,
            returnResult
              .setError(ErrorUtils.toProtoError(err))
              .setMetadata(new ResponseMetadata().setInitiated(initiated))
          )
        })
    } catch (e: any) {
      ErrorUtils.handleNonSdkError(e, callback)
    }
  }

  queryRow(
    call: ServerUnaryCall<QueryRowRequestPb, QueryRowResponsePb>,
    callback: sendUnaryData<QueryRowResponsePb>
  ): void {
    console.info('queryRow called')
    const initiated = SdkUtils.getInitiated()
    try {
      const query = registry.query.getQuery(call.request.getQueryHandle())
      query.row((err, response) => {
        if (err) {
          callback(err, null)
          return
        }
        if (response) {
          response.setMetadata(new ResponseMetadata().setInitiated(initiated))
        }
        callback(null, response)
      }, false)
    } catch (e: any) {
      ErrorUtils.handleNonSdkError(e, callback)
    }
  }

  startQuery(
    call: ServerUnaryCall<StartQueryRequestPb, StartQueryResponsePb>,
    callback: sendUnaryData<StartQueryResponsePb>
  ): void {
    console.info('startQuery called')
    const response = new StartQueryResponsePb()
    try {
      let connectionId: string
      let queryTarget: Cluster | Scope
      if (call.request.hasClusterLevel()) {
        const clusterLevel =
          call.request.getClusterLevel() as ExecutionContextClusterLevelPb
        connectionId = clusterLevel.getClusterId()
        queryTarget = registry.connection.getConnection(connectionId)
      } else {
        const scopeLevel =
          call.request.getScopeLevel() as ExecutionContextScopeLevelPb
        connectionId = scopeLevel.getClusterId()
        const cluster = registry.connection.getConnection(connectionId)
        queryTarget = cluster
          .database(scopeLevel.getDatabaseName())
          .scope(scopeLevel.getScopeName())
      }

      const statement = call.request.getStatement()
      const opts = SdkCommandQueryOptions.toSdkStartQueryOptions(
        call.request.getOptions()
      )

      queryTarget
        .startQuery(statement, opts)
        .then((queryHandle) => {
          const handleId = uuidv4()
          const asyncQuery = new AsyncQuery(queryHandle)
          registry.query.registerQuery(handleId, asyncQuery)
          callback(null, response.setQueryHandle(handleId))
        })
        .catch((err) => {
          console.log('Got an error in startQuery: ', err)
          callback(null, response.setFailure(ErrorUtils.toProtoError(err)))
        })
    } catch (e: any) {
      ErrorUtils.handleNonSdkError(e, callback)
    }
  }

  asyncFetchStatus(
    call: ServerUnaryCall<
      AsyncFetchStatusRequestPb,
      AsyncFetchStatusResponsePb
    >,
    callback: sendUnaryData<AsyncFetchStatusResponsePb>
  ): void {
    console.info('asyncFetchStatus called')
    const response = new AsyncFetchStatusResponsePb()
    try {
      const queryHandleId = call.request.getQueryHandle()
      const asyncQuery = registry.query.getQuery(queryHandleId)

      asyncQuery
        .fetchStatus()
        .then((queryStatus) => {
          const queryStatusPb =
            new AsyncFetchStatusResponsePb.QueryStatusResult()
          queryStatusPb.setResultsReady(queryStatus.resultsReady)
          queryStatusPb.setToString(queryStatus.toString)
          response.setQueryStatus(queryStatusPb)
          callback(null, response)
        })
        .catch((err) => {
          console.log('Got an error in fetchStatus: ', err)
          response.setFailure(ErrorUtils.toProtoError(err))
          callback(null, response)
        })
    } catch (e: any) {
      ErrorUtils.handleNonSdkError(e, callback)
    }
  }

  asyncQueryStatusResultHandle(
    call: ServerUnaryCall<
      AsyncQueryStatusResultHandleRequestPb,
      EmptyResultOrFailureResponsePb
    >,
    callback: sendUnaryData<EmptyResultOrFailureResponsePb>
  ): void {
    console.info('asyncQueryStatusResultHandle called')
    const returnResult = new EmptyResultOrFailureResponsePb()
    const initiated = SdkUtils.getInitiated()
    try {
      const queryHandleId = call.request.getQueryHandle()
      const asyncQuery = registry.query.getQuery(queryHandleId)

      try {
        asyncQuery.statusResultHandle()
        callback(
          null,
          returnResult
            .setEmptySuccess(true)
            .setMetadata(new ResponseMetadata().setInitiated(initiated))
        )
      } catch (err: any) {
        callback(
          null,
          returnResult
            .setError(ErrorUtils.toProtoError(err))
            .setMetadata(new ResponseMetadata().setInitiated(initiated))
        )
      }
    } catch (e: any) {
      ErrorUtils.handleNonSdkError(e, callback)
    }
  }

  asyncCancelHandle(
    call: ServerUnaryCall<
      AsyncCancelHandleRequestPb,
      EmptyResultOrFailureResponsePb
    >,
    callback: sendUnaryData<EmptyResultOrFailureResponsePb>
  ): void {
    console.info('asyncCancelHandle called')
    const returnResult = new EmptyResultOrFailureResponsePb()
    const initiated = SdkUtils.getInitiated()
    try {
      const asyncQuery = registry.query.getQuery(call.request.getQueryHandle())
      asyncQuery
        .cancelHandle()
        .then(() => {
          callback(
            null,
            returnResult
              .setEmptySuccess(true)
              .setMetadata(new ResponseMetadata().setInitiated(initiated))
          )
        })
        .catch((err) => {
          callback(
            null,
            returnResult
              .setError(ErrorUtils.toProtoError(err))
              .setMetadata(new ResponseMetadata().setInitiated(initiated))
          )
        })
    } catch (e: any) {
      ErrorUtils.handleNonSdkError(e, callback)
    }
  }

  asyncFetchResults(
    call: ServerUnaryCall<
      AsyncFetchResultsRequestPb,
      EmptyResultOrFailureResponsePb
    >,
    callback: sendUnaryData<EmptyResultOrFailureResponsePb>
  ): void {
    console.info('asyncFetchResults called')
    const returnResult = new EmptyResultOrFailureResponsePb()
    const initiated = SdkUtils.getInitiated()
    try {
      const handleId = call.request.getQueryHandle()
      const asyncQuery = registry.query.getQuery(handleId)

      const fetchOpts: FetchResultsOptions = {}
      if (call.request.hasOptions()) {
        const options =
          call.request.getOptions() as AsyncFetchResultsRequestPb.Options
        if (options.hasDeserializer()) {
          const deserializer = options.getDeserializer() as DeserializerPb
          if (deserializer.hasJson()) {
            fetchOpts.deserializer = new JsonDeserializer()
          } else if (deserializer.hasPassthrough()) {
            fetchOpts.deserializer = new PassthroughDeserializer()
          }
        }
      }

      asyncQuery
        .fetchResults(fetchOpts)
        .then(() => {
          callback(
            null,
            returnResult
              .setEmptySuccess(true)
              .setMetadata(new ResponseMetadata().setInitiated(initiated))
          )
        })
        .catch((err) => {
          callback(
            null,
            returnResult
              .setError(ErrorUtils.toProtoError(err))
              .setMetadata(new ResponseMetadata().setInitiated(initiated))
          )
        })
    } catch (e: any) {
      ErrorUtils.handleNonSdkError(e, callback)
    }
  }

  asyncDiscardResults(
    call: ServerUnaryCall<
      AsyncDiscardResultsRequestPb,
      EmptyResultOrFailureResponsePb
    >,
    callback: sendUnaryData<EmptyResultOrFailureResponsePb>
  ): void {
    console.info('asyncDiscardResults called')
    const returnResult = new EmptyResultOrFailureResponsePb()
    const initiated = SdkUtils.getInitiated()
    try {
      const handleId = call.request.getQueryHandle()
      const asyncQuery = registry.query.getQuery(handleId)

      asyncQuery
        .discardResults()
        .then(() => {
          callback(
            null,
            returnResult
              .setEmptySuccess(true)
              .setMetadata(new ResponseMetadata().setInitiated(initiated))
          )
        })
        .catch((err) => {
          callback(
            null,
            returnResult
              .setError(ErrorUtils.toProtoError(err))
              .setMetadata(new ResponseMetadata().setInitiated(initiated))
          )
        })
    } catch (e: any) {
      ErrorUtils.handleNonSdkError(e, callback)
    }
  }
}

class ColumnarService {
  [name: string]: UntypedHandleCall

  closeAllClusters(
    call: ServerUnaryCall<
      CloseAllColumnarClustersRequestPb,
      EmptyResultOrFailureResponsePb
    >,
    callback: sendUnaryData<EmptyResultOrFailureResponsePb>
  ): void {
    console.info('closeAllClusters called')
    const returnResult = new EmptyResultOrFailureResponsePb()
    registry.connection
      .unregisterAllConnections()
      .then(() => {
        returnResult.setEmptySuccess(true)
        callback(null, returnResult)
      })
      .catch((e: any) => {
        ErrorUtils.handleNonSdkError(e, callback)
      })
  }

  clusterClose(
    call: ServerUnaryCall<
      ClusterCloseRequestPb,
      EmptyResultOrFailureResponsePb
    >,
    callback: sendUnaryData<EmptyResultOrFailureResponsePb>
  ): void {
    console.info('clusterClose called')
    const returnResult = new EmptyResultOrFailureResponsePb()
    const executionContext =
      call.request.getExecutionContext() as ExecutionContextClusterLevelPb
    const connectionId = executionContext.getClusterId()
    registry.connection
      .unregisterConnection(connectionId)
      .then(() => {
        returnResult.setEmptySuccess(true)
        callback(null, returnResult)
      })
      .catch((e: any) => {
        ErrorUtils.handleNonSdkError(e, callback)
      })
  }

  clusterNewInstance(
    call: ServerUnaryCall<
      ClusterNewInstanceRequestPb,
      EmptyResultOrFailureResponsePb
    >,
    callback: sendUnaryData<EmptyResultOrFailureResponsePb>
  ): void {
    console.info('clusterNewInstance called')
    const returnResult = new EmptyResultOrFailureResponsePb()
    try {
      const connString = call.request.getConnectionString()
      const credential = SdkUtils.getCredential(
        call.request.getCredential() as CredentialPb
      )
      const opts = SdkUtils.connectionOptions(call.request.getOptions())
      const connection = createInstance(connString, credential, opts)
      registry.connection.registerConnection(
        call.request.getClusterConnectionId(),
        connection
      )
      returnResult.setEmptySuccess(true)
      callback(null, returnResult)
    } catch (e: any) {
      if (e instanceof PerformerError) {
        callback(e.grpcError(), null)
      } else {
        callback(null, returnResult.setError(ErrorUtils.toProtoError(e)))
      }
    }
  }

  setCredential(
    call: ServerUnaryCall<
      SetCredentialRequestPb,
      EmptyResultOrFailureResponsePb
    >,
    callback: sendUnaryData<EmptyResultOrFailureResponsePb>
  ): void {
    console.info('setCredential called')
    const returnResult = new EmptyResultOrFailureResponsePb()
    const executionContext =
      call.request.getExecutionContext() as ExecutionContextClusterLevelPb
    const connectionId = executionContext.getClusterId()
    try {
      const cluster = registry.connection.getConnection(connectionId)
      cluster.setCredential(
        SdkUtils.getCredential(call.request.getCredential() as CredentialPb)
      )
      returnResult.setEmptySuccess(true)
      callback(null, returnResult)
    } catch (e: any) {
      if (e instanceof PerformerError) {
        callback(e.grpcError(), null)
      } else {
        callback(null, returnResult.setError(ErrorUtils.toProtoError(e)))
      }
    }
  }

  echo(
    call: ServerUnaryCall<EchoRequestPb, EchoResponsePb>,
    callback: sendUnaryData<EchoResponsePb>
  ): void {
    console.info(
      '================ ' +
        call.request.getTestname() +
        ' : ' +
        call.request.getMessage() +
        ' ================ '
    )
    callback(null, new EchoResponsePb())
  }

  fetchPerformerCaps(
    call: ServerUnaryCall<
      FetchPerformerCapsRequestPb,
      FetchPerformerCapsResponsePb
    >,
    callback: sendUnaryData<FetchPerformerCapsResponsePb>
  ): void {
    console.info('fetchPerformerCaps called')
    const returnResult = new FetchPerformerCapsResponsePb()

    returnResult.setSdk(SDKPb.SDK_NODE)
    returnResult.setSdkVersion('1.1.0') // TODO get version programmatically
    returnResult.setAnalyticsProduct(AnalyticsProduct.ANALYTICS)
    const credentialSupport = new CredentialSupportPb()
    credentialSupport
      .setSupportsCertificateCredential(true)
      .setSupportsJwtCredential(true)
      .setSupportsSetCredential(true)
    returnResult.setCredentialSupport(credentialSupport)

    returnResult
      .getClusterNewInstanceMap()
      .set(0, new PerApiElementClusterNewInstancePb())
    returnResult.getClusterCloseMap().set(0, new PerApiElementClusterClosePb())

    const perApiExecuteQuery = new PerApiElementExecuteQueryPb()
    perApiExecuteQuery.setExecuteQueryReturns(
      ExecuteQueryReturnsPb.EXECUTE_QUERY_RETURNS_QUERY_RESULT
    )
    perApiExecuteQuery.setRowIteration(
      RowIterationPb.ROW_ITERATION_STREAMING_ITERATOR_BASED
    )
    perApiExecuteQuery.setRowDeserialization(
      RowDeserializationPb.ROW_DESERIALIZATION_DYNAMIC_ROW_TYPING
    )
    perApiExecuteQuery.setSupportsPassthroughDeserializer(true)

    returnResult.getClusterExecuteQueryMap().set(0, perApiExecuteQuery)
    returnResult.getScopeExecuteQueryMap().set(0, perApiExecuteQuery)

    const sdkConnectionError = new SdkConnectionErrorPb()
    sdkConnectionError.setInvalidCredErrorType(
      SdkConnectionErrorPb.InvalidCredentialErrorType
        .AS_INVALID_CREDENTIAL_EXCEPTION
    )
    sdkConnectionError.setBootstrapErrorType(
      SdkConnectionErrorPb.BootstrapErrorType.AS_COLUMNAR_ERROR
    )

    returnResult.getSdkConnectionErrorMap().set(0, sdkConnectionError)
    // [if:1.1.0]
    returnResult.setSupportsServerAsyncQueries(true)
    // [end]

    callback(null, returnResult)
  }
}

if (require.main === module) {
  const port = '8060'
  const server = new Server()
  server.addService(ColumnarServiceService, new ColumnarService())
  server.addService(ColumnarCrossServiceService, new ColumnarCrossService())
  server.bindAsync(
    '0.0.0.0:' + port,
    ServerCredentials.createInsecure(),
    (err, port) => {
      if (err) {
        throw err
      }
      console.log(`Listening on ${port}`)
    }
  )
}
