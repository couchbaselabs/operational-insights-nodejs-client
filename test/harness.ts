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
import * as fs from 'fs'
import * as ini from 'ini'
import * as path from 'path'
import * as semver from 'semver'
import * as crypto from 'crypto'

import {
  Cluster,
  Database,
  Scope,
  Credential,
  createInstance,
  Certificates,
} from '../lib/operationalinsights.js'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const TEST_CONFIG_INI = path.join(
  path.resolve(__dirname, '..'),
  'test',
  'testConfig.ini'
)

const ServerFeatures: Record<string, any> = {}

interface Feature {
  feature: string
  enabled: boolean | undefined
}

interface TestConfig {
  connstr?: string
  version: ServerVersion
  database: string
  scope: string
  collection: string
  user?: string
  pass?: string
  nonprod: boolean
  disableCertVerification: boolean
  features: Feature[]
}

interface ConnectionOptions {
  username?: string
  password?: string
  connstr?: string
}

class ServerVersion {
  major: number
  minor: number
  patch: number

  constructor(major: number, minor: number, patch: number) {
    this.major = major
    this.minor = minor
    this.patch = patch
  }

  isAtLeast(major: number, minor: number, patch: number): boolean {
    if (this.major === 0 && this.minor === 0 && this.patch === 0) {
      // if no version is provided, assume latest
      return true
    }

    if (major < this.major) {
      return true
    } else if (major > this.major) {
      return false
    }

    if (minor < this.minor) {
      return true
    } else if (minor > this.minor) {
      return false
    }

    return patch <= this.patch
  }
}

const TEST_CONFIG: TestConfig = {
  version: new ServerVersion(0, 0, 0),
  database: 'Default',
  scope: 'Default',
  collection: 'Default',
  nonprod: false,
  disableCertVerification: true,
  features: [],
}

let configIni: any
try {
  configIni = ini.parse(fs.readFileSync(TEST_CONFIG_INI, 'utf-8'))
} catch (e) {
  // config.ini is optional
}

if (configIni && configIni.connstr !== undefined) {
  TEST_CONFIG.connstr = configIni.connstr
} else if (process.env.NCBOICSTR !== undefined) {
  TEST_CONFIG.connstr = process.env.NCBOICSTR
}

if ((configIni && configIni.version) || process.env.NCBOICVER !== undefined) {
  assert(!!TEST_CONFIG.connstr, 'must not specify a version without a connstr')
  const ver = configIni?.version || process.env.NCBOICVER || ''
  const major = semver.major(ver)
  const minor = semver.minor(ver)
  const patch = semver.patch(ver)
  TEST_CONFIG.version = new ServerVersion(major, minor, patch)
}

let fqdnTokens: string[] = []
if (configIni && configIni.fqdn !== undefined) {
  fqdnTokens = configIni.fqdn.split('.')
} else if (process.env.NCBOIFQDN !== undefined) {
  fqdnTokens = process.env.NCBOIFQDN!.split('.')
}

if (fqdnTokens.length > 0) {
  if (fqdnTokens.length != 3) {
    throw new Error(`Invalid FQDN provided. FQDN=${fqdnTokens.join('.')}`)
  }
  TEST_CONFIG.database = fqdnTokens[0]
  TEST_CONFIG.scope = fqdnTokens[1]
  TEST_CONFIG.collection = fqdnTokens[2]
}

if (configIni && configIni.username !== undefined) {
  TEST_CONFIG.user = configIni.username
} else if (process.env.NCBOIUSER !== undefined) {
  TEST_CONFIG.user = process.env.NCBOIUSER
}

if (configIni && configIni.password !== undefined) {
  TEST_CONFIG.pass = configIni.password
} else if (process.env.NCBOIPASS !== undefined) {
  TEST_CONFIG.pass = process.env.NCBOIPASS
}

if (configIni && configIni.nonprod !== undefined) {
  TEST_CONFIG.nonprod = configIni.nonprod
} else if (process.env.NCBOINONPROD !== undefined) {
  TEST_CONFIG.nonprod = process.env.NCBOINONPROD === 'true'
}

if (configIni && configIni.disable_cert_verification !== undefined) {
  TEST_CONFIG.disableCertVerification = configIni.disable_cert_verification
} else if (process.env.NCBOIDISABLECERTVERIFICATION !== undefined) {
  TEST_CONFIG.disableCertVerification =
    process.env.NCBOIDISABLECERTVERIFICATION === 'true'
}

if ((configIni && configIni.features) || process.env.NCBOIFEAT !== undefined) {
  const featureStrs = (
    configIni?.features ||
    process.env.NCBOIFEAT ||
    ''
  ).split(',')
  featureStrs.forEach((featureStr: string) => {
    const featureName = featureStr.substr(1)

    let featureEnabled: boolean | undefined = undefined
    if (featureStr[0] === '+') {
      featureEnabled = true
    } else if (featureStr[0] === '-') {
      featureEnabled = false
    }

    TEST_CONFIG.features.push({
      feature: featureName,
      enabled: featureEnabled,
    })
  })
}

class Harness {
  private _connstr?: string
  private _version: ServerVersion
  private _database: string
  private _scope: string
  private _collection: string
  private _user?: string
  private _pass?: string
  private _nonprod: boolean
  private _disableCertVerification: boolean
  private _integrationEnabled: boolean
  private _testKey: string
  private _testCtr: number
  private _testCluster: Cluster | null
  private _testDatabase: Database | null
  private _testScope: Scope | null

  get Features(): Record<string, any> {
    return ServerFeatures
  }

