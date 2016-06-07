/// <reference path="../typings/index.d.ts"/>
/// <reference path="../node_modules/eta-lib/index.ts"/>

// *** module imports ***
import "es6-shim"; // Stuff like String.prototype.startsWith() that isn't in ES5
import * as eta from "eta-lib";
import * as fs from "fs";

// *** template imports ***
import {Configuration} from "./interfaces/Configuration";

// *** variable exports ***
export let config : Configuration = JSON.parse(fs.readFileSync("./config/main.json").toString());
export let root : string = process.cwd().replace(/\\/g, "/") + "/"; // root of this repository

// *** class exports ***
export {WebServer as server} from "./classes/WebServer";

// *** interface exports ***
export {RequestHandler} from "./classes/RequestHandler";
