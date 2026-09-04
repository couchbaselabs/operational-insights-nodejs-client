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

const operationalInsights = require('couchbase-operational-insights')
const winston = require('winston')

const winstonLogger = winston.createLogger({
  level: 'debug',
  transports: [new winston.transports.Console(), new winston.transports.File({filename: 'operational-insights.log'})],
})

const couchbaseLogger = {
  debug: (...args) => winstonLogger.debug(args.map(String).join(' ')),
  info: (...args) => winstonLogger.info(args.map(String).join(' ')),
  warn: (...args) => winstonLogger.warn(args.map(String).join(' ')),
  error: (...args) => winstonLogger.error(args.map(String).join(' ')),
}

async function main() {
  // Update this to your cluster
  const clusterConnStr = 'https://--your-instance--'
  const username = 'username'
  const password = 'password'
  // User Input ends here.

  const credential = new operationalInsights.Credential(username, password)
  const cluster = operationalInsights.createInstance(clusterConnStr, credential, {
    logger: couchbaseLogger,
  })

  // ... Execute operations here
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
