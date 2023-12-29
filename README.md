Config (for NodeJS Environments)
================================================================================================

This is a very small library that provides rich functionality for dealing with application
configuration in a NodeJS environment. It provides a single export `config`, which is a function
([Weenie-compatible](https://github.com/wymp/weenie-framework)) that takes config from a number of
optional sources and merges it all into a single, type-checked config object.

>
> *NOTE: See also [config-simple](https://github.com/wymp/config-simple) ([pkg](https://www.npmjs.com/package/@wymp/config-simple))
> for an alternative simpler config system.*
>


### Primary features

* Sources include any or all of the following:
  * environment variables
  * defaults JSON file (version-controlled)
  * "locals" JSON file (non-version-controlled),
  * docker secrets directory (e.g., `/secrets`)
* Sources are combined in the following order: `defaults file < locals file < env < secrets dir`
* Variable names can contain numeric suffixes (`__001`, `__1`, etc.) for "secrets versioning"
  (necessary for some orchestrators, including docker swarm). Variables are sorted in ascending
  order with later "versions" overriding earlier versions.
* Variable values are automatically coerced into what they look like (number, boolean, null,
  undefined).
* Values can contain explicit casts to guarantee type (e.g., `<string>3` results in the string `"3"`
* Pass a runtype type-checker in for automatic runtime type checking and fast-fail on errors. (Pass
  a dummy type-checker in to bypass.)
* Supports arbitrary namespacing of env vars (`APP_`, `APP_CONFIG_`, `MYCNF_`, whatever)
* Optional changing of delimiter (defaults to `_`, very rarely needs to be changed).
  

### Examples

**Common Use:** Store default variables in a version-controlled `config.json` file and selectively
override with environment variables. This keeps dev configs together with the repo and also serves
as documentation about possible config values. We'll use a runtype to validate the type.

```ts
import * as rt from "runtypes";
import { config } from "@wymp/config-node";

// Create our config validator
const validator = rt.Record({
  api: rt.Record({
    url: rt.String,
    key: rt.String,
    secret: rt.String,
  }),
  logLevel: rt.Union(
    rt.Literal("debug"),
    rt.Literal("info"),
    rt.Literal("notice"),
    rt.Literal("warning"),
    rt.Literal("error"),
    rt.Literal("critical"),
    rt.Literal("emergency"),
  ),
  someOptionalTimeout: rt.Optional(rt.Number),
});

// Use the config function to create a dependency container with a `config` object
const deps = config(`APP_`, { env: process.env, defaultsFile: "config.json" }, validator);

// We now KNOW that these values exist as expected
console.log(
  deps.config.api.url,
  deps.config.logLevel,
  deps.config.someOptionalTimeout === undefined
    ? "(unknown)"
    : deps.config.someOptionalTimeout,
);
```

**Weenie Usage:** This library was originally intended for use (and works well) with the
[Weenie dependency framework](https://github.com/wymp/weenie-framework). Use it to simply kick off
a Weenie run:

```ts
import * as Weenie from "@wymp/weenie-framework";
import { validator } from "./Types";

// NOTE: this library is included and re-exported by Weenie, so we can use it directly from there
const deps = Weenie.Weenie(Weenie.config(
  `APP_`,
  {
    env: process.env,
    defaultsFile: "config.json",
    localsFile: "config.local.json",
    secretsDir: "/secrets",
  },
  validator
))
  .and(Weenie.logger)
  .and(Weenie.mysql)
  .and(Weenie.amqp)
  .and(Weenie.cron)
  .done(d => d);

// Now we have a lot of nice, well-typed dependencies, including our config
deps.logger.notice(deps.config.logLevel);
deps.logger.notice(deps.config.api.url);
```

**Not smart but poissible:** Just get config from environment with no type checking (use at your own
risk!!)

```ts
import { config } from "@wymp/config-node";

const deps = config(`APP_`, { env: process.env }, { check: (c: any) => c });

// Who knows if this really exists! But you can do this if you'd like
console.log(deps.config.api.url, deps.config.logLevel);
```

