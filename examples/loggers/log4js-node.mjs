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

import { createInstance, Credential } from 'couchbase-operational-insights'
import log4js from 'log4js'
const { configure, getLogger } = log4js

configure({
    appenders: { operationalInsights: { type: "file", filename: "operational-insights.log" } },
    categories: { default: { appenders: ["operationalInsights"], level: "debug" } },
})

const log4jsLogger = getLogger('operationalInsights')

const couchbaseLogger = {
    debug: (...args) => log4jsLogger.debug(args.map(String).join(' ')),
    info: (...args) => log4jsLogger.info(args.map(String).join(' ')),
    warn: (...args) => log4jsLogger.warn(args.map(String).join(' ')),
    error: (...args) => log4jsLogger.error(args.map(String).join(' ')),
}

async function main() {
    // Update this to your cluster
    const clusterConnStr = 'https://--your-instance--'
    const username = 'Administrator'
    const password = 'password'
    // User Input ends here.

    const credential = new Credential(username, password)
    const cluster = createInstance(clusterConnStr, credential, {
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