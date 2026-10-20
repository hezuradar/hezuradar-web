#!/usr/bin/env node
"use strict";

// Runner de pruebas mínimo, sin dependencias: recorre tests/*.test.js y ejecuta cada
// caso declarado con test(). Uso:
//
//     node tests/run.js            (todo)
//     node tests/run.js prep       (solo los ficheros cuyo nombre contenga "prep")

const fs = require("fs");
const path = require("path");

const TESTS_DIR = __dirname;
const filter = process.argv[2] || "";

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    process.stdout.write("  \x1b[32m✓\x1b[0m " + name + "\n");
  } catch (e) {
    failed++;
    failures.push({ name, error: e });
    process.stdout.write("  \x1b[31m✗\x1b[0m " + name + "\n");
    process.stdout.write("      " + String(e && e.message).split("\n").join("\n      ") + "\n");
  }
}

function assertEqual(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error((msg ? msg + ": " : "") + "esperado " + b + ", recibido " + a);
}

function assertTrue(value, msg) {
  if (!value) throw new Error(msg || "se esperaba un valor verdadero");
}

function assertFalse(value, msg) {
  if (value) throw new Error(msg || "se esperaba un valor falso");
}

const files = fs
  .readdirSync(TESTS_DIR)
  .filter((f) => f.endsWith(".test.js"))
  .filter((f) => !filter || f.includes(filter))
  .sort();

if (!files.length) {
  console.error("No hay ficheros de prueba" + (filter ? " que contengan \"" + filter + "\"" : "") + ".");
  process.exit(1);
}

global.test = test;
global.assertEqual = assertEqual;
global.assertTrue = assertTrue;
global.assertFalse = assertFalse;

for (const f of files) {
  process.stdout.write("\n" + f + "\n");
  require(path.join(TESTS_DIR, f));
}

process.stdout.write("\n" + passed + " correctas, " + failed + " fallidas\n");

if (failed) {
  process.stdout.write("\nFallos:\n");
  failures.forEach((f) => process.stdout.write("  · " + f.name + "\n    " + f.error.message + "\n"));
  process.exit(1);
}
