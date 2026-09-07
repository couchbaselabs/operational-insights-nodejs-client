import { SdkUtils } from '../utils'
import { NotImplementedError } from '../errors'

import {
  ExecuteQueryRequest as ExecuteQueryRequestPb,
  StartQueryRequest as StartQueryRequestPb,
} from '../../proto/columnar.query_pb'
import { ListValue, Struct } from 'google-protobuf/google/protobuf/struct_pb'
import { Duration } from 'google-protobuf/google/protobuf/duration_pb'
import { Deserializer as DeserializerPb } from '../../proto/columnar.serialization_pb'
import QueryOptionsPb = ExecuteQueryRequestPb.Options
import ScanConsistencyPb = ExecuteQueryRequestPb.Options.ScanConsistency
import StartQueryOptionsPb = StartQueryRequestPb.Options
import StartQueryScanConsistencyPb = StartQueryRequestPb.Options.ScanConsistency

import {
  QueryOptions,
  QueryScanConsistency,
  JsonDeserializer,
  PassthroughDeserializer,
  StartQueryOptions,
} from 'couchbase-operational-insights'

export class SdkCommandQueryOptions {
  static toSdkQueryOptions(options?: QueryOptionsPb): QueryOptions {
    const opts: QueryOptions = {}
    if (!options) return opts

    if (options.hasScanConsistency()) {
      if (
        options.getScanConsistency() ==
        ScanConsistencyPb.SCAN_CONSISTENCY_NOT_BOUNDED
      ) {
        opts.scanConsistency = QueryScanConsistency.NotBounded
      } else if (
        options.getScanConsistency() ==
        ScanConsistencyPb.SCAN_CONSISTENCY_REQUEST_PLUS
      ) {
        opts.scanConsistency = QueryScanConsistency.RequestPlus
      }
    }

    if (options.hasPriority()) {
      throw new NotImplementedError(
        'Query priority is currently unimplemented in the Operational Insights SDK'
      )
    }

    if (options.hasParametersPositional()) {
      const params = options.getParametersPositional() as ListValue
      opts.positionalParameters = params.toJavaScript()
    }

    if (options.hasParametersNamed()) {
      const params = options.getParametersNamed() as Struct
      opts.namedParameters = params.toJavaScript()
    }

    if (options.hasReadonly()) {
      opts.readOnly = options.getReadonly()
    }

    if (options.hasRaw()) {
      const raw = options.getRaw() as Struct
      opts.raw = raw.toJavaScript()
    }

    if (options.hasTimeout()) {
      opts.timeout = SdkUtils.durationToMillis(options.getTimeout() as Duration)
    }

    if (options.hasDeserializer()) {
      const deserializer = options.getDeserializer() as DeserializerPb
      if (deserializer.hasJson()) {
        opts.deserializer = new JsonDeserializer()
      }
      if (deserializer.hasPassthrough()) {
        opts.deserializer = new PassthroughDeserializer()
      }
    }

    if (options.hasMaxRetries()) {
      opts.maxRetries = options.getMaxRetries()
    }
    return opts
  }

  static toSdkStartQueryOptions(
    options?: StartQueryOptionsPb
  ): StartQueryOptions {
    const opts: StartQueryOptions = {}
    if (!options) return opts

    if (options.hasScanConsistency()) {
      if (
        options.getScanConsistency() ==
        StartQueryScanConsistencyPb.SCAN_CONSISTENCY_NOT_BOUNDED
      ) {
        opts.scanConsistency = QueryScanConsistency.NotBounded
      } else if (
        options.getScanConsistency() ==
        StartQueryScanConsistencyPb.SCAN_CONSISTENCY_REQUEST_PLUS
      ) {
        opts.scanConsistency = QueryScanConsistency.RequestPlus
      }
    }

    if (options.hasParametersPositional()) {
      const params = options.getParametersPositional() as ListValue
      opts.positionalParameters = params.toJavaScript()
    }

    if (options.hasParametersNamed()) {
      const params = options.getParametersNamed() as Struct
      opts.namedParameters = params.toJavaScript()
    }

    if (options.hasReadonly()) {
      opts.readOnly = options.getReadonly()
    }

    if (options.hasRaw()) {
      const raw = options.getRaw() as Struct
      opts.raw = raw.toJavaScript()
    }

    if (options.hasTimeout()) {
      opts.timeout = SdkUtils.durationToMillis(options.getTimeout() as Duration)
    }

    if (options.hasMaxRetries()) {
      opts.maxRetries = options.getMaxRetries()
    }
    return opts
  }
}
