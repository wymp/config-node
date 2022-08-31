import { config as configFunc } from "../src";
import * as rt from "runtypes";

// Mock the fs functions
let ConfigFileContents: string = "{}";
let ConfigOverrideContents: string = "{}";
let DirList: { [dir: string]: Array<string> } = { "/secrets": ["APP_b"] };
let OtherFileContents: { [file: string]: string } = { APP_b: "true" };
let ConfigOverrideExists = true;
jest.mock("fs", () => {
  const originalModule = jest.requireActual("fs");
  return {
    __esModule: true,
    ...originalModule,
    existsSync: (f: string) => f === "config.json" || ConfigOverrideExists,
    readFileSync: (f: string) => {
      if (f === "config.json") {
        return ConfigFileContents;
      } else if (f === "config.local.json") {
        return ConfigOverrideContents;
      } else {
        if (!OtherFileContents[f]) {
          throw new Error(
            `TEST ERROR: You've requested the contents of file '${f}', but that file is not ` +
              `defined in the OtherFileContents object. Please add a value to that object and ` +
              `try again.`
          );
        } else {
          return OtherFileContents[f];
        }
      }
    },
    readdirSync: (d: string) => {
      if (!DirList[d]) {
        throw new Error(
          `TEST ERROR: You've attempted to get a directory listing for '${d}', but you haven't ` +
            `loaded the 'DirList' variable with an array of file names for that directory. Please ` +
            `set 'DirList["${d}"]' to an array of file names.`
        );
      }
      return DirList[d];
    },
  };
});

const testConfigValidator = rt.Record({
  a: rt.Record({
    one: rt.Literal(1),
    two: rt.String,
    three: rt.Boolean,
  }),
  b: rt.Optional(rt.Union(rt.Boolean, rt.Null)),
  c: rt.Literal("Exactly C"),
});
declare type TestConfig = rt.Static<typeof testConfigValidator>;

