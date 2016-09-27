require("source-map-support").install();

process.on("uncaughtException", function(err: Error) {
    console.log("An uncaught error occurred: " + err.message);
    console.log(err.stack);
});

import * as site from "./lib/autoload";

site.server.init("modules"); // use ./modules/ as a module directory
