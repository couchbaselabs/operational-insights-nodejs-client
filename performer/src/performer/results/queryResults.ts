import { SdkUtils } from '../utils'
import { PerformerError } from '../errors'

import {
  QueryResultMetadataResponse as QueryResultMetadataResponsePb,
  QueryRowResponse as QueryRowResponsePb,
} from '../../proto/columnar.query_pb'
import { ContentWas as ContentWasPb } from '../../proto/columnar.serialization_pb'
import {
  NullValue as NullValuePb,
  Struct as StructPb,
} from 'google-protobuf/google/protobuf/struct_pb'
import RowPb = QueryRowResponsePb.Row
import QueryMetadataPb = QueryResultMetadataResponsePb.QueryMetadata
import QueryMetricsPb = QueryResultMetadataResponsePb.QueryMetadata.Metrics
import QueryWarningPb = QueryResultMetadataResponsePb.QueryMetadata.Warning

import { QueryMetadata, QueryMetrics } from 'couchbase-operational-insights'

export class SdkQueryCommandResult {
  static toQueryRow(row: any): RowPb {
    const result = new RowPb()
    const contentWas = new ContentWasPb()
    if (typeof row === 'undefined' || row === null) {
      contentWas.setContentWasNull(NullValuePb.NULL_VALUE)
    } else if (typeof row === 'object') {
      contentWas.setContentWasMap(StructPb.fromJavaScript(row))
    } else if (typeof row === 'string' || row instanceof String) {
      contentWas.setContentWasString(row as string)
    } else if (typeof row === 'boolean') {
      contentWas.setContentWasBoolean(row)
    } else if (typeof row === 'number') {
      if (Number.isInteger(row)) {
        contentWas.setContentWasInteger(row)
      } else {
        contentWas.setContentWasDouble(row)
      }
    } else {
      throw new PerformerError('Unexpected row type: ' + typeof row)
    }
    return result.setRowContent(contentWas)
  }

  static toQueryMetadata(metadata: QueryMetadata): QueryMetadataPb {
    const metadataPb = new QueryMetadataPb()
    metadataPb.setRequestId(metadata.requestId)
    metadataPb.setMetrics(this.toQueryMetrics(metadata.metrics))
    metadataPb.setWarningsList(
      metadata.warnings.map((w) => {
        const warning = new QueryWarningPb()
        warning.setCode(w.code)
        warning.setMessage(w.message)
        return warning
      })
    )
    return metadataPb
  }

  static toQueryMetrics(metrics: QueryMetrics): QueryMetricsPb {
    const metricsPb = new QueryMetricsPb()
    metricsPb.setElapsedTime(SdkUtils.millisToDuration(metrics.elapsedTime))
    metricsPb.setExecutionTime(SdkUtils.millisToDuration(metrics.executionTime))
    metricsPb.setResultCount(metrics.resultCount)
    metricsPb.setResultSize(metrics.resultSize)
    metricsPb.setProcessedObjects(metrics.processedObjects)
    return metricsPb
  }
}
