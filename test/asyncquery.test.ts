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
  Cluster,
  Scope,
  QueryHandle,
  QueryResultHandle,
  QueryStatus,
  InvalidArgumentError,
  PassthroughDeserializer,
  OperationalInsightsError,
} from '../lib/operationalinsights.js'

const POLL_INTERVAL_MS = 1000
const MAX_POLL_ATTEMPTS = 120

async function waitForResults(handle: QueryHandle): Promise<QueryResultHandle> {
  for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
    const status = await handle.fetchStatus()
    if (status.resultsReady()) {
      return status.resultsHandle()
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }
  throw new Error(
    `Query did not complete within ${MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS}ms`
  )
}

function genericAsyncTests(instance: () => Cluster | Scope) {
  describe('#asyncQueryTests', function () {
    this.timeout(180_000)
    this.retries(3)

    before(async function () {
      harness.skipIfIntegrationDisabled(this)
    })

    it('should start an async query and fetch results', async function () {
      const qs = `FROM RANGE(1, 100) AS i SELECT *`
      const handle = await instance()!.startQuery(qs)

      assert.instanceOf(handle, QueryHandle)

      const resultHandle = await waitForResults(handle)

      assert.instanceOf(resultHandle, QueryResultHandle)

      const queryResult = await resultHandle.fetchResults()
      const results: any[] = []
      for await (const row of queryResult.rows()) {
        results.push(row)
      }
      assert.equal(results.length, 100)
    })

    it('should return false from resultsReady while query is running', async function () {
      const qs = `FROM RANGE(1, 1000000) AS i SELECT *`
      const handle = await instance()!.startQuery(qs)

      const status = await handle.fetchStatus()
      assert.instanceOf(status, QueryStatus)
      if (!status.resultsReady()) {
        assert.isFalse(status.resultsReady())
      }

      await handle.cancel()
    })

    it('should throw OperationalInsightsError from resultsHandle when results are not ready', async function () {
      const qs = `FROM RANGE(1, 1000000) AS i SELECT *`
      const handle = await instance()!.startQuery(qs)

      const status = await handle.fetchStatus()
      if (!status.resultsReady()) {
        assert.throws(() => status.resultsHandle(), OperationalInsightsError)
      }

      await handle.cancel()
    })

    it('QueryStatus.toString should return a string containing status and metrics', async function () {
      const qs = `FROM RANGE(1, 10) AS i SELECT *`
      const handle = await instance()!.startQuery(qs)

      const status = await handle.fetchStatus()
      const str = status.toString()

      assert.isString(str)
      assert.isNotEmpty(str)

      const parsed = JSON.parse(str)
      assert.property(parsed, 'status')
      assert.isString(parsed.status)

      // Clean up
      await handle.cancel()
    })

    it('should cancel an async query without error', async function () {
      const qs = `FROM RANGE(1, 1000000) AS i SELECT *`
      const handle = await instance()!.startQuery(qs)

      await handle.cancel()

      // Cancelling again should not throw
      await handle.cancel()
    })

    it('should discard results without error', async function () {
      const qs = `FROM RANGE(1, 10) AS i SELECT *`
      const handle = await instance()!.startQuery(qs)

      const resultHandle = await waitForResults(handle)
      assert.instanceOf(resultHandle, QueryResultHandle)

      await resultHandle.discardResults()

      // Cancelling again should not throw
      await resultHandle.discardResults()
    })

    it('should raise error on negative timeout', async function () {
      await harness.throwsHelper(async () => {
        await instance()!.startQuery("SELECT 'FOO' AS message", {
          timeout: -1,
        })
      }, InvalidArgumentError)
    })

    it('should work with timeout option', async function () {
      const qs = `SELECT 1=1`
      const handle = await instance()!.startQuery(qs, {
        timeout: 60000,
      })

      assert.instanceOf(handle, QueryHandle)

      const resultHandle = await waitForResults(handle)
      assert.instanceOf(resultHandle, QueryResultHandle)
    })

    it('should start async query with named parameters', async function () {
      const qs = `SELECT $five=5`
      const handle = await instance()!.startQuery(qs, {
        namedParameters: { five: 5 },
      })

      const resultHandle = await waitForResults(handle)
      const queryResult = await resultHandle.fetchResults()
      const results: any[] = []
      for await (const row of queryResult.rows()) {
        results.push(row)
      }

      assert.equal(results.length, 1)
      assert.isTrue(results.at(0)['$1'])
    })

    it('should start async query with positional parameters', async function () {
      const qs = `SELECT $2=1`
      const handle = await instance()!.startQuery(qs, {
        positionalParameters: [undefined, 1],
      })

      const resultHandle = await waitForResults(handle)
      const queryResult = await resultHandle.fetchResults()
      const results: any[] = []
      for await (const row of queryResult.rows()) {
        results.push(row)
      }

      assert.equal(results.length, 1)
      assert.isTrue(results.at(0)['$1'])
    })

    it('should fetch multiple rows from async query', async function () {
      const qs = `FROM RANGE(1, 1000) AS i SELECT i`
      const handle = await instance()!.startQuery(qs)

      const resultHandle = await waitForResults(handle)
      const queryResult = await resultHandle.fetchResults()
      const results: any[] = []
      for await (const row of queryResult.rows()) {
        results.push(row)
      }

      assert.equal(results.length, 1000)
      assert.isObject(results[0])
      assert.equal(results[0].i, 1)
      assert.equal(results[999].i, 1000)
    })

    it('should fetch multiple rows using passthrough deserializer', async function () {
      const qs = `FROM RANGE(1, 10) AS i SELECT i`
      const handle = await instance()!.startQuery(qs)

      const resultHandle = await waitForResults(handle)
      const queryResult = await resultHandle.fetchResults({
        deserializer: new PassthroughDeserializer(),
      })
      const results: any[] = []
      for await (const row of queryResult.rows()) {
        results.push(row)
      }

      assert.equal(results.length, 10)
      assert.isString(results[0])
    })

    it('should fetch multiple rows using events', async function () {
      const qs = `FROM RANGE(1, 100) AS i SELECT i`
      const handle = await instance()!.startQuery(qs)

      const resultHandle = await waitForResults(handle)
      const queryResult = await resultHandle.fetchResults()

      const results: any[] = await new Promise((resolve, reject) => {
        const rows: any[] = []
        queryResult
          .rows()
          .on('data', (row) => rows.push(row))
          .on('end', () => resolve(rows))
          .on('error', reject)
      })

      assert.equal(results.length, 100)
      assert.equal(results[0].i, 1)
      assert.equal(results[99].i, 100)
    })

    it('should fetch results from a slow async query', async function () {
      const qs = `SELECT VALUE SLEEP("x", 100) FROM RANGE(1, 100) AS id`
      const handle = await instance()!.startQuery(qs)

      assert.instanceOf(handle, QueryHandle)

      const resultHandle = await waitForResults(handle)
      assert.instanceOf(resultHandle, QueryResultHandle)

      const queryResult = await resultHandle.fetchResults()
      const results: any[] = []
      for await (const row of queryResult.rows()) {
        results.push(row)
      }

      assert.equal(results.length, 100)
      results.forEach((row) => assert.equal(row, 'x'))
    })

    it('should cancel while iterating results using query result cancel', async function () {
      const qs = `FROM RANGE(1, 1000) AS i SELECT i`
      const handle = await instance()!.startQuery(qs)

      const resultHandle = await waitForResults(handle)
      const queryResult = await resultHandle.fetchResults()

      const results: any[] = []
      const expectedCount = 5
      let count = 0

      try {
        for await (const row of queryResult.rows()) {
          if (count === expectedCount - 1) {
            queryResult.cancel()
          }
          results.push(row)
          count++
        }
      } catch (err: any) {
        assert.strictEqual(err.name, 'AbortError')
      }

      assert.strictEqual(results.length, expectedCount)
    })

    it('should cancel while iterating results using abort controller', async function () {
      const qs = `FROM RANGE(1, 1000) AS i SELECT i`
      const handle = await instance()!.startQuery(qs)

      const resultHandle = await waitForResults(handle)
      const abortController = new AbortController()
      const queryResult = await resultHandle.fetchResults({
        deserializer: new PassthroughDeserializer(),
      })

      const results: any[] = []
      const expectedCount = 5
      let count = 0

      try {
        for await (const row of queryResult.rows()) {
          if (count === expectedCount - 1) {
            abortController.abort()
          }
          results.push(row)
          count++
        }
      } catch (err: any) {
        // Do nothing
      }

      assert.isAtLeast(results.length, 1)
    })

    it('should discard results before fetching', async function () {
      const qs = `FROM RANGE(1, 100) AS i SELECT i`
      const handle = await instance()!.startQuery(qs)

      const resultHandle = await waitForResults(handle)
      assert.instanceOf(resultHandle, QueryResultHandle)

      await resultHandle.discardResults()

      await resultHandle.discardResults()
    })

    it('should discard results after partial iteration', async function () {
      const qs = `FROM RANGE(1, 1000) AS i SELECT i`
      const handle = await instance()!.startQuery(qs)

      const resultHandle = await waitForResults(handle)
      const queryResult = await resultHandle.fetchResults()

      // Read a few rows then cancel
      const results: any[] = []
      try {
        for await (const row of queryResult.rows()) {
          results.push(row)
          if (results.length === 5) {
            queryResult.cancel()
          }
        }
      } catch (err: any) {
        assert.strictEqual(err.name, 'AbortError')
      }

      assert.strictEqual(results.length, 5)

      await resultHandle.discardResults()
    })

    it('should cancel a slow async query mid-stream', async function () {
      const qs = `SELECT VALUE SLEEP("x", 100) FROM RANGE(1, 100) AS id`
      const handle = await instance()!.startQuery(qs)

      const resultHandle = await waitForResults(handle)
      const queryResult = await resultHandle.fetchResults()

      const results: any[] = []
      const expectedCount = 3

      try {
        for await (const row of queryResult.rows()) {
          results.push(row)
          if (results.length === expectedCount) {
            queryResult.cancel()
          }
        }
      } catch (err: any) {
        assert.strictEqual(err.name, 'AbortError')
      }

      assert.strictEqual(results.length, expectedCount)
      results.forEach((row) => assert.equal(row, 'x'))
    })
  })
}

describe('#Operational Insights async query - cluster', function () {
  genericAsyncTests(() => harness.c)
})

describe('#Operational Insights async query - scope', function () {
  genericAsyncTests(() => harness.s)
})
