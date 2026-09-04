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

import { Agent as HttpAgent } from 'node:http'
import { Agent as HttpsAgent } from 'node:https'
import { isIP } from 'node:net'
import { OperationalInsightsError, InvalidArgumentError } from './errors.js'
import { ConnectionError } from './internalerrors.js'
import type { ClusterCredential } from './credential.js'
import { SecurityOptions } from './cluster.js'
import { Certificates } from './certificates.js'
import * as tls from 'node:tls'
import * as fs from 'fs'
import * as http from 'node:http'
import * as https from 'node:https'
import * as dns from 'node:dns'

/**
 * @internal
 */
export class HttpClient {
  private _agent: HttpAgent | HttpsAgent
  private _module: typeof http | typeof https
  private _credential: ClusterCredential
  private _hostname: string
  private _port: string
  private _securityOptions: SecurityOptions

  constructor(
    url: URL,
    credential: ClusterCredential,
    securityOptions: SecurityOptions
  ) {
    this._hostname = url.hostname
    this._credential = credential
    this._securityOptions = securityOptions

    if (url.protocol === 'http:') {
      if (credential.type === 'certificate') {
        throw new InvalidArgumentError(
          'Client-certificate authentication requires an https:// endpoint.'
        )
      }
      this._port = url.port ?? '80'
      this._module = http
    } else if (url.protocol === 'https:') {
      this._port = url.port ?? '443'
      this._module = https
    } else {
      throw new OperationalInsightsError(
        'Unsupported protocol provided in connection string'
      )
    }

    this._agent = this._buildAgent(credential)
  }

  /**
   * @internal
   */
  get module(): typeof http | typeof https {
    return this._module
  }

  /**
   * Returns the credential/agent/port portion of the request options, with the
   * current credential's `Authorization` header set. Does NOT resolve the host;
   * see {@link requestOptions} for the per-request target selection.
   *
   * @internal
   */
  genericRequestOptions(): http.RequestOptions {
    const opts: http.RequestOptions = {
      agent: this._agent,
      port: this._port,
    }
    if (this._credential.type !== 'certificate') {
      opts.headers = { Authorization: this._credential.authorizationHeader }
    }
    return opts
  }

  /**
   * Builds the options for a single request. Per the RFC, resolves the
   * hostname and picks a random A/AAAA record per request (so the keep-alive
   * agent does not pin to one node), connecting to that IP. The hostname is
   * kept for the TLS SNI `servername` (via the agent) and the `Host` header,
   * so cert verification and vhost routing are unaffected. An IP literal is
   * used as-is.
   *
   * @internal
   */
  async requestOptions(): Promise<http.RequestOptions> {
    const opts = this.genericRequestOptions()

    if (isIP(this._hostname) !== 0) {
      opts.host = this._hostname
      return opts
    }

    opts.host = await this._selectRequestAddress()
    opts.headers = {
      ...opts.headers,
      Host: `${this._hostname}:${this._port}`,
    }
    return opts
  }

  /**
   * Replace the credential used for subsequent requests. Cross-type
   * rotation throws `InvalidArgumentError`.
   *
   * @internal
   */
  setCredential(credential: ClusterCredential): void {
    if (credential.type !== this._credential.type) {
      throw new InvalidArgumentError(
        `Cannot switch credential type at runtime; current is '${this._credential.type}', new is '${credential.type}'.`
      )
    }
    this._credential = credential
    if (credential.type === 'certificate') {
      // Cert/key are baked into the agent's TLS context, so rotation needs
      // a fresh agent. Pooled keep-alive sockets on the old agent are dropped.
      const oldAgent = this._agent
      this._agent = this._buildAgent(credential)
      oldAgent.destroy()
    }
  }

  /**
   * @internal
   */
  close(): void {
    if (this._agent) {
      this._agent.destroy()
    }
  }

  private _buildAgent(credential: ClusterCredential): HttpAgent | HttpsAgent {
    if (this._module === http) {
      return new HttpAgent({
        keepAlive: true,
      })
    }
    const tlsOptions = this._buildTlsOptions()
    if (credential.type === 'certificate') {
      if (credential.pfx !== undefined) tlsOptions.pfx = credential.pfx
      if (credential.cert !== undefined) tlsOptions.cert = credential.cert
      if (credential.key !== undefined) tlsOptions.key = credential.key
      if (credential.passphrase !== undefined) {
        tlsOptions.passphrase = credential.passphrase
      }
    }
    return new HttpsAgent({
      keepAlive: true,
      ...tlsOptions,
    })
  }

  private _buildTlsOptions(): tls.ConnectionOptions {
    const securityOptions = this._securityOptions
    const tlsOptions: tls.ConnectionOptions = {}

    // Override the servername to use the hostname rather than the DNS record.
    // RFC 6066 forbids IP literals in SNI; skip when the host is an IP.
    if (isIP(this._hostname) === 0) {
      tlsOptions.servername = this._hostname
    }

    tlsOptions.minVersion = 'TLSv1.3'

    if (Object.keys(securityOptions).length === 0) {
      // By default, we trust the platform root certificates and the capella certs
      tlsOptions.ca = [
        ...tls.rootCertificates,
        ...Certificates.getCapellaCertificates(),
      ]
      return tlsOptions
    }

    if (securityOptions.trustOnlyCapella) {
      tlsOptions.ca = Certificates.getCapellaCertificates()
    }

    if (securityOptions.trustOnlyPemFile) {
      tlsOptions.ca = fs.readFileSync(securityOptions.trustOnlyPemFile)
    }

    if (securityOptions.trustOnlyPemString) {
      tlsOptions.ca = securityOptions.trustOnlyPemString
    }

    if (securityOptions.trustOnlyCertificates) {
      tlsOptions.ca = securityOptions.trustOnlyCertificates
    }

    if (securityOptions.disableServerCertificateVerification !== undefined) {
      tlsOptions.rejectUnauthorized =
        !securityOptions.disableServerCertificateVerification
    }

    return tlsOptions
  }

  /**
   * Resolves the hostname's A/AAAA records via `dns.lookup` (getaddrinfo) and
   * returns one at random. DNS-resolution failures are wrapped as a request-side
   * {@link ConnectionError} so they rejoin the retry path; we resolve before
   * `http.request`, so they would otherwise never reach its `error` event. An
   * empty result is treated like `ENOTFOUND`.
   *
   * @internal
   */
  private async _selectRequestAddress(): Promise<string> {
    let addresses: dns.LookupAddress[]
    try {
      addresses = await dns.promises.lookup(this._hostname, { all: true })
    } catch (err) {
      throw new ConnectionError(err as Error, true)
    }
    if (addresses.length === 0) {
      const noRecords = new Error(
        `No addresses found for ${this._hostname}`
      ) as NodeJS.ErrnoException
      noRecords.code = 'ENOTFOUND'
      throw new ConnectionError(noRecords, true)
    }
    return addresses[Math.floor(Math.random() * addresses.length)].address
  }

  /**
   * @internal
   */
  get hostname(): string {
    return this._hostname
  }
}
