/// <reference path="../typings/bluebird/bluebird.d.ts"/>
/// <reference path="emitter/util.ts"/>

namespace pxt {
    export import U = ts.pxt.Util;
    export import Util = ts.pxt.Util;
    let lf = U.lf;

    export var appTarget: TargetBundle;

    // general error reported
    export var reportException: (err: any, data: any) => void = function(e, d) {
        if (console) {
            console.error(e);
            if (d) {
                try {
                    console.log(JSON.stringify(d, null, 2))
                } catch (e) { }
            }
        }
    }
    export var reportError: (msg: string, data: any) => void = function(m, d) {
        if (console) {
            console.error(m);
            if (d) {
                try {
                    console.log(JSON.stringify(d, null, 2))
                } catch (e) { }
            }
        }
    }

    export type CompileTarget = ts.pxt.CompileTarget;

    export interface Host {
        readFile(pkg: Package, filename: string): string;
        writeFile(pkg: Package, filename: string, contents: string): void;
        downloadPackageAsync(pkg: Package): Promise<void>;
        getHexInfoAsync(extInfo: ts.pxt.ExtensionInfo): Promise<any>;
        resolveVersionAsync(pkg: Package): Promise<string>;
        cacheStoreAsync(id: string, val: string): Promise<void>;
        cacheGetAsync(id: string): Promise<string>; // null if not found
    }

    export interface CodeCard {
        name?: string;

        color?: string; // one of semantic ui colors
        description?: string;
        promoUrl?: string;
        blocksXml?: string;
        typeScript?: string;
        header?: string;
        time?: number;
        link?: boolean;
        url?: string;
        responsive?: boolean;

        any?: number;
        hardware?: number;
        software?: number;
        blocks?: number;
        javascript?: number;

        onClick?: (e: any) => void; // React event

        target?: string;
    }

    export interface TargetVersions {
        target: string;
        kindscript: string;
        tag?: string;
        branch?: string;
        commits?: string; // URL
    }

    export interface AppTarget {
        id: string; // has to match ^[a-z\-]+$; used in URLs and domain names
        name: string;
        title?: string;
        cloud?: AppCloud;
        simulator?: AppSimulator;
        blocksprj: ProjectTemplate;
        tsprj: ProjectTemplate;
        compile: CompileTarget;
        serial?: AppSerial;
        appTheme: AppTheme;
        compileService?: {
            gittag: string;
            serviceId: string;
        }
    }

    export interface TargetBundle extends AppTarget {
        bundledpkgs: U.Map<U.Map<string>>;
        bundleddirs: string[];
        versions: TargetVersions;
    }

    export interface PackageConfig {
        name: string;
        installedVersion?: string;
        description?: string;
        dependencies: U.Map<string>;
        files: string[];
        simFiles?: string[];
        testFiles?: string[];
        public?: boolean;
        binaryonly?: boolean;
        microbit?: ts.pxt.MicrobitConfig;
        card?: CodeCard;
    }

    // this is for remote file interface to packages
    export interface FsFile {
        name: string;  // eg "main.ts"
        mtime: number; // ms since epoch
        content?: string; // not returned in FsPkgs
        prevContent?: string; // only used in write reqs
    }

    export interface FsPkg {
        path: string; // eg "foo/bar"
        config: pxt.PackageConfig; // kind.json
        files: FsFile[]; // this includes kind.json
    }

    export interface FsPkgs {
        pkgs: FsPkg[];
    }

    export interface ProjectTemplate {
        id: string;
        config: pxt.PackageConfig;
        files: U.Map<string>;
    }

    export interface AppSerial {
        manufacturerFilter?: string;
        log?: boolean;
    }

    export interface AppCloud {
        workspaces?: boolean;
        packages?: boolean;
    }

    export interface AppSimulator {
        autoRun?: boolean;
    }

    export interface ICompilationOptions {

    }

    export function getEmbeddedScript(id: string): Util.StringMap<string> {
        return U.lookup(appTarget.bundledpkgs || {}, id)
    }

    export class Package {
        public config: PackageConfig;
        public level = -1;
        public isLoaded = false;
        private resolvedVersion: string;

        constructor(public id: string, public _verspec: string, public parent: MainPackage) {
            if (parent) {
                this.level = this.parent.level + 1
            }
        }

        version() {
            return this.resolvedVersion || this._verspec;
        }

        verProtocol() {
            let spl = this.version().split(':')
            if (spl.length > 1) return spl[0]
            else return ""
        }

        verArgument() {
            let p = this.verProtocol()
            if (p) return this.version().slice(p.length + 1)
            return this.version()
        }

        host() { return this.parent._host }

        readFile(fn: string) {
            return this.host().readFile(this, fn)
        }

