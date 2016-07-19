import * as site from "../autoload";

import * as eta from "eta-lib";
import * as express from "express";
import * as https from "https";
import * as fs from "fs";
import * as knex from "knex";
import * as mysql from "mysql";
import * as nodemailer from "nodemailer";

// express middleware imports
import * as bodyParser from "body-parser";
import * as multer from "multer";
import * as session from "express-session";

// store session data in a DB
let MySQLStore : any = require("express-mysql-session")(session);

export class WebServer {
    public static app : express.Application;
    public static modules : {[key : string] : site.RequestHandler} = {};
    public static moduleDir : string;

    public static init(moduleDir : string) : void {
        (<any>eta).config = JSON.parse(fs.readFileSync("./config/main.json").toString());
        WebServer.app = express();
        WebServer.moduleDir = moduleDir + "/";
        WebServer.configure();
        WebServer.setupModules();
        WebServer.initEtaLib();
    }

    public static start() : void {
        if (eta.config.http.ssl.use) {
            https.createServer({
                "key": fs.readFileSync(eta.config.http.ssl.key).toString(),
                "cert": fs.readFileSync(eta.config.http.ssl.cert).toString()
            }, WebServer.app).listen(eta.config.http.ssl.port, function() {
                eta.logger.info("HTTPS server started on port " + eta.config.http.ssl.port)
            });
        }
        WebServer.app.listen(eta.config.http.port, function() {
            eta.logger.info("HTTP server started on port " + eta.config.http.port);
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
                eta.logger.trace(`Discovered module "${files[i]}" to handle path "${handler.config.path}"`);
                WebServer.modules[handler.moduleName] = handler;
                WebServer.app.all(handler.config.path + "*", handler.handle());
            }
        });
    }

    private static configure() : void {
        // extensions and parsing definition for express
        WebServer.app.set("view engine", "pug");

        if (eta.config.dev.use) {
            WebServer.app.locals.pretty = true; // render Pug as readable HTML
            WebServer.app.disable("view cache"); // reload Pug views on render
        }

        WebServer.setupMiddleware();
    }

    private static setupMiddleware() : void {
        (<any>eta).db = mysql.createConnection(eta.config.db);
        WebServer.app.use(session({
            "secret": eta.config.http.secret,
            "resave": true,
            "saveUninitialized": false,
            "store": new MySQLStore({}, eta.db)
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

    private static initEtaLib() {
        // have to do some hacky stuff to get this working
        (<any>eta).logger = new eta.Logger(process.cwd());
        (<any>eta).knex = knex({
            "client": "mysql",
            "connection": eta.config.db
        });
        let smtpString : string = "smtp";
        if (eta.config.mail.secure) {
            smtpString += "s";
        }
        smtpString += "://" + eta.config.mail.host + ":" + eta.config.mail.port;
        (<any>eta).mail = nodemailer.createTransport(smtpString);
        eta.db.on("error", (err : eta.DBError) => {
            eta.logger.warn("Database error: " + err.code);
        });
        eta.db.connect((err : eta.DBError) => {
            if (err) {
                eta.logger.warn("Error connecting to database: " + err.code);
            } else {
                eta.logger.info("Database connected.");
            }
            for (let name in eta) {
                let obj : any = (<any>eta)[name];
                if (obj.init) { // assuming that .init() should be called daily + on start
                    eta.logger.trace("Initializing helper " + name);
                    obj.init();
                }
            }
            this.start();
        });
    }
}