describe("Config function", () => {
  beforeEach(() => {
    delete process.env.APP_a_one;
    delete process.env.APP_a_two;
    delete process.env.APP_a_three;
    delete process.env.APP_b;
    delete process.env.APP_c;

    ConfigFileContents = JSON.stringify({
      a: {
        one: 1,
        two: "Two",
        three: true,
      },
      b: false,
      c: "Exactly C",
    });
    ConfigOverrideContents = "{}";
    ConfigOverrideExists = true;
    DirList = { "/secrets": ["APP_b"] };
    OtherFileContents = { APP_b: "true" };
  });

  function setEnv() {
    process.env.APP_a_one = "1";
    process.env.APP_a_two = "Two";
    process.env.APP_a_three = "false";
    process.env.APP_b = "true";
    process.env.APP_c = "Exactly C";
  }

  const par = "NOTE: YOU MUST USE THE -i FLAG TO TELL JEST NOT TO RUN IN PARALLEL FOR THESE TESTS";

  [
    ["APP_a_one", "3", `Details: \{[\\n\\r][ \\t]*"a": \{[\\r\\n][ \\t]*"one"`],
    ["APP_a_two", "12345", `Details: \{[\\n\\r][ \\t]*"a": \{[\\r\\n][ \\t]*"two"`],
    ["APP_a_three", "string", `Details: \{[\\n\\r][ \\t]*"a": \{[\\r\\n][ \\t]*"three"`],
    ["APP_b", "string", `Details: \{[\\n\\r][ \\t]*"b": "Expected`],
    ["APP_c", "Not C", `Details: \{[\\n\\r][ \\t]*"c": "Expected`],
  ].map((testCase) => {
    test(`should throw errors when ${testCase[0]} is ${testCase[1]}`, () => {
      // Set the config in the environment
      setEnv();

      // Make the invalidating adjustment
      if (testCase[1] === null) {
        delete process.env[<string>testCase[0]];
      } else {
        process.env[<string>testCase[0]] = testCase[1];
      }

      // Try it
      try {
        configFunc(`APP_`, { env: process.env }, testConfigValidator);
        throw new Error("Fail");
      } catch (e) {
        expect(e.message).not.toBe("Fail");
        expect(e.message).toMatch(new RegExp(testCase[2]));
      }
    });
  });

  [
    ["APP_b", null],
    ["APP_b", "null"],
    ["APP_a_three", "false"],
  ].map((testCase) => {
    test(`${JSON.stringify(testCase)}: should successfully draw config from environment`, () => {
      setEnv();
      if (testCase[1] === null) {
        delete process.env[<string>testCase[0]];
      } else {
        process.env[<string>testCase[0]] = testCase[1];
      }
      const { config } = configFunc(`APP_`, { env: process.env }, testConfigValidator);
      expect(config.a.one).toBe(1);
      expect(config.a.two).toBe("Two");
      expect(config.a.three).toBe(false);

      if (testCase[0] == "APP_b") {
        if (testCase[1] === null) {
          expect(config).not.toHaveProperty("b");
        } else {
          expect(config.b).toBe(null);
        }
      }

      expect(config.c).toBe("Exactly C");
    });
  });

  test(`should use file for defaults when provided`, () => {
    const { config } = configFunc<any>(
      `APP_`,
      {
        env: {
          APP_a_one: "2",
          APP_a_two: "one",
        },
        defaultsFile: "config.json",
      },
      { check: (c: any) => c }
    );

    expect(config).toMatchObject({
      a: {
        one: 2,
        two: "one",
        three: true,
      },
      b: false,
      c: "Exactly C",
    });
  });

  test(`should cast correctly`, () => {
    const { config } = configFunc<any>(
      `APP_`,
      {
        env: {
          APP_a_one: "<string>1",
          APP_a_two: "<string>true",
          APP_b: "<boolean>0",
          APP_c: "<number>1e2",
        },
      },
      { check: (c: any) => c }
    );
    expect(config).toMatchObject({
      a: {
        one: "1",
        two: "true",
      },
      b: false,
      c: 100,
    });
  });

  test("Loads config from files", () => {
    const r = configFunc(
      `APP_`,
      {
        defaultsFile: "config.json",
        localsFile: "config.local.json",
      },
      testConfigValidator
    );
    expect(r.config).toBeDefined();
    expect(r.config.a.one).toBe(1);
    expect(r.config.b).toBe(false);
    //expect(r.config.four).not.toBeDefined(); // < This should fail type-checking on uncomment
  });

  test("Can override default config", () => {
    ConfigOverrideContents = JSON.stringify({ a: { two: "Three" }, b: true });
    const r = configFunc(
      `APP_`,
      {
        defaultsFile: "config.json",
        localsFile: "config.local.json",
      },
      testConfigValidator
    );
    expect(r.config).toBeDefined();
    expect(r.config.a.one).toBe(1);
    expect({ par, v: r.config.a.two }).toEqual({ par, v: "Three" });
    expect(r.config.b).toBe(true);
  });

  test("Skips override if file not exists", () => {
    ConfigOverrideContents = JSON.stringify({ a: { two: "Three" }, b: true });
    ConfigOverrideExists = false;
    const r = configFunc(
      `APP_`,
      {
        defaultsFile: "config.json",
        localsFile: "config.local.json",
      },
      testConfigValidator
    );
    expect(r.config).toBeDefined();
    expect(r.config.a.one).toBe(1);
    expect({ par, v: r.config.a.two }).toEqual({ par, v: "Two" });
    expect(r.config.b).toBe(false);
  });

  test("assembles config in correct order", () => {
    // Happy path
    process.env.APP_a_three = "false";
    ConfigOverrideContents = JSON.stringify({ a: { two: "Four" } });
    OtherFileContents = { APP_b: "true" };
    const { config } = configFunc(
      "APP_",
      {
        env: process.env,
        defaultsFile: "config.json",
        localsFile: "config.local.json",
        secretsDir: "/secrets",
      },
      testConfigValidator
    );

    expect(config).toMatchObject({
      a: {
        one: 1,
        two: "Four",
        three: false,
      },
      b: true,
      c: "Exactly C",
    });
  });

  [
    ["env", { APP_a_one: "2", APP_a_two: "Four" }],
    ["defaultsFile", "config.json"],
    ["localsFile", "config.local.json"],
    ["secretsDir", "/secrets"],
  ].map((pair) => {
    test(`works with just ${pair[0]}`, () => {
      // Setting all of these every time, even though only one will be used each time
      ConfigFileContents = JSON.stringify({ a: { one: 2, two: "Four" } });
      ConfigOverrideContents = JSON.stringify({ a: { one: 2, two: "Four" } });
      ConfigOverrideExists = true;
      DirList = { "/secrets": ["APP_a_one", "APP_a_two"] };
      OtherFileContents = { APP_a_one: "2", APP_a_two: "Four" };

      const { config } = configFunc(
        "APP_",
        { [pair[0] as any]: pair[1] },
        { check: (c: any) => c }
      );

      expect(config.a).toBeDefined();
      expect(config.a.one).toBe(2);
      expect(config.a.two).toBe("Four");
    });
  });

  test(`handles version suffixes correctly`, () => {
    const r = configFunc(
      `APP_`,
      {
        env: {
          APP_a_two__003: "<string>3",
          APP_a_two__001: "one",
          APP_a_two: "<string>100",
        },
        defaultsFile: "config.json",
      },
      testConfigValidator
    );
    expect(r.config).toBeDefined();
    expect(r.config.a.two).toBe("3");
  });
});
