import * as site from "../autoload";

import * as chokidar from "chokidar";
import * as eta from "eta-lib";
import * as express from "express";
import * as fs from "fs";
import * as mime from "mime";
import * as recursiveReaddir from "recursive-readdir";
import * as urllib from "url";

let reload: (id: string) => any = require("require-reload")(require);

export class RequestHandler {
    /**
    The module configuration, pulled from eta.json
    */
    public config: eta.ModuleConfiguration;

    /**
    The name of this module
    */
    public moduleName: string;

    /**
    The root directory of this module
    */
    public root: string;

    /**
    Pre-loaded Model instances, indexed by server-relative path.
    */
    public models: { [key: string]: eta.Model } = {};

    public staticDirs: string[];

    public defaultEnv: { [key: string]: any };

    /**
    Contents of redirects.json. Key: original, value: new URL.
    Relative to module (not server) root.
    */
    public redirects: { [key: string]: string } = {};

    public constructor(moduleName: string, config: eta.ModuleConfiguration) {
        this.config = config;
        this.moduleName = moduleName;
        this.root = site.root + site.server.moduleDir + "/" + this.moduleName + "/";
        this.validateConfig();
        this.staticDirs = fs.readdirSync(this.config.dirs.static);
        let redirectFile: string = this.config.dirs.models + "redirects.json";
        this.redirects = eta.fs.existsSync(redirectFile) ? JSON.parse(fs.readFileSync(redirectFile).toString()) : {};
        this.setupDefaultEnv();
        this.setupModels();
    }