        resolveDep(id: string) {
            if (this.parent.deps.hasOwnProperty(id))
                return this.parent.deps[id];
            return null
        }

        protected saveConfig() {
            let cfg = JSON.stringify(this.config, null, 4) + "\n"
            this.host().writeFile(this, configName, cfg)
        }

        private resolveVersionAsync() {
            let v = this._verspec

            if (getEmbeddedScript(this.id)) {
                this.resolvedVersion = v = "embed:" + this.id
            } else if (!v || v == "*")
                return this.host().resolveVersionAsync(this).then(id => {
                    if (!/:/.test(id)) id = "pub:" + id
                    return (this.resolvedVersion = id);
                })
            return Promise.resolve(v)
        }

        private downloadAsync() {
            let kindCfg = ""
            return this.resolveVersionAsync()
                .then(verNo => {
                    if (this.config && this.config.installedVersion == verNo)
                        return
                    console.log('downloading ' + verNo)
                    return this.host().downloadPackageAsync(this)
                        .then(() => {
                            let confStr = this.readFile(configName)
                            if (!confStr)
                                U.userError(`package ${this.id} is missing ${configName}`)
                            this.parseConfig(confStr)
                            this.config.installedVersion = this.version()
                            this.saveConfig()
                        })
                        .then(() => {
                            info(`installed ${this.id} /${verNo}`)
                        })

                })
        }

        protected validateConfig() {
            if (!this.config.dependencies)
                U.userError("Missing dependencies in config of: " + this.id)
            if (!Array.isArray(this.config.files))
                U.userError("Missing files in config of: " + this.id)
            if (typeof this.config.name != "string" || !this.config.name ||
                (this.config.public && !/^[a-z][a-z0-9\-]+$/.test(this.config.name)))
                U.userError("Invalid package name: " + this.config.name)
        }

        private parseConfig(str: string) {
            let cfg = <PackageConfig>JSON.parse(str)
            this.config = cfg;
            // temp patch for cloud corrupted configs
            for (let dep in this.config.dependencies)
                if (/^microbit-(led|music|game|pins|serial)$/.test(dep)) delete this.config.dependencies[dep];
            this.validateConfig();
        }

        loadAsync(isInstall = false): Promise<void> {
            if (this.isLoaded) return Promise.resolve();
            this.isLoaded = true
            let str = this.readFile(configName)
            if (str == null) {
                if (!isInstall)
                    U.userError("Package not installed: " + this.id)
            } else {
                this.parseConfig(str)
            }

            return (isInstall ? this.downloadAsync() : Promise.resolve())
                .then(() =>
                    U.mapStringMapAsync(this.config.dependencies, (id, ver) => {
                        let mod = this.resolveDep(id)
                        ver = ver || "*"
                        if (mod) {
                            if (mod._verspec != ver)
                                U.userError("Version spec mismatch on " + id)
                            mod.level = Math.min(mod.level, this.level + 1)
                            return Promise.resolve()
                        } else {
                            mod = new Package(id, ver, this.parent)
                            this.parent.deps[id] = mod
                            return mod.loadAsync(isInstall)
                        }
                    }))
                .then(() => { })
        }

        getFiles() {
            if (this.level == 0)
                return this.config.files.concat(this.config.testFiles || [])
            else
                return this.config.files.slice(0);
        }

        addSnapshot(files: U.Map<string>, exts: string[] = [""]) {
            for (let fn of this.getFiles()) {
                if (exts.some(e => U.endsWith(fn, e))) {
                    files[this.id + "/" + fn] = this.readFile(fn)
                }
            }
            files[this.id + "/" + configName] = this.readFile(configName)
        }
    }

