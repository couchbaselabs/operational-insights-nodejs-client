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

import { InvalidArgumentError } from './errors.js'

/**
 * ICredential specifies a credential which uses an RBAC
 * username and password to authenticate with the cluster.
 *
 * @deprecated Retained for back-compat with code that imported the type
 *   from earlier versions. Use the {@link Credential} class directly. Not
 *   accepted as input to `createInstance` or `Cluster.setCredential` —
 *   both require a {@link Credential} or {@link JwtCredential} instance.
 *
 * @category Authentication
 */
export interface ICredential {
  /**
   * The username to authenticate with.
   */
  username: string

  /**
   * The password to authenticate with.
   */
  password: string
}

/**
 * RBAC username/password for authenticating to an Operational Insights cluster. For
 * a JSON Web Token instead, see {@link JwtCredential}.
 *
 * @category Authentication
 */
export class Credential implements ICredential {
  /** The username to authenticate with. */
  readonly username: string

  /** The password to authenticate with. */
  readonly password: string

  /** @internal */
  readonly type = 'password' as const

  /** @internal */
  readonly authorizationHeader: string

  /**
   * Constructs a {@link Credential} for an RBAC username and password. The
   * SDK sends `Authorization: Basic <base64(user:pass)>` on every request.
   *
   * @param username The username to authenticate with.
   * @param password The password to authenticate with.
   */
  constructor(username: string, password: string) {
    if (typeof username !== 'string') {
      throw new InvalidArgumentError('Username must be a string.')
    }
    if (typeof password !== 'string') {
      throw new InvalidArgumentError('Password must be a string.')
    }
    this.username = username
    this.password = password
    this.authorizationHeader =
      'Basic ' +
      Buffer.from(`${username}:${password}`, 'utf8').toString('base64')
  }
}

/**
 * A JSON Web Token for authenticating to an Operational Insights cluster.
 *
 * @category Authentication
 */
export class JwtCredential {
  /** @internal */
  readonly type = 'jwt' as const

  /** @internal */
  readonly authorizationHeader: string

  /**
   * Constructs a {@link JwtCredential}. The SDK sends
   * `Authorization: Bearer <token>` on every request.
   *
   * @param token The JSON Web Token.
   */
  constructor(token: string) {
    if (typeof token !== 'string') {
      throw new InvalidArgumentError('JWT token must be a string.')
    }
    if (token.length === 0) {
      throw new InvalidArgumentError('JWT token must not be empty.')
    }
    this.authorizationHeader = `Bearer ${token}`
  }
}

/**
 * Material to construct a {@link CertificateCredential}. Provide either
 * `pfx` (PKCS#12 Buffer), or both `cert` and `key` (PEM strings or Buffers).
 *
 * @category Authentication
 */
export interface CertificateCredentialOptions {
  /** PKCS#12 keystore bytes (mutually exclusive with cert/key). */
  pfx?: Buffer
  /** PEM-encoded certificate (paired with `key`). */
  cert?: string | Buffer
  /** PEM-encoded private key (paired with `cert`). */
  key?: string | Buffer
  /** Passphrase for the keystore or encrypted private key, if any. */
  passphrase?: string
}

/**
 * A client certificate (mTLS) for authenticating to an Operational Insights cluster.
 * The certificate is presented during the TLS handshake; no
 * `Authorization` header is sent. Requires an `https://` endpoint.
 *
 * To load from disk, read the file(s) yourself and pass the bytes.
 *
 * ```ts
 * // PKCS#12 keystore
 * import * as fs from 'node:fs'
 * new CertificateCredential({
 *   pfx: fs.readFileSync('/path/to/client.p12'),
 *   passphrase: 'keystore-pass',
 * })
 *
 * // PEM certificate + private key
 * new CertificateCredential({
 *   cert: fs.readFileSync('/path/to/client.pem'),
 *   key: fs.readFileSync('/path/to/client.key'),
 * })
 * ```
 *
 * @category Authentication
 */
export class CertificateCredential {
  /** @internal */
  readonly type = 'certificate' as const

  /** @internal */
  readonly pfx?: Buffer
  /** @internal */
  readonly cert?: string | Buffer
  /** @internal */
  readonly key?: string | Buffer
  /** @internal */
  readonly passphrase?: string

  /**
   * Constructs a {@link CertificateCredential}. Provide either `pfx`
   * (PKCS#12) or both `cert` and `key` (PEM); supplying both forms, or
   * neither, throws.
   *
   * @param options Certificate material.
   */
  constructor(options: CertificateCredentialOptions) {
    const hasPfx = options.pfx !== undefined
    const hasCert = options.cert !== undefined
    const hasKey = options.key !== undefined
    if (hasPfx && (hasCert || hasKey)) {
      throw new InvalidArgumentError(
        'Provide either `pfx` or `cert`+`key`, not both.'
      )
    }
    if (!hasPfx && !(hasCert && hasKey)) {
      throw new InvalidArgumentError(
        'Provide either `pfx` or both `cert` and `key`.'
      )
    }
    if (hasPfx && !Buffer.isBuffer(options.pfx)) {
      throw new InvalidArgumentError('`pfx` must be a Buffer.')
    }
    if (
      hasCert &&
      typeof options.cert !== 'string' &&
      !Buffer.isBuffer(options.cert)
    ) {
      throw new InvalidArgumentError('`cert` must be a string or Buffer.')
    }
    if (
      hasKey &&
      typeof options.key !== 'string' &&
      !Buffer.isBuffer(options.key)
    ) {
      throw new InvalidArgumentError('`key` must be a string or Buffer.')
    }
    if (
      options.passphrase !== undefined &&
      typeof options.passphrase !== 'string'
    ) {
      throw new InvalidArgumentError('`passphrase` must be a string.')
    }
    this.pfx = options.pfx
    this.cert = options.cert
    this.key = options.key
    this.passphrase = options.passphrase
  }
}

/**
 * Credential variants accepted by an Operational Insights cluster.
 *
 * @category Authentication
 */
export type ClusterCredential = Credential | JwtCredential | CertificateCredential
