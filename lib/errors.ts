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

/**
 * A generic base error that all non-platform errors inherit.  Exposes the cause and
 * context of the error to enable easier debugging.
 *
 * @category Error Handling
 */
export class OperationalInsightsError extends Error {
  cause: Error

  constructor(message: string, cause?: Error) {
    super(message, cause)
    this.name = this.constructor.name
  }
}

/**
 * Indicates that the user credentials are incorrect.
 *
 * @category Error Handling
 */
export class InvalidCredentialError extends OperationalInsightsError {
  constructor(message: string) {
    super(message)
  }
}

/**
 * Indicates that an interaction with the Operational Insights cluster does not complete before its timeout expires.
 *
 * @category Error Handling
 */
export class TimeoutError extends OperationalInsightsError {
  constructor(message: string) {
    super(message)
  }
}

/**
 * Indicates that the Operational Insights cluster returned an error message in response to a query request.
 *
 * @category Error Handling
 */
export class QueryError extends OperationalInsightsError {
  /**
   * A human-readable error message sent by the server, without the additional context contained in {@link Error.message}.
   */
  serverMessage: string

  // TODO: Add docs reference link with error codes
  /**
   * The Operational Insights error code sent by the server.
   */
  code: number

  constructor(message: string, serverMessage: string, code: number) {
    super(message)
    this.serverMessage = serverMessage
    this.code = code
  }

  /**
   * @internal
   */
  addMessagePrefix(prefix: string): void {
    this.message = prefix + this.message
  }
}

/**
 * Indicates that a query was not found, typically because it has been discarded, canceled, or never existed.
 *
 * @category Error Handling
 */
export class QueryNotFoundException extends OperationalInsightsError {
  constructor(message: string) {
    super(message)
  }
}

/**
 * Indicates that one of the passed arguments was invalid.
 *
 * @category Error Handling
 */
export class InvalidArgumentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = this.constructor.name
  }
}
