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

import { assert } from 'chai'
import * as http from 'node:http'
import { AddressInfo } from 'node:net'
import {
  CertificateCredential,
  Credential,
  JwtCredential,
  createInstance,
  type ClusterCredential,
} from '../lib/operationalinsights.js'
import { InvalidArgumentError } from '../lib/errors.js'

const SAMPLE_JWT = 'header.payload.signature'

const DUMMY_PFX = Buffer.from('dummy-pkcs12-bytes')
const DUMMY_PASSPHRASE = 'test'

describe('#Credential', function () {
  describe('Password', function () {
    it('constructor builds a Basic header', function () {
      const cred = new Credential('Administrator', 'password')
      assert.strictEqual(cred.username, 'Administrator')
      assert.strictEqual(cred.password, 'password')
      assert.strictEqual(
        cred.authorizationHeader,
        'Basic ' + Buffer.from('Administrator:password').toString('base64')
      )
    })

    it('rejects undefined username/password (no silent broken credential)', function () {
      assert.throws(
        () =>
          new Credential(
            undefined as unknown as string,
            undefined as unknown as string
          ),
        InvalidArgumentError
      )
    })
  })

  describe('JWT', function () {
    it('constructor builds a Bearer header', function () {
      const cred = new JwtCredential(SAMPLE_JWT)
      assert.strictEqual(cred.authorizationHeader, `Bearer ${SAMPLE_JWT}`)
    })

    it('rejects an empty token', function () {
      assert.throws(() => new JwtCredential(''), InvalidArgumentError)
    })

    it('rejects a non-string token', function () {
      assert.throws(
        () => new JwtCredential(1234 as unknown as string),
        InvalidArgumentError
      )
    })

  })

  describe('Certificate (mTLS)', function () {
    it('constructor accepts a PKCS#12 Buffer', function () {
      const cred = new CertificateCredential({
        pfx: DUMMY_PFX,
        passphrase: DUMMY_PASSPHRASE,
      })
      assert.strictEqual(cred.type, 'certificate')
      assert.strictEqual(cred.pfx, DUMMY_PFX)
      assert.strictEqual(cred.passphrase, DUMMY_PASSPHRASE)
      assert.isUndefined(cred.cert)
      assert.isUndefined(cred.key)
    })

    it('constructor accepts PEM cert and key', function () {
      const cert = 'CERT-PEM'
      const key = 'KEY-PEM'
      const cred = new CertificateCredential({ cert, key })
      assert.strictEqual(cred.type, 'certificate')
      assert.strictEqual(cred.cert, cert)
      assert.strictEqual(cred.key, key)
      assert.isUndefined(cred.pfx)
    })

    it('rejects supplying both pfx and cert+key', function () {
      assert.throws(
        () =>
          new CertificateCredential({
            pfx: DUMMY_PFX,
            cert: 'C',
            key: 'K',
          }),
        InvalidArgumentError
      )
    })

    it('rejects supplying neither pfx nor cert+key', function () {
      assert.throws(() => new CertificateCredential({}), InvalidArgumentError)
    })

    it('rejects cert without key', function () {
      assert.throws(
        () => new CertificateCredential({ cert: 'C' }),
        InvalidArgumentError
      )
    })

    it('rejects key without cert', function () {
      assert.throws(
        () => new CertificateCredential({ key: 'K' }),
        InvalidArgumentError
      )
    })

    it('rejects pfx alongside cert', function () {
      assert.throws(
        () => new CertificateCredential({ pfx: DUMMY_PFX, cert: 'C' }),
        InvalidArgumentError
      )
    })

    it('rejects pfx alongside key', function () {
      assert.throws(
        () => new CertificateCredential({ pfx: DUMMY_PFX, key: 'K' }),
        InvalidArgumentError
      )
    })

    it('rejects a non-Buffer pfx', function () {
      assert.throws(
        () =>
          new CertificateCredential({
            pfx: 'not a buffer' as unknown as Buffer,
          }),
        InvalidArgumentError
      )
    })

    it('rejects a non-string/non-Buffer cert', function () {
      assert.throws(
        () =>
          new CertificateCredential({
            cert: 42 as unknown as string,
            key: 'K',
          }),
        InvalidArgumentError
      )
    })

    it('rejects a non-string/non-Buffer key', function () {
      assert.throws(
        () =>
          new CertificateCredential({
            cert: 'C',
            key: {} as unknown as string,
          }),
        InvalidArgumentError
      )
    })

    it('rejects a non-string passphrase', function () {
      assert.throws(
        () =>
          new CertificateCredential({
            pfx: DUMMY_PFX,
            passphrase: 42 as unknown as string,
          }),
        InvalidArgumentError
      )
    })

  })

  describe('Cluster.setCredential', function () {
    it('rejects a null/undefined initial credential', function () {
      assert.throws(
        () =>
          createInstance(
            'http://localhost:8095',
            null as unknown as ClusterCredential
          ),
        InvalidArgumentError
      )
      assert.throws(
        () =>
          createInstance(
            'http://localhost:8095',
            undefined as unknown as ClusterCredential
          ),
        InvalidArgumentError
      )
    })

    it('rejects a username/password credential object', function () {
      assert.throws(
        () =>
          createInstance('http://localhost:8095', {
            username: 'alice',
            password: 'pw',
          } as unknown as ClusterCredential),
        InvalidArgumentError
      )
    })

    it('rotates a JWT in place', function () {
      const cluster = createInstance(
        'http://localhost:8095',
        new JwtCredential(SAMPLE_JWT)
      )
      try {
        const next = 'rotated.jwt.token'
        cluster.setCredential(new JwtCredential(next))
        const req = cluster.httpClient.genericRequestOptions()
        assert.strictEqual(
          (req.headers as Record<string, string>).Authorization,
          `Bearer ${next}`
        )
      } finally {
        cluster.close()
      }
    })

    it('rotates a password in place', function () {
      const cluster = createInstance(
        'http://localhost:8095',
        new Credential('alice', 'old')
      )
      try {
        cluster.setCredential(new Credential('alice', 'new'))
        const req = cluster.httpClient.genericRequestOptions()
        assert.strictEqual(
          (req.headers as Record<string, string>).Authorization,
          'Basic ' + Buffer.from('alice:new').toString('base64')
        )
      } finally {
        cluster.close()
      }
    })

    it('rejects invalid credential-shaped objects without mutating state', function () {
      const cluster = createInstance(
        'http://localhost:8095',
        new Credential('alice', 'pw')
      )
      try {
        const before = cluster.httpClient.genericRequestOptions()
          .headers as Record<string, string>
        assert.throws(
          () =>
            cluster.setCredential({
              type: 'password',
            } as unknown as ClusterCredential),
          InvalidArgumentError
        )
        const after = cluster.httpClient.genericRequestOptions()
          .headers as Record<string, string>
        assert.strictEqual(after.Authorization, before.Authorization)
      } finally {
        cluster.close()
      }
    })

    it('rejects switching credential type at runtime', function () {
      const cluster = createInstance(
        'http://localhost:8095',
        new Credential('alice', 'pw')
      )
      try {
        assert.throws(
          () => cluster.setCredential(new JwtCredential(SAMPLE_JWT)),
          InvalidArgumentError
        )
      } finally {
        cluster.close()
      }
    })

    it('rejects mTLS over http://', function () {
      assert.throws(
        () =>
          createInstance(
            'http://localhost:8095',
            new CertificateCredential({
              pfx: DUMMY_PFX,
              passphrase: DUMMY_PASSPHRASE,
            })
          ),
        InvalidArgumentError
      )
    })

    it('rotates a certificate by rebuilding the agent', function () {
      const cluster = createInstance(
        'https://localhost:18095',
        new CertificateCredential({
          pfx: DUMMY_PFX,
          passphrase: DUMMY_PASSPHRASE,
        }),
        { securityOptions: { disableServerCertificateVerification: true } }
      )
      try {
        const before = cluster.httpClient.genericRequestOptions().agent
        cluster.setCredential(
          new CertificateCredential({
            pfx: DUMMY_PFX,
            passphrase: DUMMY_PASSPHRASE,
          })
        )
        const after = cluster.httpClient.genericRequestOptions().agent
        assert.notStrictEqual(after, before)
      } finally {
        cluster.close()
      }
    })

    it('certificate credentials do not set an Authorization header', function () {
      const cluster = createInstance(
        'https://localhost:18095',
        new CertificateCredential({
          pfx: DUMMY_PFX,
          passphrase: DUMMY_PASSPHRASE,
        }),
        { securityOptions: { disableServerCertificateVerification: true } }
      )
      try {
        const opts = cluster.httpClient.genericRequestOptions()
        assert.isUndefined(opts.headers)
      } finally {
        cluster.close()
      }
    })

    it('rejects a null/undefined credential', function () {
      const cluster = createInstance(
        'http://localhost:8095',
        new Credential('alice', 'pw')
      )
      try {
        assert.throws(
          () => cluster.setCredential(null as unknown as ClusterCredential),
          InvalidArgumentError
        )
        assert.throws(
          () =>
            cluster.setCredential(undefined as unknown as ClusterCredential),
          InvalidArgumentError
        )
      } finally {
        cluster.close()
      }
    })

    it('sends the Authorization header on the actual query request', async function () {
      // Regression guard: the executor's `headers` literal must not clobber
      // the `Authorization` header pulled in from genericRequestOptions().
      this.timeout(10000)
      let capturedAuth: string | undefined
      const server = http.createServer((req) => {
        capturedAuth = req.headers.authorization
        req.socket.destroy()
      })
      await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve)
      )
      const port = (server.address() as AddressInfo).port

      const cluster = createInstance(
        `http://127.0.0.1:${port}`,
        new JwtCredential(SAMPLE_JWT)
      )
      try {
        await cluster
          .executeQuery('SELECT 1', { maxRetries: 0, timeout: 2000 })
          .catch(() => undefined)
        assert.strictEqual(capturedAuth, `Bearer ${SAMPLE_JWT}`)
      } finally {
        cluster.close()
        await new Promise<void>((resolve, reject) =>
          server.close((err) => (err ? reject(err) : resolve()))
        )
      }
    })

    it('credential rotation between retries takes effect on the next retry', async function () {
      this.timeout(10000)
      const seenAuth: string[] = []
      let cluster: ReturnType<typeof createInstance> | undefined
      const server = http.createServer((req) => {
        seenAuth.push(req.headers.authorization || '')
        if (seenAuth.length === 1) {
          cluster?.setCredential(new JwtCredential('second.jwt.token'))
        }
        req.socket.destroy()
      })
      await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve)
      )
      const port = (server.address() as AddressInfo).port

      cluster = createInstance(
        `http://127.0.0.1:${port}`,
        new JwtCredential('first.jwt.token')
      )
      try {
        const queryPromise = cluster.executeQuery('SELECT 1', {
          maxRetries: 3,
          timeout: 4000,
        })
        await queryPromise.catch(() => undefined)

        assert.isAtLeast(seenAuth.length, 2)
        assert.strictEqual(seenAuth[0], 'Bearer first.jwt.token')
        assert.strictEqual(
          seenAuth[seenAuth.length - 1],
          'Bearer second.jwt.token'
        )
      } finally {
        cluster.close()
        await new Promise<void>((resolve, reject) =>
          server.close((err) => (err ? reject(err) : resolve()))
        )
      }
    })

    it('does not mutate state when rotation is rejected', function () {
      const cluster = createInstance(
        'http://localhost:8095',
        new Credential('alice', 'pw')
      )
      try {
        const before = cluster.httpClient.genericRequestOptions()
          .headers as Record<string, string>
        try {
          cluster.setCredential(new JwtCredential(SAMPLE_JWT))
        } catch {
          // expected
        }
        const after = cluster.httpClient.genericRequestOptions()
          .headers as Record<string, string>
        assert.strictEqual(after.Authorization, before.Authorization)
      } finally {
        cluster.close()
      }
    })
  })
})