    export class MainPackage
        extends Package {
        public deps: U.Map<Package> = {};

        constructor(public _host: Host) {
            super("this", "file:.", null)
            this.parent = this
            this.level = 0
            this.deps[this.id] = this;
        }

        installAllAsync() {
            return this.loadAsync(true)
        }

        installPkgAsync(name: string) {
            return Cloud.privateGetAsync(pkgPrefix + name)
                .then(ptrinfo => {
                    this.config.dependencies[name] = "*"
                })
                .then(() => this.installAllAsync())
                .then(() => this.saveConfig())
        }

        sortedDeps() {
            let visited: U.Map<boolean> = {}
            let ids: string[] = []
            let rec = (p: Package) => {
                if (U.lookup(visited, p.id)) return;
                visited[p.id] = true
                let deps = Object.keys(p.config.dependencies)
                deps.sort((a, b) => U.strcmp(a, b))
                deps.forEach(id => rec(this.resolveDep(id)))
                ids.push(p.id)
            }
            rec(this)
            return ids.map(id => this.resolveDep(id))
        }

        getTargetOptions(): CompileTarget { return U.clone(appTarget.compile); }

        getCompileOptionsAsync(target: CompileTarget = this.getTargetOptions()) {
            let opts: ts.pxt.CompileOptions = {
                sourceFiles: [],
                fileSystem: {},
                target: target,
                hexinfo: {}
            }

            let generateFile = (fn: string, cont: string) => {
                if (this.config.files.indexOf(fn) < 0)
                    U.userError(lf("please add '{0}' to \"files\" in {1}", fn, configName))
                cont = "// Auto-generated. Do not edit.\n" + cont + "\n// Auto-generated. Do not edit. Really.\n"
                if (this.host().readFile(this, fn) !== cont) {
                    console.log(lf("updating {0} (size={1})...", fn, cont.length))
                    this.host().writeFile(this, fn, cont)
                }
            }

            return this.loadAsync()
                .then(() => {
                    info(`building: ${this.sortedDeps().map(p => p.config.name).join(", ")}`)
                    let ext = cpp.getExtensionInfo(this)
                    if (ext.errors)
                        U.userError(ext.errors)
                    if (ext.shimsDTS) generateFile("shims.d.ts", ext.shimsDTS)
                    if (ext.enumsDTS) generateFile("enums.d.ts", ext.enumsDTS)
                    return (target.isNative ? this.host().getHexInfoAsync(ext) : Promise.resolve(null))
                        .then(inf => {
                            ext = U.flatClone(ext)
                            delete ext.compileData;
                            delete ext.generatedFiles;
                            delete ext.extensionFiles;
                            opts.extinfo = ext
                            opts.hexinfo = inf
                        })
                })
                .then(() => this.config.binaryonly ? null : this.filesToBePublishedAsync(true))
                .then(files => {
                    if (files) {
                        let headerString = JSON.stringify({
                            name: this.config.name,
                            comment: this.config.description,
                            status: "unpublished",
                            scriptId: this.config.installedVersion,
                            cloudId: "ks/" + appTarget.id,
                            editor: U.lookup(files, "main.blocks") ? "blocksprj" : "tsprj"
                        })
                        let programText = JSON.stringify(files)
                        return lzmaCompressAsync(headerString + programText)
                            .then(buf => {
                                opts.embedMeta = JSON.stringify({
                                    compression: "LZMA",
                                    headerSize: headerString.length,
                                    textSize: programText.length,
                                    name: this.config.name,
                                })
                                opts.embedBlob = btoa(U.uint8ArrayToString(buf))
                            })
                    } else {
                        return Promise.resolve()
                    }
                })
                .then(() => {
                    for (let pkg of this.sortedDeps()) {
                        for (let f of pkg.getFiles()) {
                            if (/\.(ts|asm)$/.test(f)) {
                                let sn = f
                                if (pkg.level > 0)
                                    sn = "pxt_modules/" + pkg.id + "/" + f
                                opts.sourceFiles.push(sn)
                                opts.fileSystem[sn] = pkg.readFile(f)
                            }
                        }
                    }
                    return opts;
                })
        }

        buildAsync(target: ts.pxt.CompileTarget) {
            return this.getCompileOptionsAsync(target)
                .then(opts => ts.pxt.compile(opts))
        }

        serviceAsync(op: string) {
            return this.getCompileOptionsAsync()
                .then(opts => {
                    ts.pxt.service.performOperation("reset", {})
                    ts.pxt.service.performOperation("setOpts", { options: opts })
                    return ts.pxt.service.performOperation(op, {})
                })
        }

        initAsync(target: string, name: string) {
            if (!target)
                U.userError("missing target")
            if (!name)
                U.userError("missing project name")

            let str = this.readFile(configName)
            if (str)
                U.userError("config already present")

            console.log(`initializing ${name} for target ${target}`);

            let deps: U.Map<string> = {};
            deps[target] = "*";
            if (target == "microbit")
                deps["microbit-radio"] = "*";

            this.config = {
                name: name,
                description: "",
                installedVersion: "",
                files: Object.keys(defaultFiles).filter(s => !/test/.test(s)),
                testFiles: Object.keys(defaultFiles).filter(s => /test/.test(s)),
                dependencies: deps
            }
            this.validateConfig();
            this.saveConfig()

            U.iterStringMap(defaultFiles, (k, v) => {
                this.host().writeFile(this, k, v.replace(/@NAME@/g, name))
            })
            info("package initialized")

            return Promise.resolve()
        }

        filesToBePublishedAsync(allowPrivate = false) {
            let files: U.Map<string> = {};

            return this.loadAsync()
                .then(() => {
                    if (!allowPrivate && !this.config.public)
                        U.userError('Only packages with "public":true can be published')
                    let cfg = U.clone(this.config)
                    delete cfg.installedVersion
                    U.iterStringMap(cfg.dependencies, (k, v) => {
                        if (v != "*" && !/^pub:/.test(v)) {
                            cfg.dependencies[k] = "*"
                            if (v)
                                info(`local dependency '${v}' replaced with '*' in published package`)
                        }
                    })
                    files[configName] = JSON.stringify(cfg, null, 4)
                    for (let f of this.getFiles()) {
                        let str = this.readFile(f)
                        if (str == null)
                            U.userError("referenced file missing: " + f)
                        files[f] = str
                    }

                    return U.sortObjectFields(files)
                })
        }

        publishAsync() {
            let text: string;
            let scrInfo: { id: string; } = null;

            return this.filesToBePublishedAsync()
                .then(files => {
                    text = JSON.stringify(files, null, 2)
                    let hash = U.sha256(text).substr(0, 32)
                    info(`checking for pre-existing script at ${hash}`)
                    return Cloud.privateGetAsync("scripthash/" + hash)
                        .then(resp => {
                            if (resp.items && resp.items[0])
                                return resp.items[0]
                            else return null
                        })
                })
                .then(sinfo => {
                    scrInfo = sinfo;
                    if (scrInfo) {
                        info(`found existing script at /${scrInfo.id}`)
                        return Promise.resolve();
                    }
                    let scrReq = {
                        baseid: "",
                        name: this.config.name,
                        description: this.config.description || "",
                        islibrary: true,
                        ishidden: false,
                        userplatform: ["ks"],
                        editor: javaScriptProjectName,
                        target: appTarget.id,
                        text: text
                    }
                    info(`publishing script; ${text.length} bytes; target=${scrReq.target}`)
                    return Cloud.privatePostAsync("scripts", scrReq)
                        .then(inf => {
                            scrInfo = inf
                            info(`published; id /${scrInfo.id}`)
                        })
                })
                .then(() => Cloud.privateGetAsync(pkgPrefix + this.config.name)
                    .then(res => res.scriptid == scrInfo.id, e => false))
                .then(alreadySet => {
                    if (alreadySet) {
                        info(`package already published`)
                        return
                    }
                    return Cloud.privatePostAsync("pointers", {
                        path: pkgPrefix.replace(/^ptr-/, "").replace(/-$/, "") + "/" + this.config.name,
                        scriptid: scrInfo.id
                    }).then(() => {
                        info(`package published`)
                    })
                })
                .then(() => {
                    if (this.config.installedVersion != scrInfo.id) {
                        this.config.installedVersion = scrInfo.id
                        this.saveConfig();
                    }
                })
        }
    }

