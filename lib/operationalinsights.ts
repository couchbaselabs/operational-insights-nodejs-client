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

import type { ClusterCredential } from './credential.js'
import { Cluster, ClusterOptions } from './cluster.js'

/**
 * Acts as the entrypoint into the rest of the library.  Connecting to the cluster
 * and exposing the various services and features.
 *
 * @param connStr The connection string to use to connect to the cluster.
 * @param credential The credential details to use to connect to the cluster.
 * @param options Optional parameters for this operation.
 * @category Core
 */
export function createInstance(
  connStr: string,
  credential: ClusterCredential,
  options?: ClusterOptions
): Cluster {
  return Cluster.createInstance(connStr, credential, options)
}

export * from './querytypes.js'
export * from './database.js'
export * from './deserializers.js'
export * from './certificates.js'
export * from './cluster.js'
export { CertificateCredential, Credential, JwtCredential } from './credential.js'
export type { ClusterCredential, ICredential } from './credential.js'
export * from './errors.js'
export * from './scope.js'
export * from './logger.js'
