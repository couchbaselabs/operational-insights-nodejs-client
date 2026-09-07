# Couchbase Node.js Operational Insights FIT Performer

This is the FIT performer for the [Couchbase Node.js Operational Insights Client](https://github.com/couchbase/operational-insights-nodejs-client).
It is versioned alongside the SDK: the performer in this directory is always built against whatever SDK
source is currently checked out, not a separately pinned version.

## Prerequisites

- Node.js & npm
- TypeScript (`npm install -g typescript`)
- The SDK itself must be built first — see the [README](../README.md) at the repository root.

## Installing dependencies

All commands below are run from this `performer` directory.

```shell
npm install
```

The performer depends on the `couchbase-operational-insights` package via a `file:..` dependency, so this
links `node_modules/couchbase-operational-insights` to the built SDK at the repository root instead of
installing it from the registry.

## Generating protoc files

The `*.proto` files are mirrored from [couchbaselabs/fit-protocol](https://github.com/couchbaselabs/fit-protocol)
into `proto/`. To pick up protocol updates, run:

```shell
./scripts/update-protobuf.sh
```

then commit any changes under `proto/`.

Once the `.proto` files are in place, generate the TypeScript/JavaScript bindings with:

```shell
./scripts/build-protos.sh
```

This uses the standard Node protoc compiler in conjunction with the
[grpc_tools_node_protoc_ts](https://github.com/agreatfool/grpc_tools_node_protoc_ts) plugin to generate
associated types for TypeScript integration.

## Running

Once you've installed the node modules and generated the protoc files, compile and run the performer with:

```shell
npm run build
npm run start
```

Alternatively, use [ts-node](https://github.com/TypeStrong/ts-node) to run it without precompiling:

```shell
ts-node src/performer/performer.ts
```

## Docker

Build and run the performer image from the repository root (not from this directory), since the build
needs access to the full SDK source:

```shell
docker build -f performer/Dockerfile -t operational-insights-nodejs-fit-performer .
docker run -p 8060:8060 operational-insights-nodejs-fit-performer
```
