import * as site from "../autoload";

import * as eta from "eta-lib";
import * as express from "express";
import * as fs from "fs";
import * as knex from "knex";

// express middleware imports
import * as bodyParser from "body-parser";
import * as multer from "multer";
import * as session from "express-session";

// store session data in a DB
let KnexSessionStore : any = require("connect-session-knex")(session);

export class WebServer {
    public static app : express.Application;
    public static modules : {[key : string] : site.RequestHandler} = {};
    public static moduleDir : string;

    public static init(moduleDir : string) : void {
        WebServer.app = express();
        WebServer.moduleDir = moduleDir + "/";
        WebServer.configure();
        WebServer.setupModules();
    }

    public static start() : void {
        WebServer.app.listen(site.config.http.port, () => {
            site.logger.info("Server started on port " + site.config.http.port);
        });
    }

    public static renderError(code : number, req : express.Request, res : express.Response) : void {
        res.statusCode = code;
        res.render(site.root + "views/error", {
            "code": code,
            "email": "webmaster@" + req.hostname
        });
    }

    private static setupModules() : void {
        fs.readdir(site.root + WebServer.moduleDir, (err : NodeJS.ErrnoException, files : string[]) => {
            if (err) {
                throw err;
            }
            for (let i : number = 0; i < files.length; i++) {
                let dir : string = site.root + WebServer.moduleDir + files[i] + "/";
                if (!eta.fs.existsSync(dir + "eta.json")) {
                    continue; // this isn't an Eta module, so we don't care
                }
                let moduleConfig : eta.ModuleConfiguration = JSON.parse(fs.readFileSync(dir + "eta.json").toString());
                let handler : site.RequestHandler = new site.RequestHandler(files[i], moduleConfig);
                site.logger.trace("Found module... " + handler.config.path + " : " + handler.moduleName);
                WebServer.modules[handler.moduleName] = handler;
                WebServer.app.all(handler.config.path + "*", handler.handle());
            }
        });
    }

    private static configure() : void {
        // extensions and parsing definition for express
        WebServer.app.set("view engine", "pug");

        if (site.config.dev.use) {
            WebServer.app.locals.pretty = true; // render Pug as readable HTML
            WebServer.app.disable("view cache"); // reload Pug views on render
        }

        WebServer.setupMiddleware();
    }

    private static setupMiddleware() : void {
        // sessions
        let sessionDB : knex = knex({
            "client": "mysql",
            "connection": site.config.db.session
        });
        WebServer.app.use(session({
            "secret": site.config.http.secret,
            "resave": false,
            "saveUninitialized": false,
            "store": new KnexSessionStore({
                "knex": sessionDB
            })
        }));

        // file uploading
        WebServer.app.use(multer({
            "storage": multer.memoryStorage()
        }).any());

        // POST parsing
        WebServer.app.use(bodyParser.urlencoded({
            "extended": false
        }));
    }
}
