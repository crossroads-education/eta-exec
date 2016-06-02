import * as site from "./lib/autoload";

site.server.init("node_modules"); // use ./node_modules/ as a module directory
site.server.start(); // start listening