    /**
    This is added as a listener for its path on the main WebServer.
    Must be a callback builder so we preserve `this.` scope.
    */
    public handle(): (req: express.Request, res: express.Response, next: Function) => void {
        return (req: express.Request, res: express.Response, next: Function): void => {
            let path: string = req.path.substring(this.config.path.length - 1).replace(/\/\//g, "/");
            if (path.startsWith("/static")) { // should be accessed by /whatever, not /static/whatever
                site.server.renderError(eta.http.NotFound, req, res); // technically it does exist, though (possibly)
                return;
            }
            for (let i: number = 0; i < this.staticDirs.length; i++) {
                if (path.startsWith("/" + this.staticDirs[i] + "/")) {
                    this.serveStatic(req, res, path, next);
                    return;
                }
            }
            if (path.endsWith("/")) {
                path += "index"; // so we can interpret it properly
            }
            if (this.redirects[path]) {
                let url: string = this.redirects[path];
                if (!url.startsWith("http://") && !url.startsWith("https://")) {
                    url = this.config.path + url;
                }
                res.redirect(301, url);
                return;
            }
            eta.fs.exists(this.config.dirs.views + path + ".pug", (exists: boolean) => {
                if (!exists) {
                    if (path.startsWith("/post/")) {
                        if (!this.models[path]) {
                            site.server.renderError(eta.http.NotFound, req, res);
                            return;
                        }
                        this.renderPage(req, res, path);
                        return;
                    }
                    if (!path.endsWith("/") && eta.fs.existsSync(this.config.dirs.views + path)) {
                        res.redirect(req.path + "/");
                        return;
                    }
                    if (this.config.path == "/") { // it won't give other modules a chance to handle the request
                        next();
                    } else {
                        eta.logger.trace("View for " + req.path + " (handler " + this.moduleName + ") does not exist.");
                        site.server.renderError(eta.http.NotFound, req, res);
                    }
                    return;
                }
                this.renderPage(req, res, path);
            });
        };
    }

    private serveStatic(req: express.Request, res: express.Response, path: string, next: Function): void {
        eta.fs.exists(this.config.dirs.static + path, (exists: boolean) => {
            if (!exists) {
                if (this.config.path == "/") {
                    next();
                    return;
                }
                eta.logger.trace("Static file " + req.path + " does not exist.");
                site.server.renderError(eta.http.NotFound, req, res);
                return;
            }
            fs.readFile(this.config.dirs.static + path, (err: NodeJS.ErrnoException, data: Buffer) => {
                if (err) {
                    eta.logger.warn("Error reading file from " + req.path);
                    site.server.renderError(eta.http.InternalError, req, res);
                    return;
                }
                res.set("Content-Type", mime.lookup(req.path));
                res.send(data);
            });
        });
    }

    private setupDefaultEnv() {
        this.defaultEnv = JSON.parse(fs.readFileSync(site.root + "lib/defaultEnv.json").toString());
        let customEnvFile: string = this.config.dirs.models + "env.json";
        if (eta.fs.existsSync(customEnvFile)) {
            this.defaultEnv = this.addToEnv(this.defaultEnv, JSON.parse(fs.readFileSync(customEnvFile).toString()));
        }
    }

    private addToEnv(env: { [key: string]: any }, newEnv: { [key: string]: any }): { [key: string]: any } {
        for (let i in newEnv) {
            if (newEnv[i] instanceof Array && env[i] instanceof Array) {
                env[i] = env[i].concat(newEnv[i]);
            } else {
                env[i] = newEnv[i];
            }
        }
        return env;
    }

    /**
    Renders a view (and possibly a model) once the view is known to exist.
    */
    private renderPage(req: express.Request, res: express.Response, path: string): void {
        let env: { [key: string]: any } = {
            "baseurl": req.protocol + "://" + req.get("host") + this.config.path,
            "models": []
        };
        for (let i in this.defaultEnv) {
            env[i] = eta.object.copy(this.defaultEnv[i]);
        }
        if (eta.fs.existsSync(this.config.dirs.static + "js" + path + ".js")) {
            env["mainjs"] = this.config.path + "js" + path + ".js";
        }
        if (eta.fs.existsSync(this.config.dirs.static + "css" + path + ".css")) {
            env["css"].push(this.config.path + "css" + path + ".css");
        }
        let jsonFile: string = this.config.dirs.models + path + "/" + path.split("/").splice(-1, 1) + ".json";
        if (eta.fs.existsSync(jsonFile)) {
            try {
                env = this.addToEnv(env, JSON.parse(fs.readFileSync(jsonFile).toString()));
            } catch (err) {
                eta.logger.warn("JSON is formatted incorrectly in " + jsonFile);
            }
        }
        if (!env["useRedirect"]) {
            req.session["returnTo"] = req.path;
        }
        if (env["requiresLogin"] && !req.session["userid"]) {
            res.redirect("/login");
            return;
        }
        if (env["allowedPositions"]) {
            let isAllowed: boolean = false;
            for (let i: number = 0; i < req.session["positions"].length; i++) {
                if (env["allowedPositions"].indexOf(req.session["positions"][i]) !== -1) {
                    isAllowed = true;
                }
            }
            if (!isAllowed) {
                site.server.renderError(eta.http.Forbidden, req, res);
            }
        }
        if (this.models[path]) {
            env["models"].push(path);
        }
        if (env["models"].length == 0) {
            this.onRenderPage(req, res, env, path);
            return;
        }

        function renderModels(): void {
            let modelEnvs: { [key: string]: any }[] = [];
            function onRenderComplete() {
                for (let i: number = 0; i < modelEnvs.length; i++) {
                    env = this.addToEnv(env, modelEnvs[i]);
                }
                if (env["errcode"]) {
                    site.server.renderError(env["errcode"], req, res);
                    return;
                }
                if (path.startsWith("/post/")) {
                    let data: string | Buffer = "";
                    if (env["raw"]) {
                        data = env["raw"];
                        if (!(<any>data instanceof Buffer)) {
                            data = data.toString();
                        }
                    }
                    res.send(data);
                    return;
                }
                this.onRenderPage(req, res, env, path);
            }
            for (let i: number = 0; i < env["models"].length; i++) {
                let modelPath: string = env["models"][i];
                if (!this.models[modelPath]) {
                    eta.logger.warn("Model " + modelPath + " not found for page " + path);
                    continue;
                }
                if (this.models[modelPath].setParams) {
                    this.models[modelPath].setParams({
                        "baseUrl": env["baseurl"],
                        "fullUrl": env["baseurl"] + path.substring(1)
                    });
                }
                if (modelPath != path) {
                    let jsonFile: string = this.config.dirs.models + modelPath + "/" + modelPath.split("/").splice(-1, 1) + ".json";
                    if (eta.fs.existsSync(jsonFile)) {
                        try {
                            env = this.addToEnv(env, JSON.parse(fs.readFileSync(jsonFile).toString()));
                        } catch (err) {
                            eta.logger.warn("JSON is formatted incorrectly in " + jsonFile);
                        }
                    }
                }
                this.models[modelPath].render(req, res, (modelEnv: { [key: string]: any }) => {
                    modelEnvs[i] = modelEnv;
                    if (modelEnvs.length == env["models"].length) {
                        for (let k: number = 0; k < modelEnvs.length; k++) {
                            if (modelEnvs[k] == undefined) {
                                return; // not actually done
                            }
                        }
                        onRenderComplete.apply(this);
                    }
                });
            }
        }

        if ((env["usePermissions"] || env["permissions"]) && req.session["userid"]) {
            eta.permission.getUser(req.session["userid"], (user: eta.PermissionUser) => {
                if (!user) {
                    site.server.renderError(eta.http.InternalError, req, res);
                    return;
                }
                if (env["permissions"]) {
                    for (let i: number = 0; i < env["permissions"].length; i++) {
                        if (!user.has(env["permissions"][i])) {
                            eta.logger.warn(`User ${req.session["userid"]} does not have permission ${env["permissions"][i]} to access ${path}`);
                            site.server.renderError(eta.http.Forbidden, req, res);
                            return;
                        }
                    }
                }
                req.session["permissions"] = user;
                renderModels.apply(this);
            });
        } else {
            renderModels.apply(this);
        }
    }

    /**
    Needs to be separate so that scope is preserved.
    */
    private onRenderPage(req: express.Request, res: express.Response, env: { [key: string]: any }, path: string): void {
        if (eta.config.dev.use) {
            env["compileDebug"] = true;
        }
        res.render(this.config.dirs.views + path, env, (err: Error, html: string) => {
            if (err) {
                eta.logger.warn(`Rendering ${path} failed:`);
                eta.logger.warn(err.message);
                site.server.renderError(eta.http.InternalError, req, res);
                return;
            }
            if (this.models[path] && this.models[path].renderAfter) {
                this.models[path].renderAfter(html, res);
                return;
            }
            res.send(html);
        });
    }

    private loadModel(filename: string): void {
        // removing absolute directory from path, since it's not in the webserver request
        let tokens: string[] = filename.substring(this.config.dirs.models.length - 1).split("/");
        tokens.splice(-1, 1); // remove the actual filename, since that isn't important (structure is /{path}/whatever.ts)

        let path: string = "/" + tokens.join("/"); // path relative to module root

        // only if .endsWith("js"), but there's nothing else yet
        try {
            let handler: any = require(filename); // we don't really know what else might be exported along with Model
            let model: eta.Model = new handler.Model(); // the file must export Model implements eta.Model
            this.models[path] = model;
            if (this.models[path].onScheduleInit) {
                this.models[path].onScheduleInit();
            }
        } catch (ex) {
            eta.logger.warn("Could not load model for " + path + ": " + ex.message);
        }
    }

    /**
    Discovers and initializes models, placing them in `this.models`
    */
    private setupModels(): void {
        if (eta.config.dev.use) { // never do this in production
            let watcher: fs.FSWatcher = chokidar.watch(this.config.dirs.models, {
                "persistent": false
            });
            watcher.on("change", (path: string) => {
                path = path.replace(/\\/g, "/");
                if (!path.endsWith(".js")) {
                    return;
                }
                reload(path);
                this.loadModel(path);
            });
        }
        let ignoredGlobs: string[] = ["*.ts"];
        // each file is a relative path from the site root (technically process.cwd(), which should be site root)
        recursiveReaddir(this.config.dirs.models, ignoredGlobs, (err: NodeJS.ErrnoException, files: string[]) => {
            if (err) {
                eta.logger.warn("Could not read " + this.config.dirs.models + " recursively.");
                eta.logger.trace(err.message);
                return;
            }
            for (let i: number = 0; i < files.length; i++) {
                if (!files[i].endsWith(".js")) {
                    continue;
                }
                let filename: string = files[i].replace(/\\/g, "/");
                this.loadModel(filename);
            }
        });
    }

    /**
    Fills in any optional parameters for `this.config`
    */
    private validateConfig(): void {
        if (!this.config.dirs) {
            this.config.dirs = {};
        }
        let dirs: string[] = ["models", "static", "views"];
        let configDirs: { [key: string]: string } = <{ [key: string]: string }>this.config.dirs;
        for (let i: number = 0; i < dirs.length; i++) {
            // very ugly type manipulation, please do not look
            // forcing this.config.dirs to be a generic object so we can look up seemingly random keys
            // then if the key doesn't exist, add it as the default value (moduleRoot + keyName)
            if (!configDirs[dirs[i]]) {
                configDirs[dirs[i]] = this.root + dirs[i] + "/";
            }
        }
    }
}
