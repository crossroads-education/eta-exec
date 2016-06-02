import * as site from "../autoload";

import * as eta from "eta-lib";
import * as express from "express";
import * as fs from "fs";
import * as mime from "mime";
import * as recursiveReaddir from "recursive-readdir";
import * as urllib from "url";

export class RequestHandler {
    /**
    The module configuration, pulled from eta.json
    */
    public config : eta.ModuleConfiguration;

    /**
    The name of this module
    */
    public moduleName : string;

    /**
    The root directory of this module
    */
    public root : string;

    /**
    Pre-loaded Model instances, indexed by server-relative path.
    */
    public models : {[key : string] : eta.Model} = {};

    public staticDirs : string[];

    public defaultEnv : {[key : string] : any};

    public constructor(moduleName : string, config : eta.ModuleConfiguration) {
        this.config = config;
        this.moduleName = moduleName;
        this.root = site.root + "node_modules/" + this.moduleName + "/";
        this.validateConfig();
        this.staticDirs = fs.readdirSync(this.config.dirs.static);
        this.defaultEnv = JSON.parse(fs.readFileSync(site.root + "lib/defaultEnv.json").toString());
    }

    /**
    This is added as a listener for its path on the main WebServer.
    Must be a callback builder so we preserve `this.` scope.
    */
    public handle() : (req : express.Request, res : express.Response, next : Function) => void {
        return (req : express.Request, res : express.Response, next : Function) : void => {
            let path : string = req.path.substring(this.config.path.length - 1);
            if (path.startsWith("/static")) { // should be accessed by /whatever, not /static/whatever
                site.server.renderError(eta.http.NotFound, req, res); // technically it does exist, though (possibly)
                return;
            }
            for (let i : number = 0; i < this.staticDirs.length; i++) {
                if (path.startsWith("/" + this.staticDirs[i] + "/")) {
                    this.serveStatic(req, res, path);
                    return;
                }
            }
            if (path.endsWith("/")) {
                path += "index"; // so we can interpret it properly
            }
            eta.fs.exists(this.config.dirs.views + path + ".pug", (exists : boolean) => {
                if (!exists) {
                    site.logger.trace("View for " + req.path + " does not exist.");
                    site.server.renderError(eta.http.NotFound, req, res);
                    return;
                }
                this.renderPage(req, res, path);
            });
        };
    }

    private serveStatic(req : express.Request, res : express.Response, path : string) : void {
        eta.fs.exists(this.config.dirs.static + path, (exists : boolean) => {
            if (!exists) {
                site.logger.trace("Static file " + req.path + " does not exist.");
                site.server.renderError(eta.http.NotFound, req, res);
                return;
            }
            fs.readFile(this.config.dirs.static + path, (err : NodeJS.ErrnoException, data : Buffer) => {
                if (err) {
                    site.logger.warn("Error reading file from " + req.path);
                    site.server.renderError(eta.http.InternalError, req, res);
                    return;
                }
                res.set("Content-Type", mime.lookup(req.path));
                res.send(data.toString());
            });
        });
    }

    /**
    Renders a view (and possibly a model) once the view is known to exist.
    */
    private renderPage(req : express.Request, res : express.Response, path : string) : void {
        let env : {[key : string] : any} = {
            "baseurl": "//" + req.get("host") + this.config.path
        };
        for (let i in this.defaultEnv) {
            env[i] = this.defaultEnv[i];
        }
        if (fs.existsSync(this.config.dirs.static + "js" + path + ".js")) {
            env["mainjs"] = path.substring(1);
        }
        if (this.models[path]) {
            this.models[path].render(req, res, (modelEnv : {[key : string] : any}) => {
                for (let i in modelEnv) {
                    env[i] = modelEnv[i];
                }
                this.onRenderPage(res, env, path);
            });
        } else {
            this.onRenderPage(res, env, path);
        }
    }

    /**
    Needs to be separate so that scope is preserved.
    */
    private onRenderPage(res : express.Response, env : {[key : string] : any}, path : string) : void {
        res.render(this.config.dirs.views + path, env, (err : Error, html : string) => {
            if (err) {
                site.logger.warn(`Rendering ${path} failed:`);
                site.logger.warn(err.message);
                return;
            }
            res.send(html);
        });
    }

    /**
    Discovers and initializes models, placing them in `this.models`
    */
    private setupModels() : void {
        let ignoredGlobs : string[] = ["*.ts"];
        // each file is a relative path from the site root (technically process.cwd(), which should be site root)
        recursiveReaddir(this.config.dirs.models, ignoredGlobs, (err : NodeJS.ErrnoException, files : string[]) => {
            for (let i : number = 0; i < files.length; i++) {
                if (!files[i].endsWith(".js")) {
                    return;
                }
                let filename : string = files[i].replace(/\\/g, "/");

                // removing absolute directory from path, since it's not in the webserver request
                let tokens : string[] = filename.substring(this.config.dirs.models.length - 1).split("/");
                tokens.splice(-1, 1); // remove the actual filename, since that isn't important (structure is /{path}/whatever.ts)

                let path : string = tokens.join("/"); // path relative to webserver root

                // only if .endsWith("js"), but there's nothing else yet
                let handler : any = require(filename); // we don't really know what else might be exported along with Model
                let model : eta.Model = new handler.Model(); // the file must export Model implements eta.Model
                this.models[path] = model;
            }
        });
    }

    /**
    Fills in any optional parameters for `this.config`
    */
    private validateConfig() : void {
        if (!this.config.dirs) {
            this.config.dirs = {};
        }
        let dirs : string[] = ["models", "static", "views"];
        let configDirs : {[key : string] : string} = <{[key : string] : string}> this.config.dirs;
        for (let i : number = 0; i < dirs.length; i++) {
            // very ugly type manipulation, please do not look
            // forcing this.config.dirs to be a generic object so we can look up seemingly random keys
            // then if the key doesn't exist, add it as the default value (moduleRoot + keyName)
            if (!configDirs[dirs[i]]) {
                configDirs[dirs[i]] = this.root + dirs[i] + "/";
            }
        }
    }
}
