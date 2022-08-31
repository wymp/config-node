import { deepmerge } from "@wymp/weenie-base";
import * as fs from "fs";

/**
 * Returns a type-checked config dependency created from environment variables and static files and
 * validates it using the given validator.
 *
 * ```ts
 * import * as rt from "runtypes";
 * import { config } from "@wymp/config-node";
 *
 * const validator = rt.Record({
 *   api: rt.Record({
 *     url: rt.String,
 *   }),
 * });
 *
 * const deps = config(
 *   `APP_`,
 *   {
 *     env: process.env,
 *     defaultsFile: "config.json",
 *     localsFile: "config.local.json",
 *     secretsDir: "/secrets",
 *   },
 *   validator
 * );
 *
 * console.log(deps.config.api.url);
 * ```
 *
 * To provide for corner cases, you may pass an explicit cast in the variable value itself, in
 * standard cast notation: `APP_my_var="<string>5"` or `APP_db_port="<string>3306"`. Without this
 * cast, values are coerced into the type they appear to be (numbers, in the case of the above, but
 * also null, undefined and booleans).
 *
 * Additionally, since some orchestration systems make it difficult to re-use secret names, this
 * library also allows for a special syntax for overwriting old values. Environment variables and
 * files in the `secretsDir` may have a suffix of the type `__[nnn]` (two underscores and an
 * arbitrary number). For these variables, the suffix is stripped and the underlying variable name
 * is used instead. For example, the variables `APP_api_port__01=3000` and
 * `APP_api_port__02=3001` would result in the `config.api.port` variable having the value `3001`.
 *
 * @typeParam Config A (usually) inferred type defining the final type of the config object
 * returned. You should never really have to pass this type, as it is safely inferred from the
 * validator that you pass.
 * @param ns The prefix used to denote configuration variables for this application, including
 * trailing underscore. Usually something like `APP_` or `APP_CONFIG_`.
 * @param src A collection of potential sources from which to draw config. They are added in the
 * following order, where earlier sources are overridden by later sources:
 *
 *   defaultsFile < localsFile < env < secretsDir
 *
 * File-based sources are expected to be JSON files; `env` should be `process.env`; and `secretsDir`
 * is a directory containing files whose names are converted to keys and whose contents are the
 * values. (This comes from the way docker presents secrets.) These key/value pairs are parsed in
 * the same way environment variables are (i.e., with value coercion, explicit casting, etc.).
 * @param validator A validator that ensures the final config conforms to expectations. Usually a
 * [runtype](https://github.com/pelotom/runtypes). Note that if this is NOT a runtype, it should
 * be an object whose `check` property is a function that throws an error if the type is not as
 * expected and otherwise returns a concrete type. (If you want to gamble, you can bypass the
 * runtime type check by passing a pass-through function like so:
 * `{ check: (config: any): YourConfigType => config }`.)
 * @param delimiter If necessary, you may change the delimiter from the default "_" to something
 * else. This determines how config variables are nested. For example, the variable
 * `APP_my_db_port=3306` is usually converted to `{ my: { db: { port: 3306 } } }`. However, if you set
 * the `ns` parameter to `MYAPP0` and the `delimiter` parameter to `0`, then the value
 * `MYAPP0my_db0port=3306` would be converted to `{ my_db: { port: 3306 } }`.
 * @returns config A fully inflated and type-checked config dependency.
 */
export const config = <Config>(
  ns: string,
  src: {
    /** The collection of environment variables (usually process.env) */
    env?: { [k: string]: string | undefined };
    /** Optional path to a file supplying default config values */
    defaultsFile?: string;
    /**
     * Optional path to a file supplying config overrides that are not checked into version control.
     * (This is for development convenience.)
     */
    localsFile?: string;
    /**
     * A directory containing configs, one per file. File names are expected to comply with the same
     * rules as environment variables, and file contents are also processed in the same way as
     * env vars (i.e., with possible type-casts). This option is typically used with Docker/K8s
     * secrets.
     */
    secretsDir?: string;
  },
  validator: { check: (config: any) => Config },
  delimiter: string = "_"
): { config: Config } => {
  // Get values from environment and both files, if applicable
  const vals = [
    src.defaultsFile && fs.existsSync(src.defaultsFile)
      ? JSON.parse(fs.readFileSync(src.defaultsFile, "utf8"))
      : {},
    src.localsFile && fs.existsSync(src.localsFile)
      ? JSON.parse(fs.readFileSync(src.localsFile, "utf8"))
      : {},
    src.secretsDir && fs.existsSync(src.secretsDir)
      ? _configFromEnv(inflateSecretsDir(src.secretsDir), ns, delimiter)
      : {},
    src.env ? _configFromEnv(src.env, ns, delimiter) : {},
  ];

  // Now combine them all together
  const config = deepmerge(vals[0], vals[1], vals[2], vals[3]);

  // Finally, check and set
  try {
    return { config: validator.check(config) };
  } catch (e) {
    if (e.name && e.name === "ValidationError") {
      throw new Error(
        `Invalid configuration: ${e.key ? `${e.key}: ` : ""}${e.message}` +
          (e.details ? `\nDetails: ${JSON.stringify(e.details, null, 2)}` : "")
      );
    } else {
      throw e;
    }
  }
};

