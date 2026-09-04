# Couchbase Node.js Operational Insights Client
Node.js client for [Couchbase](https://couchbase.com) Operational Insights

# Installing the SDK<a id="installing-the-sdk"></a>

To install the latest release using npm, run:
```console
npm install couchbase-operational-insights
```
To install the development version directly from github, run:
```console
npm install https://github.com/couchbase/operational-insights-nodejs-client
```

# Using the SDK<a id="using-the-sdk"></a>

Some more examples are provided in the [examples directory](https://github.com/couchbase/operational-insights-nodejs-client/tree/main/examples).

## CommonJS
**Connecting and executing a query**
```javascript
const operationalInsights = require('couchbase-operational-insights')

async function main() {
  // Update this to your cluster
  // IMPORTANT:  The appropriate port needs to be specified. The SDK's default ports are 80 (http) and 443 (https).
  //             If attempting to connect to Capella, the correct ports are most likely to be 8095 (http) and 18095 (https).
  //             Capella example: https://cb.2xg3vwszqgqcrsix.cloud.couchbase.com:18095
  const clusterEndpoint = 'https://--your-instance--'
  const username = 'username'
  const password = 'password'
  // User Input ends here.

  const credential = new operationalInsights.Credential(username, password)
  const cluster = operationalInsights.createInstance(clusterEndpoint, credential)

  // Execute a streaming query with positional arguments.
  let qs = 'SELECT * FROM `travel-sample`.inventory.airline LIMIT 10;'
  let res = await cluster.executeQuery(qs)
  for await (let row of res.rows()) {
    console.log('Found row: ', row)
  }
  console.log('Metadata: ', res.metadata())

  // Execute a streaming query with positional arguments.
  qs =
    'SELECT * FROM `travel-sample`.inventory.airline WHERE country=$1 LIMIT $2;'
  res = await cluster.executeQuery(qs, { parameters: ['United States', 10] })
  for await (let row of res.rows()) {
    console.log('Found row: ', row)
  }
  console.log('Metadata: ', res.metadata())

  // Execute a streaming query with named parameters.
  qs =
    'SELECT * FROM `travel-sample`.inventory.airline WHERE country=$country LIMIT $limit;'
  res = await cluster.executeQuery(qs, {
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

```

## ES Modules
**Connecting and executing a query**
```javascript
import { Certificates, Credential, createInstance } from "couchbase-operational-insights"

async function main() {
  // Update this to your cluster
  // IMPORTANT:  The appropriate port needs to be specified. The SDK's default ports are 80 (http) and 443 (https).
  //             If attempting to connect to Capella, the correct ports are most likely to be 8095 (http) and 18095 (https).
  //             Capella example: https://cb.2xg3vwszqgqcrsix.cloud.couchbase.com:18095
  const clusterEndpoint = 'https://--your-instance--'
  const username = 'username'
  const password = 'password'
  // User Input ends here.

  const credential = new Credential(username, password)
  const cluster = createInstance(clusterEndpoint, credential)

  // Execute a streaming query with positional arguments.
  let qs = "SELECT * FROM `travel-sample`.inventory.airline LIMIT 10;"
  let res = await cluster.executeQuery(qs)
  for await (let row of res.rows()) {
    console.log("Found row: ", row)
  }
  console.log("Metadata: ", res.metadata())

  // Execute a streaming query with positional arguments.
  qs =
    "SELECT * FROM `travel-sample`.inventory.airline WHERE country=$1 LIMIT $2;"
  res = await cluster.executeQuery(qs, { parameters: ["United States", 10] })
  for await (let row of res.rows()) {
    console.log("Found row: ", row)
  }
  console.log("Metadata: ", res.metadata())

  // Execute a streaming query with named parameters.
  qs =
    "SELECT * FROM `travel-sample`.inventory.airline WHERE country=$country LIMIT $limit;"
  res = await cluster.executeQuery(qs, {
    namedParameters: { country: "United States", limit: 10 },
  })
  for await (let row of res.rows()) {
    console.log("Found row: ", row)
  }
  console.log("Metadata: ", res.metadata())
}

main()
  .then(() => {
    console.log("Finished.  Exiting app...")
  })
  .catch((err) => {
    console.log("ERR: ", err)
    console.log("Exiting app...")
    process.exit(1)
  })

```