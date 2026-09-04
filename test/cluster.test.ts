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
import { harness } from './harness.js'
import {
  createInstance,
  ClusterOptions,
  PassthroughDeserializer,
} from '../lib/operationalinsights.js'

describe('#Cluster', function () {
  it('should correctly set timeouts', function () {
    const options: ClusterOptions = {
      timeoutOptions: {
        connectTimeout: 20000,
        queryTimeout: 80000,
      },
    }

    const cluster = createInstance(
      harness.connStr!,
      harness.credentials,
      options
    )

    assert.equal(cluster.queryTimeout, 80000)
    assert.equal(cluster.connectTimeout, 20000)
  })

  it('should raise error on negative connectTimeout', async function () {
    const options: ClusterOptions = {
      timeoutOptions: {
        connectTimeout: -1,
      },
    }

    await harness.throwsHelper(() => {
      return createInstance(harness.connStr!, harness.credentials, options)
    }, Error)
  })

  it('should raise error on negative queryTimeout', async function () {
    const options: ClusterOptions = {
      timeoutOptions: {
        queryTimeout: -1,
      },
    }

    await harness.throwsHelper(() => {
      return createInstance(harness.connStr!, harness.credentials, options)
    }, Error)
  })

  it('should throw an error if multiple trustOnly options are set', async function () {
    const options: ClusterOptions = {
      securityOptions: {
        trustOnlyCapella: true,
        trustOnlyPemFile: 'pemFile',
      },
    }

    await harness.throwsHelper(() => {
      return createInstance(harness.connStr!, harness.credentials, options)
    }, Error)
  })

  it('should correctly set cluster-level deserializer', function () {
    const options: ClusterOptions = {
      deserializer: new PassthroughDeserializer(),
    }

    const cluster = createInstance(
      harness.connStr!,
      harness.credentials,
      options
    )
    assert.instanceOf(cluster.deserializer, PassthroughDeserializer)
  })
})