/**
 * Takes a directory and iterates (non-recusrively) through the files in that directory, using the
 * file names and file contents to build a hash that is compatible with the configFromEnv function.
 *
 * @param path The path to the directory containing secret files
 * @returns env A key-value hash of the contents of the directory
 */
const inflateSecretsDir = (path: string): { [k: string]: string | undefined } => {
  const env: { [k: string]: string | undefined } = {};
  fs.readdirSync(path).map((f) => {
    env[f] = fs.readFileSync(f, "utf8");
  });
  return env;
};

/**
 * This function does naive extraction of config values from the environment. It is a lower level
 * function that doesn't attempt to do any validation on the resulting config values. Vaidation is
 * expected to be done at higher levels.
 */
const _configFromEnv = (
  env: { [k: string]: string | undefined },
  ns: string = "APP_",
  delimiter: string = "_"
) => {
  const regexp = new RegExp(`^${ns}(.+?)(__[0-9]+)?$`);
  const flat = Object.keys(env)
    .sort()
    .reduce<{ [k: string]: string }>((agg, cur) => {
      if (regexp.test(cur)) {
        let nm = cur.replace(regexp, "$1");
        agg[nm] = env[cur]!;
      }
      return agg;
    }, {});
  return interpret(flat, delimiter);
};

/**
 * This function interprets the values provided in environment variables into actual native
 * javascript values. For example, it casts the string value `5` to the number 5 and it casts the
 * string value `true` to boolean true.
 *
 * To provide for corner cases, you may pass an explicit cast in the value itself in standard cast
 * notation (`<number>5` or `<boolean>true`, for example).
 */
const interpret = (
  flat: { [k: string]: string },
  delimiter: string = "_"
): { [k: string]: unknown } => {
  // For each of the keys in the flattened object...
  return Object.keys(flat).reduce<{ [k: string]: unknown }>((obj, k) => {
    // Explode the key into a path and alias our result object
    const path = k.split(delimiter);

    // Cast the value
    const cast = flat[k].match(/^<(number|string|boolean)>(.*)$/);
    const value =
      // Process as explicit cast if given
      cast
        ? cast[1] === "number"
          ? Number(cast[2])
          : cast[1] === "boolean"
          ? Boolean(nativize(cast[2]))
          : cast[2]
        : // Otherwise, try to infer what it might be and cast accordingly
          nativize(flat[k]);

    // Finally, place the value in the correct location in the tree
    // `current` will point to the current parent node being operated on as we move down the tree
    let current: any = obj;
    //let current: { [k: string]: unknown } | Array<unknown> = obj;

    // For each path part...
    for (let i = 0; i < path.length; i++) {
      // If the current path part looks like an integer, make it one (array index). Otherwise, use
      // it as-is.
      const part = `${parseInt(path[i])}` === path[i] ? parseInt(path[i]) : path[i];

      // If this is the last part, then set the value
      if (i === path.length - 1) {
        current[part] = value;
      } else if (!current.hasOwnProperty(part)) {
        // Otherwise, if we don't already have an object at this path, create one and keep going.
        // If the next part looks like an array index, then make the child an array
        if (typeof path[i + 1] === "number") {
          current[part] = [];
        } else {
          current[part] = {};
        }
      }

      // Set current to point to the next level down and loop around
      current = current[part];
    }

    // Return obj, now that it has been fleshed out with new subtrees and values
    return obj;
  }, {});
};

/**
 * Convert a string value into a native value
 */
const nativize = (v: string): string | boolean | number | null => {
  // Does it look like an int?
  return `${parseInt(v)}` === v
    ? Number(v)
    : // Does it look like a boolean?
    v === "true"
    ? true
    : v === "false"
    ? false
    : // Does it look null?
    v === "null"
    ? null
    : // Must be a string
      v;
};
