/*
 *  Copyright 2016-2026. Couchbase, Inc.
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

import { assert } from 'chai'
import * as dns from 'node:dns'
import * as http from 'node:http'
import { AddressInfo } from 'node:net'
import { Credential, createInstance } from '../lib/operationalinsights.js'
import { ConnectionError } from '../lib/internalerrors.js'

// Per the RFC, each request MUST use a random selection from the hostname's
// A/AAAA records rather than reusing the same record over and over, while the
// original hostname is preserved for TLS verification and the Host header.
describe('#Host selection', function () {
  const HOSTNAME = 'my.cluster.example.com'
  const PORT = 18095
  const realLookup = dns.promises.lookup

  // Stub dns.promises.lookup (shared builtin) so address selection is
  // deterministic and offline. HttpClient resolves via this per request.
  function stubLookup(addresses: dns.LookupAddress[] | (() => never)): void {
    ;(dns.promises as { lookup: unknown }).lookup = async () => {
      if (typeof addresses === 'function') return addresses()
      return addresses
    }
  }

  afterEach(function () {
    ;(dns.promises as { lookup: unknown }).lookup = realLookup
  })

  it('selects a random A/AAAA record per request (no pinning)', async function () {
    stubLookup([
      { address: '10.0.0.1', family: 4 },
      { address: '10.0.0.2', family: 4 },
    ])
    const cluster = createInstance(
      `https://${HOSTNAME}:${PORT}`,
      new Credential('u', 'p'),
      { securityOptions: { disableServerCertificateVerification: true } }
    )
    try {
      const seen = new Set<string>()
      for (let i = 0; i < 50; i++) {
        const opts = await cluster.httpClient.requestOptions()
        seen.add(opts.host as string)
      }
      // Over 50 requests gives solid odds that both records have been used
      assert.sameMembers([...seen], ['10.0.0.1', '10.0.0.2'])
    } finally {
      cluster.close()
    }
  })

  it('connects to the resolved IP but keeps the hostname for the Host header', async function () {
    stubLookup([{ address: '10.1.2.3', family: 4 }])
    const cluster = createInstance(
      `https://${HOSTNAME}:${PORT}`,
      new Credential('Administrator', 'password'),
      { securityOptions: { disableServerCertificateVerification: true } }
    )
    try {
      const opts = await cluster.httpClient.requestOptions()
      // TCP target is the resolved IP...
      assert.strictEqual(opts.host, '10.1.2.3')
      // ...but the Host header (vhost routing) stays the original hostname.
      const headers = opts.headers as Record<string, string>
      assert.strictEqual(headers.Host, `${HOSTNAME}:${PORT}`)
      // ...and the Authorization header is preserved alongside it.
      assert.strictEqual(
        headers.Authorization,
        'Basic ' + Buffer.from('Administrator:password').toString('base64')
      )
    } finally {
      cluster.close()
    }
  })

  it('uses an IP-literal endpoint as-is without resolving DNS', async function () {
    // If DNS were consulted for an IP literal this stub would throw.
    stubLookup(() => {
      throw new Error('dns.lookup must not be called for an IP literal')
    })
    const cluster = createInstance(
      `https://10.9.8.7:${PORT}`,
      new Credential('u', 'p'),
      { securityOptions: { disableServerCertificateVerification: true } }
    )
    try {
      const opts = await cluster.httpClient.requestOptions()
      assert.strictEqual(opts.host, '10.9.8.7')
      // No Host-header override for an IP literal (RFC 6066: no SNI/vhost name).
      const headers = (opts.headers ?? {}) as Record<string, string>
      assert.isUndefined(headers.Host)
    } finally {
      cluster.close()
    }
  })

  it('wraps a no-records DNS result as a request-side ConnectionError', async function () {
    // An empty result is a DNS failure, so it is wrapped as a request-side
    // ConnectionError carrying ENOTFOUND, rejoining the request error path.
    // Whether that code retries is decided separately by ErrorHandler.
    stubLookup([])
    const cluster = createInstance(
      `https://${HOSTNAME}:${PORT}`,
      new Credential('u', 'p'),
      { securityOptions: { disableServerCertificateVerification: true } }
    )
    try {
      let caught: unknown
      try {
        await cluster.httpClient.requestOptions()
      } catch (e) {
        caught = e
      }
      assert.instanceOf(caught, ConnectionError)
      const err = caught as ConnectionError
      assert.isTrue(err.isRequestError)
      assert.strictEqual((err.cause as NodeJS.ErrnoException).code, 'ENOTFOUND')
    } finally {
      cluster.close()
    }
  })

  it('wraps a DNS-resolution failure as a request-side ConnectionError', async function () {
    // e.g. a transient resolver failure during a rebalance.
    stubLookup(() => {
      const e = new Error('getaddrinfo EAI_AGAIN') as NodeJS.ErrnoException
      e.code = 'EAI_AGAIN'
      throw e
    })
    const cluster = createInstance(
      `https://${HOSTNAME}:${PORT}`,
      new Credential('u', 'p'),
      { securityOptions: { disableServerCertificateVerification: true } }
    )
    try {
      let caught: unknown
      try {
        await cluster.httpClient.requestOptions()
      } catch (e) {
        caught = e
      }
      assert.instanceOf(caught, ConnectionError)
      const err = caught as ConnectionError
      // isRequestError + the original code is what ErrorHandler uses to classify the failure.
      assert.isTrue(err.isRequestError)
      assert.strictEqual((err.cause as NodeJS.ErrnoException).code, 'EAI_AGAIN')
    } finally {
      cluster.close()
    }
  })

  it('sends the Host header as the hostname (not the IP) on the actual request', async function () {
    // End-to-end: drive a real request through the executor and capture what
    // arrives at the server. DNS is stubbed to 127.0.0.1 where the server runs,
    // so the client connects to the IP but must send Host: <hostname>:<port>.
    this.timeout(10000)
    let capturedHost: string | undefined
    const server = http.createServer((req) => {
      capturedHost = req.headers.host
      req.socket.destroy()
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port

    stubLookup([{ address: '127.0.0.1', family: 4 }])
    const cluster = createInstance(
      `http://${HOSTNAME}:${port}`,
      new Credential('u', 'p')
    )
    try {
      await cluster
        .executeQuery('SELECT 1', { maxRetries: 0, timeout: 2000 })
        .catch(() => undefined)
      assert.strictEqual(capturedHost, `${HOSTNAME}:${port}`)
    } finally {
      cluster.close()
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      )
    }
  })
})
