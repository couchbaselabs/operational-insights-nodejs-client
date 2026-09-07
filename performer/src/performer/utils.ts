import { NotImplementedError } from './errors'

import { ClusterNewInstanceRequest as ClusterNewInstanceRequestPb } from '../proto/columnar.cluster_management_pb'
import { Duration as DurationPb } from 'google-protobuf/google/protobuf/duration_pb'
import { Deserializer as DeserializerPb } from '../proto/columnar.serialization_pb'
import CredentialPb = ClusterNewInstanceRequestPb.Credential
import ConnectionOptionsPb = ClusterNewInstanceRequestPb.Options
import UsernameAndPassword = ClusterNewInstanceRequestPb.Credential.UsernameAndPassword
import TimeoutOptionsPb = ClusterNewInstanceRequestPb.Options.TimeoutOptions
import SecurityOptionsPb = ClusterNewInstanceRequestPb.Options.SecurityOptions

import {
  CertificateCredential,
  ClusterOptions,
  Credential,
  type ClusterCredential,
  JsonDeserializer,
  JwtCredential,
  PassthroughDeserializer,
  SecurityOptions,
  TimeoutOptions,
} from 'couchbase-operational-insights'
import { Timestamp } from 'google-protobuf/google/protobuf/timestamp_pb'

export class SdkUtils {
  static getCredential(credentialPb: CredentialPb): ClusterCredential {
    if (credentialPb.hasUsernameAndPassword()) {
      const credentials =
        credentialPb.getUsernameAndPassword() as UsernameAndPassword
      return new Credential(
        credentials.getUsername(),
        credentials.getPassword()
      )
    } else if (credentialPb.hasJwtAuth()) {
      const jwtAuth = credentialPb.getJwtAuth()
      if (!jwtAuth) {
        throw new Error('Missing expected JwtAuth.')
      }
      return new JwtCredential(jwtAuth.getJwt())
    } else if (credentialPb.hasCertificateAuth()) {
      const certAuth = credentialPb.getCertificateAuth()
      if (!certAuth) {
        throw new Error('Missing expected CertificateAuth.')
      }
      return new CertificateCredential({
        cert: certAuth.getCert(),
        key: certAuth.getKey(),
      })
    }

    throw new NotImplementedError(
      'Unrecognised credential type ' + credentialPb.toString()
    )
  }

  static connectionOptions(
    connectionOptionsPb: ConnectionOptionsPb | undefined
  ): ClusterOptions {
    const opts: ClusterOptions = {}

    if (!connectionOptionsPb) {
      return opts
    }

    if (connectionOptionsPb.hasDeserializer()) {
      const deserializer =
        connectionOptionsPb.getDeserializer() as DeserializerPb
      if (deserializer.hasJson()) {
        opts.deserializer = new JsonDeserializer()
      } else if (deserializer.hasPassthrough()) {
        opts.deserializer = new PassthroughDeserializer()
      } else {
        throw new NotImplementedError(
          'Unrecognized deserializer type: ' + deserializer.toString()
        )
      }
    }

    if (connectionOptionsPb.hasTimeout()) {
      const timeout = connectionOptionsPb.getTimeout() as TimeoutOptionsPb
      const timeoutOpts: TimeoutOptions = {}

      if (timeout.hasConnectTimeout()) {
        timeoutOpts.connectTimeout = this.durationToMillis(
          timeout.getConnectTimeout() as DurationPb
        )
      }
      if (timeout.hasQueryTimeout()) {
        timeoutOpts.queryTimeout = this.durationToMillis(
          timeout.getQueryTimeout() as DurationPb
        )
      }
      opts.timeoutOptions = timeoutOpts
    }

    if (connectionOptionsPb.hasSecurity()) {
      const security = connectionOptionsPb.getSecurity() as SecurityOptionsPb
      const securityOpts: SecurityOptions = {}

      if (security.hasTrustOnlyCapella()) {
        securityOpts.trustOnlyCapella = security.getTrustOnlyCapella()
      }
      if (security.hasTrustOnlyPemString()) {
        securityOpts.trustOnlyPemString = security.getTrustOnlyPemString()
      }
      if (security.hasDisableServerCertificateVerification()) {
        securityOpts.disableServerCertificateVerification =
          security.getDisableServerCertificateVerification()
      }
      if (security.getCipherSuitesList().length > 0) {
        throw new NotImplementedError(
          'The Node SDK does not support TLS cipher suites'
        )
      }
      opts.securityOptions = securityOpts
    }

    if (connectionOptionsPb.hasMaxRetries()) {
      opts.maxRetries = connectionOptionsPb.getMaxRetries()
    }
    return opts
  }

  static durationToMillis(
    duration: DurationPb | undefined
  ): number | undefined {
    if (!duration) {
      return duration
    }
    const seconds = duration.getSeconds()
    const nanos = duration.getNanos()
    const millisFromSeconds = seconds * 1000
    const millisFromNanos = nanos / 1_000_000
    return millisFromSeconds + millisFromNanos
  }

  static millisToDuration(millis: number): DurationPb {
    const duration = new DurationPb()
    const seconds = Math.floor(millis / 1000)
    const nanos = Math.round((millis % 1000) * 1_000_000)
    duration.setSeconds(seconds)
    duration.setNanos(nanos)
    return duration
  }

  static getInitiated(): Timestamp {
    const timeMS = Date.now()
    const initiated = new Timestamp()
    initiated.setSeconds(Math.round(timeMS / 1000))
    initiated.setNanos((timeMS % 1000) * 1e6)
    return initiated
  }
}