    export var pkgPrefix = "ptr-pkg-"
    export var configName = "kind.json"
    export var blocksProjectName = "blocksprj";
    export var javaScriptProjectName = "tsprj";
    var info = function info(msg: string) {
        console.log(msg)
    }

    var defaultFiles: U.Map<string> = {
        "README.md":
        `# @NAME@

Put some info here.
`,
        "tsconfig.json":
        `{
    "compilerOptions": {
        "target": "es5",
        "noImplicitAny": true,
        "outDir": "built",
        "rootDir": "."
    }
}
`,
        "main.ts":
        `
`,
        "tests.ts":
        `// Put your testing code in this file. 
// It will not be compiled when compiling as a library (dependency of another module).
`,
        ".gitignore":
        `built
node_modules
yotta_modules
yotta_targets
pxt_modules
*.db
*.tgz
`,
        ".vscode/settings.json":
        `{
    "editor.formatOnType": true,
    "files.autoSave": "afterDelay",
	"search.exclude": {
		"**/built": true,
		"**/node_modules": true,
		"**/yotta_modules": true,
		"**/yotta_targets": true,
		"**/pxt_modules": true
	}
}`,
        ".vscode/tasks.json":
        `
// A task runner that calls the KindScript compiler (kind) and
{
	"version": "0.1.0",

	// The command is kind. Assumes that KindScript has been installed using npm install -g kindscript-cli
	"command": "kind",

	// The command is a shell script
	"isShellCommand": true,

	// Show the output window always.
	"showOutput": "always",

    "tasks": [{
        "taskName": "deploy",
        "isBuildCommand": true,
	    "problemMatcher": "$tsc",
    	"args": ["deploy"]
    }, {
        "taskName": "build",
        "isTestCommand": true,
	    "problemMatcher": "$tsc",
    	"args": ["build"]
    }, {
        "taskName": "publish",
	    "problemMatcher": "$tsc",
    	"args": ["publish"]
    }]
}
`
    }
}
