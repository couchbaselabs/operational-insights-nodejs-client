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

import { Certificates, Credential, createInstance } from 'couchbase-operational-insights'

async function main() {
  // Update this to your cluster
  const clusterConnStr = 'https://--your-instance--'
  const username = 'username'
  const password = 'password'
  // User Input ends here.

  const credential = new Credential(username, password)
  const scope = createInstance(clusterConnStr, credential, {
    // NOTE:  Only an example on how to use options.  Not a recommendation.
    timeoutOptions: {
      queryTimeout: 10000,
    },
  })
    .database('travel-sample')
    .scope('inventory')

  // Execute a streaming query.
  let qs = 'SELECT * FROM airline LIMIT 10;'
  let res = await scope.executeQuery(qs)
  for await (let row of res.rows()) {
    console.log('Found row: ', row)
  }
  console.log('Metadata: ', res.metadata())

  // Execute a streaming query with positional arguments.
  qs = 'SELECT * FROM airline WHERE country=$1 LIMIT $2;'
  res = await scope.executeQuery(qs, {
    positionalParameters: ['United States', 10],
  })
  for await (let row of res.rows()) {
    console.log('Found row: ', row)
  }
  console.log('Metadata: ', res.metadata())

  // Execute a streaming query with named parameters.
  qs = 'SELECT * FROM airline WHERE country=$country LIMIT $limit;'
  res = await scope.executeQuery(qs, {
    namedParameters: { country: 'United States', limit: 10 },
  })
  for await (let row of res.rows()) {
    console.log('Found row: ', row)
  }
  console.log('Metadata: ', res.metadata())
}

main()
  .then(() => {
    console.log('Finished.  Exiting app...')
  })
  .catch((err) => {
    console.log('ERR: ', err)
    console.log('Exiting app...')
    process.exit(1)
  })