  constructor() {
    this._connstr = TEST_CONFIG.connstr
    this._version = TEST_CONFIG.version
    this._database = TEST_CONFIG.database
    this._scope = TEST_CONFIG.scope
    this._collection = TEST_CONFIG.collection
    this._user = TEST_CONFIG.user
    this._pass = TEST_CONFIG.pass
    this._nonprod = TEST_CONFIG.nonprod
    this._disableCertVerification = TEST_CONFIG.disableCertVerification
    this._integrationEnabled = true

    if (!this._connstr) {
      console.info(
        'Connection string is not set, integration tests will not be run'
      )
      this._integrationEnabled = false
      // Set to localhost to allow unit tests to run
      this._connstr = 'http://localhost'
      this._user = this._user || 'placeholder'
      this._pass = this._pass || 'placeholder'
    }

    this._testKey = crypto.randomUUID()
    this._testCtr = 1

    this._testCluster = null
    this._testDatabase = null
    this._testScope = null
  }

  get connStr(): string | undefined {
    return this._connstr
  }

  get databaseName(): string {
    return this._database
  }

  get scopeName(): string {
    return this._scope
  }

  get collectionName(): string {
    return this._collection
  }

  get fqdn(): string {
    return `\`${this._database}\`.\`${this._scope}\`.\`${this._collection}\``
  }

  get integrationEnabled(): boolean {
    return this._integrationEnabled
  }

  get credentials(): Credential {
    return new Credential(this._user as string, this._pass as string)
  }

  get nonprod(): boolean {
    return this._nonprod
  }

  get disableCertVerification(): boolean {
    return this._disableCertVerification
  }

  async throwsHelper<T>(fn: () => T, ...assertArgs: any[]): Promise<void> {
    let savedErr = null
    try {
      await fn()
    } catch (err) {
      savedErr = err
    }

    assert.throws(
      () => {
        if (savedErr) {
          throw savedErr
        }
      },
      ...assertArgs
    )
  }

  assertisFalse(): void {
    assert.isTrue(false)
  }

  genTestKey(): string {
    return this._testKey + '_' + this._testCtr++
  }

  async prepare(): Promise<void> {
    const cluster = this.newCluster()
    const database = cluster.database(this._database)
    const scope = database.scope(this._scope)
    if (this._integrationEnabled) {
      await this.maybeCreateScope(scope)
    }

    this._testCluster = cluster
    this._testDatabase = database
    this._testScope = scope
  }

  async maybeCreateScope(scope: Scope): Promise<void> {
    try {
      await this.maybeCreateDatabase(scope.database)
      const qs = `CREATE SCOPE \`${scope.database.name}\`.\`${scope.name}\` IF NOT EXISTS`
      let res = await scope.database.cluster.executeQuery(qs)
      for await (const _ of res.rows()) {
        // do nothing
      }
    } catch (e) {
      console.warn('Failed maybe creating scope/database: ' + e)
    }
  }

  async maybeCreateDatabase(database: Database): Promise<void> {
    if (database.name !== 'Default') {
      const qs = `CREATE DATABASE \`${database.name}\` IF NOT EXISTS`
      let res = await database.cluster.executeQuery(qs)
      for await (const _ of res.rows()) {
        // do nothing
      }
    }
  }

  newCluster(options?: ConnectionOptions): Cluster {
    if (!options) {
      options = {}
    }

    const username = options.username || this._user
    const password = options.password || this._pass

    const credential = new Credential(username as string, password as string)

    if (!options.connstr) {
      options.connstr = this._connstr
    }

    if (this.nonprod) {
      return createInstance(options.connstr!, credential, {
        securityOptions: {
          trustOnlyCertificates: Certificates.getNonprodCertificates(),
        },
      })
    } else if (this.disableCertVerification) {
      return createInstance(options.connstr!, credential, {
        securityOptions: {
          disableServerCertificateVerification: true,
        },
      })
    } else {
      return createInstance(options.connstr!, credential)
    }
  }

  async cleanup(): Promise<void> {
    this._testDatabase = null
    this._testScope = null

    if (this._testCluster) {
      await this._testCluster.close()
      this._testCluster = null
    }
  }

  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  supportsFeature(feature: string): boolean {
    let featureEnabled: boolean | undefined = undefined

    TEST_CONFIG.features.forEach((cfgFeature) => {
      if (cfgFeature.feature === '*' || cfgFeature.feature === feature) {
        featureEnabled = cfgFeature.enabled
      }
    })

    if (featureEnabled === true) {
      return true
    } else if (featureEnabled === false) {
      return false
    }

    // eslint-disable-next-line no-empty
    switch (feature) {
    }

    throw new Error('invalid code for feature checking')
  }

  skipIfMissingFeature(test: Mocha.Context, feature: string): void {
    if (!this.supportsFeature(feature)) {
      test.skip()
      throw new Error('test skipped')
    }
  }

  skipIfIntegrationDisabled(test: Mocha.Context): void {
    if (!this._integrationEnabled) {
      test.skip()
      throw new Error('test skipped as integration tests are disabled')
    }
  }

  get c(): Cluster | null {
    return this._testCluster
  }

  get d(): Database | null {
    return this._testDatabase
  }

  get s(): Scope | null {
    return this._testScope
  }
}

const harness = new Harness()

// Hook registration with Mocha
// These use traditional function syntax due to timeout requirements
before(function (done) {
  this.timeout(30000)
  harness.prepare().then(done).catch(done)
})

after(function (done) {
  this.timeout(10000)
  harness.cleanup().then(done).catch(done)
})

export { harness }
